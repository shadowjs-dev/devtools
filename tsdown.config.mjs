import { compile } from "@shadow-js/compiler";
import { shadowCompile } from "./build/shadow-plugin.mjs";
import { createConfig } from "./build/tsdown-preset.mjs";

// The shared preset builds a dev and a prod bundle; each gets the JSX compiler in its own mode.
const [dev, prod] = createConfig({ packageDir: import.meta.dirname });

/** Packages the application provides: the tools must share its copy of the runtime. */
const deps = { neverBundle: [/^@shadow-js\//] };

export default [
  { ...dev, deps, plugins: [shadowCompile(compile, { dev: true })] },
  { ...prod, deps, plugins: [shadowCompile(compile, { dev: false })] },
];
