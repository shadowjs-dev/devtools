import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listZip, zipDirectory } from "../../extension/zip.mjs";

describe("[DVT-EXT-ZP] the store zip holds exactly the built folder, with no link out of it", () => {
  it("[DVT-EXT-ZP.1] every file of the folder is an entry, with its bytes, and the names are relative and sorted", () => {
    const root = mkdtempSync(join(tmpdir(), "shadowjs-zip-"));
    try {
      const folder = join(root, "dist");
      mkdirSync(join(folder, "sub"), { recursive: true });
      writeFileSync(join(folder, "manifest.json"), '{"manifest_version":3}\n');
      writeFileSync(join(folder, "sub", "a.js"), "console.log('a');\n");
      writeFileSync(join(folder, "b.html"), "<!doctype html>\n");
      const out = join(root, "out.zip");
      zipDirectory(folder, out);
      const entries = listZip(readFileSync(out));
      expect(entries.map((entry) => entry.name)).toEqual(["b.html", "manifest.json", "sub/a.js"]);
      expect(entries[1]?.data.toString("utf8")).toBe('{"manifest_version":3}\n');
      expect(entries[2]?.data.toString("utf8")).toBe("console.log('a');\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("[DVT-EXT-ZP.2] a folder with a symbolic link is refused, so the zip cannot carry a file from outside", () => {
    const root = mkdtempSync(join(tmpdir(), "shadowjs-zip-"));
    try {
      const folder = join(root, "dist");
      mkdirSync(folder);
      writeFileSync(join(root, "secret.txt"), "outside");
      symlinkSync(join(root, "secret.txt"), join(folder, "link.txt"));
      expect(() => zipDirectory(folder, join(root, "out.zip"))).toThrow(/symbolic link/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
