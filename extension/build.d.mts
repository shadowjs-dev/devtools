/**
 * One construct the extension bundles must not contain.
 *
 * @since 1.0.0
 */
export interface ForbiddenPattern {
  /** Name shown in the build error. */
  readonly name: string;
  /** The textual pattern. */
  readonly pattern: RegExp;
}

/**
 * The constructs the extension bundles must not contain (see `build.mjs`).
 *
 * @since 1.0.0
 */
export const FORBIDDEN: readonly ForbiddenPattern[];

/**
 * Lists the constructs of {@link FORBIDDEN} that `text` contains.
 *
 * @param text Source of one bundle.
 * @returns The names of the matched patterns (empty when clean).
 * @since 1.0.0
 */
export function findForbidden(text: string): string[];

/**
 * The default output root: `dist/extension` of the package.
 *
 * @since 1.0.0
 */
export const DEFAULT_OUT_ROOT: string;

/**
 * Options of the build functions.
 *
 * @since 1.0.0
 */
export interface BuildOptions {
  /** The extension version, `x.y.z`. */
  version: string;
  /** Silence the bundler. */
  quiet?: boolean;
  /** The folder that receives `chromium/` and `firefox/`. Defaults to {@link DEFAULT_OUT_ROOT}. */
  outRoot?: string;
}

/**
 * Builds the unpacked extension for Chromium and Firefox.
 *
 * @param options The version, the bundler's verbosity and the output root.
 * @returns The two output folders.
 * @since 1.0.0
 */
export function buildExtensions(
  options: BuildOptions,
): Promise<{ chromium: string; firefox: string }>;

/**
 * Builds both browsers' folders and returns the Chromium one.
 *
 * @param options The version, the bundler's verbosity and the output root.
 * @returns The Chromium output folder.
 * @since 1.0.0
 */
export function buildExtension(options: BuildOptions): Promise<string>;

/**
 * The version the extension is built with: `SHADOWJS_EXTENSION_VERSION` when it is set, else the
 * `version` of the package.
 *
 * @param env The environment to read (default `process.env`).
 * @returns The `x.y.z` version.
 * @since 1.0.1
 */
export function extensionVersion(env?: Record<string, string | undefined>): string;
