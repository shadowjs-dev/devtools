/**
 * Packs the built extension into the zip a browser store accepts (Chrome Web Store, Edge Add-ons and
 * Firefox AMO). It writes the archive with `zlib` only, so the package needs no zip
 * dependency. Nothing is uploaded: a person submits the file, after reading `README.md`.
 *
 * - Entries are the files of the folder, relative and sorted, with forward slashes.
 * - Every date is fixed (2026-10-10 00:00), so the same folder always gives the same bytes.
 * - A symbolic link in the folder is refused: a link could put a file from outside the folder into the zip.
 *
 * Run `npm run zip:extension -w @shadow-js/devtools`: it builds both browsers' folders and writes
 * `extension/store/shadowjs-devtools-chromium-<version>.zip` and
 * `extension/store/shadowjs-devtools-firefox-<version>.zip`.
 *
 * @module
 */

import { lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

const here = dirname(fileURLToPath(import.meta.url));

/** The fixed DOS date and time of every entry: 2026-10-10 00:00. */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (10 << 5) | 10;
const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const METHOD_DEFLATE = 8;
/** General purpose flag bit 11: names are UTF-8. */
const FLAG_UTF8 = 0x0800;

/**
 * The files under `folder`, as relative posix names, sorted by code unit. A symbolic link is an error.
 *
 * @param {string} folder The folder to walk.
 * @returns {string[]} Relative names such as `sub/a.js`.
 * @since 1.0.0
 */
function filesOf(folder) {
  const names = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      const info = lstatSync(path);
      if (info.isSymbolicLink()) throw new Error(`zip: refuses the symbolic link ${path}`);
      if (info.isDirectory()) walk(path);
      else if (info.isFile()) names.push(relative(folder, path).split(sep).join(posix.sep));
    }
  };
  walk(folder);
  return names.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Writes a zip of every file under `folder` to `outFile`, creating its folder.
 *
 * @param {string} folder The folder to pack (the built `dist/`).
 * @param {string} outFile The archive to write.
 * @returns {{ entries: number, bytes: number }} What was written.
 * @throws {Error} When the folder holds a symbolic link.
 * @since 1.0.0
 */
export function zipDirectory(folder, outFile) {
  const names = filesOf(folder);
  const locals = [];
  const central = [];
  let offset = 0;
  for (const name of names) {
    const data = readFileSync(join(folder, ...name.split(posix.sep)));
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const nameBytes = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIGNATURE, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    const head = Buffer.concat([local, nameBytes, packed]);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(CENTRAL_SIGNATURE, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(FLAG_UTF8, 8);
    dir.writeUInt16LE(METHOD_DEFLATE, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBytes.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(head);
    central.push(Buffer.concat([dir, nameBytes]));
    offset += head.length;
  }
  const centralBytes = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_SIGNATURE, 0);
  end.writeUInt16LE(names.length, 8);
  end.writeUInt16LE(names.length, 10);
  end.writeUInt32LE(centralBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  const archive = Buffer.concat([...locals, centralBytes, end]);
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, archive);
  return { entries: names.length, bytes: archive.length };
}

/**
 * Reads a zip written by {@link zipDirectory} (stored or deflated entries, no comment). Each entry's CRC
 * is checked, so a damaged archive is an error and not a silent wrong file.
 *
 * @param {Buffer} archive The archive bytes.
 * @returns {Array<{ name: string, data: Buffer }>} The entries in archive order.
 * @throws {Error} On a bad signature, a bad CRC or an unknown method.
 * @since 1.0.0
 */
export function listZip(archive) {
  const end = archive.length - 22;
  if (end < 0 || archive.readUInt32LE(end) !== END_SIGNATURE) throw new Error("zip: no end record");
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (archive.readUInt32LE(at) !== CENTRAL_SIGNATURE) throw new Error("zip: bad central record");
    const method = archive.readUInt16LE(at + 10);
    const crc = archive.readUInt32LE(at + 16);
    const packedLength = archive.readUInt32LE(at + 20);
    const nameLength = archive.readUInt16LE(at + 28);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    if (archive.readUInt32LE(local) !== LOCAL_SIGNATURE) throw new Error("zip: bad local record");
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const packed = archive.subarray(start, start + packedLength);
    if (method !== METHOD_DEFLATE) throw new Error(`zip: unknown method ${method} for ${name}`);
    const data = inflateRawSync(packed);
    if (crc32(data) !== crc) throw new Error(`zip: bad CRC for ${name}`);
    entries.push({ name, data });
    at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
  }
  return entries;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { buildExtensions, extensionVersion } = await import("./build.mjs");
  const version = extensionVersion();
  const folders = await buildExtensions({ version });
  for (const target of /** @type {const} */ (["chromium", "firefox"])) {
    const out = join(here, "store", `shadowjs-devtools-${target}-${version}.zip`);
    const { entries, bytes } = zipDirectory(folders[target], out);
    console.log(
      `${target} store zip written to ${out} (${entries} files, ${bytes} bytes). Nothing was uploaded.`,
    );
  }
}
