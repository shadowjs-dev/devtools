import { isAgentMessage, isPanelMessage } from "../../src/transport";
import { isInspectedPing, PAGE_PORT, PANEL_PORT, type RuntimePort } from "./bridge";

/**
 * A port the background receives: a `RuntimePort` plus the identity of its sender.
 *
 * @since 1.0.0
 */
export interface RelayPort extends RuntimePort {
  /** The name the port was opened with. */
  readonly name: string;
  /** Who opened the port. The relay accepts only this extension's own pages and scripts. */
  readonly sender?: { readonly id?: string; readonly tab?: { readonly id?: number } };
}

/**
 * Options of {@link createRelay}.
 *
 * @since 1.0.0
 */
export interface RelayOptions {
  /** The extension's id (`chrome.runtime.id`). Ports from any other sender are closed. */
  readonly extensionId: string;
}

/**
 * The background's relay. It pairs one page port (the content script of a tab) with one panel port
 * (the devtools panel inspecting that tab) and forwards messages between them, checking each one. A
 * new port for the same tab replaces the old one.
 *
 * @since 1.0.0
 */
export interface Relay {
  /**
   * Handles a new port: a page port (from a content script, with a tab) or a panel port (which must send
   * `{ type: "attach", tabId }` first). Any other port is closed.
   *
   * @param port The port the browser opened.
   */
  connect(port: RelayPort): void;
  /** Number of tabs with a page port. */
  readonly pages: () => number;
  /** Number of tabs with a panel port. */
  readonly panels: () => number;
}

function isTabId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * The answer to a panel's `{ type: "pages" }` request: the tabs that have a page port, sorted. A standalone
 * panel (one not opened from DevTools) uses it to find the page it inspects.
 *
 * @since 1.0.0
 */
export interface PagesReply {
  readonly type: "pages";
  readonly tabIds: readonly number[];
}

/**
 * True when a message from a panel asks for the list of pages.
 *
 * @param value A message a panel sent.
 * @returns True for `{ type: "pages" }` and nothing with more fields.
 * @since 1.0.0
 */
export function isPagesRequest(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === 1 &&
    Reflect.get(value, "type") === "pages"
  );
}

/**
 * True when `value` is a {@link PagesReply}. The panel checks the reply before it uses the ids.
 *
 * @param value A message from the background.
 * @returns True for a well-formed reply.
 * @since 1.0.0
 */
export function isPagesReply(value: unknown): value is PagesReply {
  if (typeof value !== "object" || value === null) return false;
  if (Reflect.get(value, "type") !== "pages") return false;
  const tabIds: unknown = Reflect.get(value, "tabIds");
  return Array.isArray(tabIds) && tabIds.every(isTabId);
}

/**
 * Creates the relay. The background's `runtime.onConnect` listener calls `connect` for every port.
 *
 * Forwarding checks each message: an agent message reaches the panel of its tab only when it has the
 * shape of an agent message, and a panel message reaches the page of its tab only when it has the shape
 * of a panel message. Nothing is stored beyond the two maps (one port per tab, so the size is bounded by
 * the tabs open), and a service-worker restart empties them: the pages and the panel reconnect.
 *
 * @param options The extension id.
 * @returns The relay.
 * @example
 * import { createRelay } from "./relay";
 *
 * const relay = createRelay({ extensionId: chrome.runtime.id });
 * chrome.runtime.onConnect.addListener((port) => relay.connect(port));
 * @since 1.0.0
 */
export function createRelay(options: RelayOptions): Relay {
  const pages = new Map<number, RelayPort>();
  const panels = new Map<number, RelayPort>();

  const connectPage = (port: RelayPort, tabId: number): void => {
    pages.get(tabId)?.disconnect();
    pages.set(tabId, port);
    port.onMessage.addListener((message) => {
      if (!isAgentMessage(message) && !isInspectedPing(message)) return;
      panels.get(tabId)?.postMessage(message);
    });
    port.onDisconnect.addListener(() => {
      if (pages.get(tabId) === port) pages.delete(tabId);
    });
  };

  const connectPanel = (port: RelayPort): void => {
    let attached: number | undefined;
    port.onMessage.addListener((message) => {
      if (isPagesRequest(message)) {
        const reply: PagesReply = {
          type: "pages",
          tabIds: [...pages.keys()].sort((a, b) => a - b),
        };
        port.postMessage(reply);
        return;
      }
      if (attached === undefined) {
        const hello = typeof message === "object" && message !== null ? message : undefined;
        const tabId: unknown = hello === undefined ? undefined : Reflect.get(hello, "tabId");
        if (hello === undefined || Reflect.get(hello, "type") !== "attach" || !isTabId(tabId)) {
          port.disconnect();
          return;
        }
        attached = tabId;
        panels.get(tabId)?.disconnect();
        panels.set(tabId, port);
        return;
      }
      if (!isPanelMessage(message)) return;
      pages.get(attached)?.postMessage(message);
    });
    port.onDisconnect.addListener(() => {
      if (attached !== undefined && panels.get(attached) === port) panels.delete(attached);
    });
  };

  return {
    connect(port): void {
      if (port.sender?.id !== options.extensionId) {
        port.disconnect();
        return;
      }
      if (port.name === PAGE_PORT) {
        const tabId = port.sender?.tab?.id;
        if (!isTabId(tabId)) {
          port.disconnect();
          return;
        }
        connectPage(port, tabId);
        return;
      }
      if (port.name === PANEL_PORT) {
        connectPanel(port);
        return;
      }
      port.disconnect();
    },
    pages: () => pages.size,
    panels: () => panels.size,
  };
}
