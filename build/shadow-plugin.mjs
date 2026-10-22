/**
 * A Rolldown plugin that compiles `.tsx` files with the ShadowJS compiler. The panel of
 * `@shadow-js/devtools` is written in JSX; this turns it into plain modules during the package build
 * (and in the production-gating test), the same way `@shadow-js/vite` does for applications.
 *
 * The compiler output keeps TypeScript syntax, which the bundler strips afterward.
 *
 * @param {(source: string, options: { filename: string, generate: "dom", dev: boolean }) => { code: string, map: import("rolldown").SourceMapInput | null, transformed: boolean }} compile
 *   The `compile` function of `@shadow-js/compiler`.
 * @param {{ dev?: boolean }} [options] `dev` adds component names (the development build).
 * @returns {import("rolldown").Plugin}
 */
export function shadowCompile(compile, options = {}) {
  return {
    name: "shadowjs-compile",
    transform: {
      filter: { id: /\.tsx$/ },
      handler(code, id) {
        const result = compile(code, { filename: id, generate: "dom", dev: options.dev === true });
        return result.transformed ? { code: result.code, map: result.map ?? undefined } : null;
      },
    },
  };
}
