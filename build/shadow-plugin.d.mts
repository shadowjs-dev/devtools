import type { Plugin, SourceMapInput } from "rolldown";

/** The shape of `compile()` from `@shadow-js/compiler` that the plugin needs. */
export type CompileFunction = (
  source: string,
  options: { filename: string; generate: "dom"; dev: boolean },
) => { code: string; map: SourceMapInput | null; transformed: boolean };

/** Compiles `.tsx` files with the ShadowJS compiler during a Rolldown / tsdown build. */
export function shadowCompile(compile: CompileFunction, options?: { dev?: boolean }): Plugin;
