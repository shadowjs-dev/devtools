/**
 * The extension's manifests (Manifest V3, for Chromium and for Firefox). One generator writes both, so the
 * permission policy is in one place and the tests check it.
 *
 * The policy, and why:
 * - `permissions` is empty: the extension needs no API beyond its content scripts and the devtools page.
 *   No `tabs`, no `scripting`, no `storage`, no `activeTab`.
 * - Content scripts match only the loopback hosts (`localhost`, `127.0.0.1`, `[::1]`), top frame only.
 *   No `<all_urls>`, so the extension never runs on a site it was not built for.
 * - The page hook runs in the `MAIN` world at `document_start`, so it is installed before the app runs,
 *   and it is not an inline `<script>` element: a strict page CSP does not block it. No web-accessible
 *   resources are declared, so pages cannot load the extension's files.
 * - The extension pages allow scripts from the extension only (`script-src 'self'`) and no `eval`.
 *
 * The Firefox manifest differs only where Firefox requires it: an event page (`background.scripts`) in place
 * of the service worker, the add-on id and minimum version in `browser_specific_settings.gecko`, the same
 * loopback hosts as `host_permissions` (Firefox asks for them at install), and no `minimum_chrome_version`.
 * {@link auditManifest} checks the policy on either manifest, and the build refuses a manifest it rejects.
 *
 * @packageDocumentation
 */

/**
 * The hosts the extension runs on. Chromium match patterns ignore ports, so `http://localhost/*` covers
 * every port of localhost.
 *
 * @since 1.0.0
 */
export const LOOPBACK_MATCHES: readonly string[] = [
  "http://localhost/*",
  "http://127.0.0.1/*",
  "http://[::1]/*",
];

/**
 * The file names of the extension's scripts and pages, as the build writes them.
 *
 * @since 1.0.0
 */
export const FILES = {
  background: "background.js",
  content: "content.js",
  pageMain: "page-main.js",
  devtoolsPage: "devtools.html",
  panelPage: "panel.html",
} as const;

/**
 * The browsers the extension is built for.
 *
 * @since 1.0.0
 */
export type ExtensionTarget = "chromium" | "firefox";

/**
 * Every target, in the order the build writes them.
 *
 * @since 1.0.0
 */
export const EXTENSION_TARGETS: readonly ExtensionTarget[] = ["chromium", "firefox"];

/**
 * The add-on id of the Firefox build. Firefox needs one for a temporary or signed install.
 *
 * @since 1.0.0
 */
export const GECKO_ID = "devtools@shadowjs.net";

/**
 * The oldest Firefox that runs the extension: 128 added content scripts in the page's `MAIN` world to
 * Manifest V3.
 *
 * @since 1.0.0
 */
export const FIREFOX_MIN_VERSION = "128.0";

/**
 * The Chromium manifest: the subset of Manifest V3 keys the extension uses.
 *
 * @since 1.0.0
 */
export interface ExtensionManifest {
  readonly manifest_version: 3;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly minimum_chrome_version: string;
  readonly permissions: readonly string[];
  readonly background: { readonly service_worker: string };
  readonly content_scripts: ReadonlyArray<{
    readonly matches: readonly string[];
    readonly js: readonly string[];
    readonly run_at: "document_start";
    readonly all_frames: false;
    readonly world?: "MAIN" | "ISOLATED";
  }>;
  readonly devtools_page: string;
  readonly content_security_policy: { readonly extension_pages: string };
}

/**
 * The Firefox manifest: the subset of Manifest V3 keys the extension uses there.
 *
 * @since 1.0.0
 */
export interface FirefoxManifest {
  readonly manifest_version: 3;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly browser_specific_settings: {
    readonly gecko: {
      readonly id: string;
      readonly strict_min_version: string;
      readonly data_collection_permissions: { readonly required: readonly ["none"] };
    };
  };
  readonly permissions: readonly string[];
  readonly host_permissions: readonly string[];
  readonly background: { readonly scripts: readonly string[] };
  readonly content_scripts: ExtensionManifest["content_scripts"];
  readonly devtools_page: string;
  readonly content_security_policy: { readonly extension_pages: string };
}

