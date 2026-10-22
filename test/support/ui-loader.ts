import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { compile } from "@shadow-js/compiler/javascript";

const sourceDir = join(import.meta.dirname, "..", "..", "src");
const generatedDir = join(import.meta.dirname, "..", ".generated");

type DevtoolsModule = typeof import("../../src/index");

function listFiles(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) out.push(...listFiles(path));
    else out.push(path);
  }
  return out.sort();
}

/** Keeps the newest few compiled copies; every edit of the sources creates a new one. */
function pruneOld(keep: number): void {
  if (!existsSync(generatedDir)) return;
  const copies = readdirSync(generatedDir)
    .filter((name) => /^[0-9a-f]{12}$/.test(name))
    .map((name) => ({ name, time: statSync(join(generatedDir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  for (const stale of copies.slice(keep))
    rmSync(join(generatedDir, stale.name), { recursive: true, force: true });
}

/**
 * Compiles the package's own source with the repository compiler (`.tsx` files become plain
 * modules, `.ts` files are copied) into a generated directory and imports the entry from there.
 * This is the same pattern as `packages/web/test/support/compile.ts`, applied to a tree of files:
 * the UI is built with ShadowJS and tested as compiled by ShadowJS.
 *
 * The directory name is a hash of the sources, so unchanged sources are compiled once per run.
 *
 * @returns The package entry module, loaded from the compiled copy.
 */
export async function loadDevtools(): Promise<DevtoolsModule> {
  const files = listFiles(sourceDir);
  const hash = createHash("sha1");
  for (const file of files) hash.update(file).update(readFileSync(file));
  const target = join(generatedDir, hash.digest("hex").slice(0, 12));
  if (!existsSync(join(target, "index.ts"))) {
    pruneOld(3);
    // Test files run in parallel: build in a private directory and move it into place in one step,
    // so nobody imports a half-written copy.
    const staging = `${target}.tmp-${process.pid}`;
    rmSync(staging, { recursive: true, force: true });
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const out = join(staging, relative(sourceDir, file)).replace(/\.tsx$/, ".ts");
      mkdirSync(dirname(out), { recursive: true });
      if (file.endsWith(".tsx")) {
        const result = compile(source, { filename: file, generate: "dom", dev: true });
        writeFileSync(out, result.code);
      } else {
        writeFileSync(out, source);
      }
    }
    try {
      renameSync(staging, target);
    } catch (error) {
      // Another test file finished first: its copy is identical, use that one.
      rmSync(staging, { recursive: true, force: true });
      if (!existsSync(join(target, "index.ts"))) throw error;
    }
  }
  return (await import(/* @vite-ignore */ join(target, "index.ts"))) as DevtoolsModule;
}
