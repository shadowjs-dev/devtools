import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "@shadow-js/compiler/javascript";
import { rolldown } from "rolldown";
import { afterEach, describe, expect, it } from "vitest";
import { shadowCompile } from "../build/shadow-plugin.mjs";

const entryDir = join(import.meta.dirname, ".generated", "production");
const source = join(import.meta.dirname, "..", "src", "index.ts");

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__SHADOWJS_DEVTOOLS_HOOK__");
  document.body.innerHTML = "";
});

/**
 * Bundles a one-file application that imports from the package, with `__DEV__` replaced the way the
 * `development` / production conditions do, and returns the output text plus the file written.
 */
async function bundle(
  imports: string[],
  body: string,
  dev: boolean,
): Promise<{ code: string; file: string }> {
  mkdirSync(entryDir, { recursive: true });
  const name = `${dev ? "dev" : "prod"}-${imports.join("-") || "none"}`;
  const entry = join(entryDir, `${name}-entry.ts`);
  writeFileSync(
    entry,
    `import { ${imports.join(", ")} } from ${JSON.stringify(source)};\n${body}\n`,
  );
  const build = await rolldown({
    input: entry,
    external: [/^@shadow-js\//],
    plugins: [shadowCompile(compile, { dev })],
    transform: {
      define: {
        __DEV__: String(dev),
        __SERVER__: "false",
        __TEST__: "false",
        __VERSION__: '"0.0.0"',
      },
    },
    // The packages declare `"sideEffects": false`, so a bundler drops imports nothing uses.
    treeshake: { moduleSideEffects: false },
    logLevel: "silent",
  });
  const { output } = await build.generate({ format: "esm", minify: !dev });
  await build.close();
  const first = output[0];
  if (first === undefined) throw new Error("no output");
  const file = join(entryDir, `${name}.mjs`);
  writeFileSync(file, first.code);
  return { code: first.code, file };
}

describe("[DVT-15] production builds: the package is a no-op", () => {
  it("[DVT-15.1] an app that only calls mountDevtools() bundles to almost nothing", async () => {
    const prod = await bundle(
      ["mountDevtools"],
      "export const handle = mountDevtools({ open: true });",
      false,
    );
    // None of the tools' code is reachable once __DEV__ is false.
    for (const marker of [
      "attachShadow",
      "Alt+Shift+D",
      "data-shadowjs",
      "__SHADOWJS_DEVTOOLS_HOOK__",
      "requestAnimationFrame",
      "BroadcastChannel",
    ]) {
      expect(prod.code, marker).not.toContain(marker);
    }
    // Not even an import of the runtime remains.
    expect(prod.code).not.toContain("@shadow-js");
    expect(prod.code.length).toBeLessThan(1000);
  });

  it("[DVT-15.2] the development bundle of the same app does contain the tools", async () => {
    const dev = await bundle(
      ["mountDevtools"],
      "export const handle = mountDevtools({ open: true });",
      true,
    );
    expect(dev.code).toContain("attachShadow");
    expect(dev.code).toContain("Alt+Shift+D");
    expect(dev.code.length).toBeGreaterThan(20_000);
  });

  it("[DVT-15.3] in production mountDevtools() touches nothing and returns a handle of no-ops", async () => {
    const prod = await bundle(
      ["mountDevtools"],
      "export const handle = mountDevtools({ open: true });",
      false,
    );
    const before = document.body.innerHTML;
    const { handle } = (await import(/* @vite-ignore */ prod.file)) as {
      handle: import("../src/mount").DevtoolsHandle;
    };
    expect(document.body.innerHTML).toBe(before);
    expect(Reflect.get(globalThis, "__SHADOWJS_DEVTOOLS_HOOK__")).toBeUndefined();
    expect(handle.host).toBeNull();
    expect(handle.root).toBeNull();
    expect(handle.agent).toBeNull();
    expect(handle.isOpen).toBe(false);
    expect(() => {
      handle.open();
      handle.toggle();
      handle.select(1);
      handle.setTab("timeline");
      handle.moveTo(1, 2);
      handle.flush();
      handle.close();
      handle.dispose();
    }).not.toThrow();
    expect(handle.isOpen).toBe(false);
  });

  it("[DVT-15.4] in production installHook() installs nothing", async () => {
    const prod = await bundle(
      ["installHook", "getHook"],
      "export const installed = installHook(); export const found = getHook();",
      false,
    );
    const { installed, found } = (await import(/* @vite-ignore */ prod.file)) as {
      installed: unknown;
      found: unknown;
    };
    expect(installed).toBeUndefined();
    expect(found).toBeUndefined();
    expect(Reflect.get(globalThis, "__SHADOWJS_DEVTOOLS_HOOK__")).toBeUndefined();
  });

  it("[DVT-15.5] the hook is only installed when the tools are used in development", async () => {
    const dev = await bundle(["installHook"], "export const installed = installHook();", true);
    const { installed } = (await import(/* @vite-ignore */ dev.file)) as {
      installed: { version: number } | undefined;
    };
    expect(installed?.version).toBe(1);
    expect(Reflect.get(globalThis, "__SHADOWJS_DEVTOOLS_HOOK__")).toBe(installed);
  });

  it("[DVT-15.6] unused tools never reach a production bundle: a pure-model app is small and DOM-free", async () => {
    const prod = await bundle(
      ["foldEvents", "snapshotOf"],
      "export const size = snapshotOf(foldEvents([])).nodes.length;",
      false,
    );
    expect(prod.code).not.toContain("attachShadow");
    expect(prod.code).not.toContain("getBoundingClientRect");
    expect(prod.code.length).toBeLessThan(12_000);
  });
  it("[DVT-15.6] in production registerInspection() registers nothing and bundles no hook; in development it keeps the hook", async () => {
    const body =
      'export const registered = registerInspection("flags", { title: "Flags", rows: () => [] });';
    const prod = await bundle(["registerInspection"], body, false);
    expect(prod.code).not.toContain("__SHADOWJS_DEVTOOLS_HOOK__");
    expect(prod.code).not.toContain("registry");
    expect(prod.code.length).toBeLessThan(1000);
    const dev = await bundle(["registerInspection"], body, true);
    expect(dev.code).toContain("__SHADOWJS_DEVTOOLS_HOOK__");
  });
});