/**
 * Options of {@link createManifest}.
 *
 * @since 1.0.0
 */
export interface ManifestOptions {
  /** The extension's version, in the form `1.2.3` (Chromium requires it). */
  readonly version: string;
}

/**
 * Builds the manifest. Pure: the same options always produce the same object.
 *
 * @param options The version.
 * @returns The manifest, ready to serialize with `JSON.stringify`.
 * @example
 * import { createManifest } from "./manifest";
 *
 * const manifest = createManifest({ version: "1.0.0" });
 * manifest.permissions; // []
 * @since 1.0.0
 */
export function createManifest(options: ManifestOptions): ExtensionManifest {
  return {
    manifest_version: 3,
    name: "ShadowJS DevTools",
    version: options.version,
    description: "Development only: inspect a ShadowJS app running on localhost.",
    minimum_chrome_version: "111",
    permissions: [],
    background: { service_worker: FILES.background },
    content_scripts: [
      {
        matches: LOOPBACK_MATCHES,
        js: [FILES.content],
        run_at: "document_start",
        all_frames: false,
        world: "ISOLATED",
      },
      {
        matches: LOOPBACK_MATCHES,
        js: [FILES.pageMain],
        run_at: "document_start",
        all_frames: false,
        world: "MAIN",
      },
    ],
    devtools_page: FILES.devtoolsPage,
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'" },
  };
}

/**
 * Builds the Firefox manifest. Pure: the same options always produce the same object. The content scripts,
 * the devtools page and the policy are the Chromium manifest's own values; only the background, the add-on
 * settings and the host permissions differ (see the module comment).
 *
 * @param options The version.
 * @returns The manifest, ready to serialize with `JSON.stringify`.
 * @example
 * import { createFirefoxManifest } from "./manifest";
 *
 * const manifest = createFirefoxManifest({ version: "1.0.0" });
 * manifest.background.scripts; // ["background.js"]
 * @since 1.0.0
 */
export function createFirefoxManifest(options: ManifestOptions): FirefoxManifest {
  const chromium = createManifest(options);
  return {
    manifest_version: 3,
    name: chromium.name,
    version: chromium.version,
    description: chromium.description,
    browser_specific_settings: {
      gecko: {
        id: GECKO_ID,
        strict_min_version: FIREFOX_MIN_VERSION,
        data_collection_permissions: { required: ["none"] },
      },
    },
    permissions: [],
    host_permissions: LOOPBACK_MATCHES,
    background: { scripts: [FILES.background] },
    content_scripts: chromium.content_scripts,
    devtools_page: chromium.devtools_page,
    content_security_policy: chromium.content_security_policy,
  };
}

/**
 * Builds the manifest of one target.
 *
 * @param target The browser.
 * @param options The version.
 * @returns The Chromium or the Firefox manifest.
 * @example
 * import { createManifestFor } from "./manifest";
 *
 * const firefox = createManifestFor("firefox", { version: "1.0.0" });
 * "background" in firefox && "scripts" in firefox.background; // true
 * @since 1.0.0
 */
export function createManifestFor(target: "chromium", options: ManifestOptions): ExtensionManifest;
export function createManifestFor(target: "firefox", options: ManifestOptions): FirefoxManifest;
export function createManifestFor(
  target: ExtensionTarget,
  options: ManifestOptions,
): ExtensionManifest | FirefoxManifest;
export function createManifestFor(
  target: ExtensionTarget,
  options: ManifestOptions,
): ExtensionManifest | FirefoxManifest {
  return target === "firefox" ? createFirefoxManifest(options) : createManifest(options);
}

/** Keys that would widen what the extension may do; the manifest never has them. */
const FORBIDDEN_KEYS = [
  "optional_permissions",
  "optional_host_permissions",
  "web_accessible_resources",
  "externally_connectable",
  "sandbox",
  "declarative_net_request",
  "chrome_url_overrides",
  "commands",
  "omnibox",
  "options_page",
  "options_ui",
  "side_panel",
  "sidebar_action",
  "action",
  "browser_action",
  "page_action",
];

