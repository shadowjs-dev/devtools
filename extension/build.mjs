/**
 * Builds the unpacked extension for Chromium and Firefox. `dist/extension/chromium` and
 * `dist/extension/firefox` each hold `manifest.json`, the classic-script bundles and the two pages, ready
 * for "Load unpacked" in Chromium or "Load Temporary Add-on" in Firefox. Run it from the package with
 * `npm run build:extension -w @shadow-js/devtools`.
 *
 * The build fails when a bundle contains a construct the extension must never ship (`eval`, a string
 * passed to `setTimeout`, `document.write`): see `findForbidden`.
 *
 * @module
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "tsdown";
import { EXTENSION_ENTRIES, extensionConfigs } from "./tsdown.config.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const packageDir = dirname(here);

/**
 * Patterns that the extension's bundles must not contain: dynamic code (`eval`, `new Function`, a
 * string timer), `document.write`, the network APIs that could send data out of the page (`fetch`,
 * `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`), and a dynamic `import()` (code loaded
 * from elsewhere). The scan is textual, so it is a tripwire, not a proof; the extension's own sources
 * are written without them and the tests check the rest.
 *
 * @type {ReadonlyArray<{ name: string, pattern: RegExp }>}
 * @since 1.0.0
 */
export const FORBIDDEN = [
  { name: "eval", pattern: /(^|[^.\w$])eval\s*\(/ },
  { name: "new Function", pattern: /\bnew\s+Function\s*\(/ },
  { name: "string timer", pattern: /\bset(?:Timeout|Interval)\s*\(\s*["'`]/ },
  { name: "document.write", pattern: /\bdocument\.write(?:ln)?\s*\(/ },
  {
    name: "network request",
    // `fetch` is also a common method name (`resource.fetch()`), so only a bare call counts; the other
    // network APIs are reported wherever they are called from, including `navigator.sendBeacon(`.
    pattern:
      /(^|[^.\w$])(?:fetch\s*\(|XMLHttpRequest\b|WebSocket\b|EventSource\b)|\bsendBeacon\s*\(/,
  },
  { name: "dynamic import", pattern: /(^|[^.\w$])import\s*\(/ },
];

/**
 * Lists the constructs of {@link FORBIDDEN} that `text` contains.
 *
 * @param {string} text Source of one bundle.
 * @returns {string[]} The names of the matched patterns (empty when clean).
 * @since 1.0.0
 */
export function findForbidden(text) {
  return FORBIDDEN.filter(({ pattern }) => pattern.test(text)).map(({ name }) => name);
}

/**
 * Where the builds go by default: `dist/extension/chromium` and `dist/extension/firefox` of the package.
 *
 * @since 1.0.0
 */
export const DEFAULT_OUT_ROOT = join(packageDir, "dist", "extension");

/**
 * Builds the extension for both browsers. The bundles are the same for both (the code picks `browser` or
 * `chrome` at run time), so they are built once into the Chromium folder and copied to the Firefox folder;
 * only `manifest.json` differs. Each manifest is audited first (`auditManifest`), and a violation stops the
 * build before anything is written.
 *
 * @param {{ version: string, quiet?: boolean, outRoot?: string }} options The extension version (`1.2.3`
 *   form), whether to silence the bundler, and the folder that receives `chromium/` and `firefox/`.
 * @returns {Promise<{ chromium: string, firefox: string }>} The two output folders.
 * @throws {Error} On a bad version, a manifest that breaks the policy, or a bundle with a forbidden construct.
 * @since 1.0.0
 */
export async function buildExtensions({ version, quiet = false, outRoot = DEFAULT_OUT_ROOT }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`build: version "${version}" is not x.y.z`);
  const outDirs = { chromium: join(outRoot, "chromium"), firefox: join(outRoot, "firefox") };
  const manifestDir = join(outRoot, ".manifest");
  const configs = extensionConfigs({ outDir: outDirs.chromium, manifestDir });
  const silent = quiet ? { logLevel: "silent" } : {};

  const extensionDir = join(packageDir, "extension");
  await build({ ...configs.manifest, config: false, cwd: extensionDir, ...silent });
  const manifestModule = join(manifestDir, "manifest.js");
  const { auditManifest, createManifestFor } = await import(
    `${pathToFileURL(manifestModule).href}?built=${Date.now()}`
  );
  const manifests = {
    chromium: createManifestFor("chromium", { version }),
    firefox: createManifestFor("firefox", { version }),
  };
  const violations = Object.entries(manifests).flatMap(([target, manifest]) =>
    auditManifest(manifest).map((problem) => `${target}: ${problem}`),
  );
  if (violations.length > 0) {
    rmSync(manifestDir, { recursive: true, force: true });
    throw new Error(`build: the manifest breaks the permission policy:\n${violations.join("\n")}`);
  }

  rmSync(outDirs.chromium, { recursive: true, force: true });
  rmSync(outDirs.firefox, { recursive: true, force: true });
  for (const bundle of configs.bundles) {
    await build({ ...bundle, config: false, cwd: extensionDir, ...silent });
  }
  // tsdown writes classic scripts as `<name>.iife.js`; the manifest and the pages name `<name>.js`.
  for (const name of EXTENSION_ENTRIES) {
    renameSync(join(outDirs.chromium, `${name}.iife.js`), join(outDirs.chromium, `${name}.js`));
  }
  rmSync(manifestDir, { recursive: true, force: true });
  mkdirSync(outDirs.chromium, { recursive: true });
  for (const page of ["devtools.html", "panel.html"]) {
    copyFileSync(join(here, "static", page), join(outDirs.chromium, page));
  }

  const problems = [];
  for (const file of readdirSync(outDirs.chromium)) {
    if (!file.endsWith(".js")) continue;
    const hits = findForbidden(readFileSync(join(outDirs.chromium, file), "utf8"));
    if (hits.length > 0) problems.push(`${file}: ${hits.join(", ")}`);
  }
  if (problems.length > 0) {
    throw new Error(
      `build: forbidden constructs in the extension bundles:\n${problems.join("\n")}`,
    );
  }

  // The Firefox folder holds the same files; the manifests are the only difference.
  mkdirSync(outDirs.firefox, { recursive: true });
  for (const file of readdirSync(outDirs.chromium)) {
    copyFileSync(join(outDirs.chromium, file), join(outDirs.firefox, file));
  }
  for (const target of /** @type {const} */ (["chromium", "firefox"])) {
    writeFileSync(
      join(outDirs[target], "manifest.json"),
      `${JSON.stringify(manifests[target], null, 2)}\n`,
    );
  }
  return outDirs;
}

/**
 * Builds the extension for both browsers (see {@link buildExtensions}) and returns the Chromium folder,
 * which is what "Load unpacked" takes in Chrome and Edge.
 *
 * @param {{ version: string, quiet?: boolean, outRoot?: string }} options The extension version (`1.2.3`
 *   form), whether to silence the bundler, and the output root.
 * @returns {Promise<string>} The Chromium output folder.
 * @since 1.0.0
 */
export async function buildExtension(options) {
  return (await buildExtensions(options)).chromium;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pkg = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8"));
  const version = process.env["SHADOWJS_EXTENSION_VERSION"] ?? "1.0.0";
  const out = await buildExtensions({ version });
  for (const folder of Object.values(out)) {
    if (!existsSync(join(folder, "manifest.json")))
      throw new Error(`build: ${folder}/manifest.json was not written`);
  }
  console.log(
    `extension built for Chromium in ${out.chromium} and for Firefox in ${out.firefox} (package ${pkg.name}@${pkg.version})`,
  );
}
