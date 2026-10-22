import { compile } from "@shadow-js/compiler";
import { shadowCompile } from "../build/shadow-plugin.mjs";

/**
 * The classic-script entries of the extension, by output name.
 *
 * @since 1.0.0
 */
export const EXTENSION_ENTRIES_PATHS = {
  background: "src/background.ts",
  content: "src/content.ts",
  "page-main": "src/page-main.ts",
  devtools: "src/devtools.ts",
  "panel-main": "src/panel-main.tsx",
};

/**
 * Output names of the classic-script entries (`dist/<name>.js`).
 *
 * @since 1.0.0
 */
export const EXTENSION_ENTRIES = Object.keys(EXTENSION_ENTRIES_PATHS);

/**
 * The extension's bundles. Content scripts and the MAIN-world script must be classic scripts, so every
 * extension entry is an IIFE with its dependencies bundled: the panel's own copy of ShadowJS, and the
 * hook's modules. The manifest is a separate ES module that `build.mjs` imports to write `manifest.json`.
 *
 * `__DEV__` is always true here: the extension is a development tool and nothing in it is built for
 * production.
 *
 * @param {{ outDir: string, manifestDir: string }} paths Where the bundles and the manifest module go.
 * @returns {{ bundles: import("tsdown").UserConfig[], manifest: import("tsdown").UserConfig }}
 * @since 1.0.0
 */
export function extensionConfigs(paths) {
  const define = {
    __DEV__: "true",
    __SERVER__: "false",
    __TEST__: "false",
    __VERSION__: JSON.stringify("0.0.0"),
  };
  const common = {
    platform: "neutral",
    target: "es2022",
    clean: false,
    dts: false,
    sourcemap: false,
    unbundle: false,
    minify: false,
    define,
  };
  // IIFE output takes one entry per build (code splitting is not possible for classic scripts).
  const bundles = EXTENSION_ENTRIES.map((name) => ({
    ...common,
    entry: { [name]: EXTENSION_ENTRIES_PATHS[name] },
    format: "iife",
    platform: "browser",
    fixedExtension: false,
    outDir: paths.outDir,
    deps: { alwaysBundle: [/^@shadow-js\//] },
    plugins: [shadowCompile(compile, { dev: true })],
  }));
  return {
    bundles,
    manifest: {
      ...common,
      clean: true,
      entry: { manifest: "src/manifest.ts" },
      format: "esm",
      outDir: paths.manifestDir,
    },
  };
}