/** What a source in the policy must not be: remote code, inline code, `eval` or a wildcard. */
const POLICY_BANNED = [
  "unsafe-eval",
  "unsafe-inline",
  "wasm-unsafe-eval",
  "unsafe-hashes",
  "http:",
  "https:",
  "ws:",
  "wss:",
  "data:",
  "blob:",
  "filesystem:",
  "*",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLocalFile(value: unknown): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !value.includes("://") &&
    !value.startsWith("/") &&
    !value.includes("..")
  );
}

/**
 * Checks a manifest against the extension's permission policy and lists every violation (empty when the
 * manifest is clean). The policy: Manifest V3; no API permissions; host access only to the loopback hosts of
 * {@link LOOPBACK_MATCHES}; content scripts only on those hosts, in the top frame; no web-accessible
 * resources and none of the other keys that widen reach; scripts named by local file only (no remote
 * code); an extension-pages policy with `script-src 'self'` and no `eval`, inline code, remote source or
 * wildcard. The build runs it on both manifests and fails on a violation.
 *
 * @param manifest A parsed manifest (any value; a non-object is one violation).
 * @returns The violations, as sentences.
 * @example
 * import { auditManifest, createManifest } from "./manifest";
 *
 * auditManifest(createManifest({ version: "1.0.0" })); // []
 * auditManifest({ manifest_version: 3, permissions: ["tabs"] }).length > 0; // true
 * @since 1.0.0
 */
export function auditManifest(manifest: unknown): string[] {
  if (!isRecord(manifest)) return ["The manifest is not an object."];
  const problems: string[] = [];
  if (manifest["manifest_version"] !== 3) problems.push("manifest_version must be 3.");
  const permissions = manifest["permissions"];
  if (!Array.isArray(permissions) || permissions.length > 0) {
    problems.push("permissions must be an empty list.");
  }
  for (const key of FORBIDDEN_KEYS) {
    if (key in manifest) problems.push(`The key "${key}" is not allowed.`);
  }
  const hosts = manifest["host_permissions"];
  if (hosts !== undefined) {
    if (!Array.isArray(hosts) || hosts.some((host) => !LOOPBACK_MATCHES.includes(host as string))) {
      problems.push("host_permissions may name only the loopback hosts.");
    }
  }
  const scripts = manifest["content_scripts"];
  if (!Array.isArray(scripts) || scripts.length === 0) {
    problems.push("content_scripts must be a non-empty list.");
  } else {
    for (const script of scripts) {
      if (!isRecord(script)) {
        problems.push("A content script entry is not an object.");
        continue;
      }
      const matches = script["matches"];
      if (!Array.isArray(matches) || matches.some((m) => !LOOPBACK_MATCHES.includes(m as string))) {
        problems.push("A content script may match only the loopback hosts.");
      }
      if (script["all_frames"] !== false) problems.push("A content script must be top frame only.");
      const files = script["js"];
      if (!Array.isArray(files) || !files.every(isLocalFile)) {
        problems.push("A content script must name local files only.");
      }
    }
  }
  const background = manifest["background"];
  if (!isRecord(background)) {
    problems.push("background is missing.");
  } else {
    const worker = background["service_worker"];
    const list = background["scripts"];
    const named = worker === undefined ? list : [worker];
    if (!Array.isArray(named) || named.length === 0 || !named.every(isLocalFile)) {
      problems.push("The background must name local files only.");
    }
  }
  if (!isLocalFile(manifest["devtools_page"])) problems.push("devtools_page must be a local file.");
  const policy = manifest["content_security_policy"];
  const pages = isRecord(policy) ? policy["extension_pages"] : undefined;
  if (typeof pages !== "string" || !pages.includes("script-src 'self'")) {
    problems.push("The extension-pages policy must have script-src 'self'.");
  } else {
    for (const banned of POLICY_BANNED) {
      if (pages.includes(banned))
        problems.push(`The extension-pages policy must not have ${banned}`);
    }
  }
  if (JSON.stringify(manifest).includes("<all_urls>")) problems.push("<all_urls> is not allowed.");
  return problems;
}
