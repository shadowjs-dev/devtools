/**
 * The part of the WebExtension API the ShadowJS extension uses, declared here so the extension needs no type
 * package and no global is assumed at import time. Chromium exposes it as `chrome`; Firefox exposes the same
 * calls as `browser` (and, for these calls, as `chrome` too). {@link extensionApi} is the one place that picks
 * the namespace, so the rest of the extension is written once for both browsers.
 *
 * @since 1.0.0
 */

/**
 * An event with listeners, as `runtime.onConnect` is.
 *
 * @since 1.0.0
 */
export interface ExtensionEvent<Listener> {
  addListener(listener: Listener): void;
  removeListener(listener: Listener): void;
}

/**
 * A `runtime.Port`: one end of a connection between the extension's pages and scripts.
 *
 * @since 1.0.0
 */
export interface ExtensionPort {
  /** The name the connection was opened with. */
  readonly name: string;
  /** Who opened the connection. `tab` is set for content scripts. */
  readonly sender?: { readonly id?: string; readonly tab?: { readonly id?: number } };
  postMessage(message: unknown): void;
  disconnect(): void;
  readonly onMessage: ExtensionEvent<(message: unknown) => void>;
  readonly onDisconnect: ExtensionEvent<() => void>;
}

/**
 * The part of the WebExtension API the extension reads: its runtime (ports) and, on the devtools pages, the
 * devtools API.
 *
 * @since 1.0.0
 */
export interface ExtensionApi {
  readonly runtime: {
    readonly id: string;
    connect(info: { name: string }): ExtensionPort;
    readonly onConnect: ExtensionEvent<(port: ExtensionPort) => void>;
  };
  readonly devtools?: {
    readonly inspectedWindow: { readonly tabId: number };
    readonly panels: {
      create(title: string, icon: string, page: string, callback?: () => void): void;
    };
  };
}

function isEvent(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "addListener") === "function" &&
    typeof Reflect.get(value, "removeListener") === "function"
  );
}

function hasRuntime(api: unknown): boolean {
  const runtime: unknown =
    typeof api === "object" && api !== null ? Reflect.get(api, "runtime") : undefined;
  return (
    typeof runtime === "object" &&
    runtime !== null &&
    typeof Reflect.get(runtime, "connect") === "function" &&
    typeof Reflect.get(runtime, "id") === "string" &&
    isEvent(Reflect.get(runtime, "onConnect"))
  );
}

/**
 * Reads the extension API from `root`: the `browser` namespace when it is complete (Firefox), otherwise
 * `chrome` (Chromium). Both expose the calls the extension uses with the same names and shapes. Throws
 * outside an extension context, so a script loaded without the extension fails with a clear message.
 *
 * @param root The object that holds the namespaces (default `globalThis`).
 * @returns The API. It is a new object; the browser's own namespace is never written to.
 * @throws {Error} When neither namespace has a complete `runtime`.
 * @example
 * import { extensionApi } from "./extension-api";
 *
 * const api = extensionApi();
 * console.log(api.runtime.id);
 * @since 1.0.0
 */
export function extensionApi(root: object = globalThis): ExtensionApi {
  const browserApi: unknown = Reflect.get(root, "browser");
  const chromeApi: unknown = Reflect.get(root, "chrome");
  const api = hasRuntime(browserApi) ? browserApi : hasRuntime(chromeApi) ? chromeApi : undefined;
  if (typeof api !== "object" || api === null) {
    throw new Error("ShadowJS devtools: this script must run inside the extension.");
  }
  const devtools = Reflect.get(api, "devtools") as ExtensionApi["devtools"];
  return {
    runtime: Reflect.get(api, "runtime") as ExtensionApi["runtime"],
    ...(devtools === undefined ? {} : { devtools }),
  };
}
