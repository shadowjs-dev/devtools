import { PROTOCOL_VERSION } from "../../src/protocol";
import { CHANNEL, isAgentMessage, isPanelMessage, type Transport } from "../../src/transport";

/**
 * The name the content script opens its port with. The background pairs it with the panel of the same
 * tab.
 *
 * @since 1.0.0
 */
export const PAGE_PORT = "shadowjs-devtools-page";

/**
 * The name the devtools panel opens its port with. Its first message names the tab it inspects.
 *
 * @since 1.0.0
 */
export const PANEL_PORT = "shadowjs-devtools-panel";

/**
 * Most events one message from the page may carry. The agent sends batches of this size at most, so a
 * larger batch is not from the agent and is dropped.
 *
 * @since 1.0.0
 */
export const MAX_BATCH = 2000;

/**
 * Longest message the bridge forwards, in characters of its JSON text. A batch of `MAX_BATCH` events
 * with the longest previews the agent allows is well below it; anything larger is padding, not events.
 *
 * @since 1.0.0
 */
export const MAX_MESSAGE_CHARS = 1_000_000;

/**
 * The `type` of the inspection ping: the page's agent tells the panel that an inspection source changed,
 * and the panel asks for the sources again.
 *
 * @since 1.0.0
 */
export const INSPECTED_TYPE = "inspected";

/**
 * The inspection ping, as the page posts it and the relay forwards it.
 *
 * @since 1.0.0
 */
export interface InspectedPing {
  readonly channel: typeof CHANNEL;
  readonly v: number;
  readonly from: "agent";
  readonly type: typeof INSPECTED_TYPE;
}

/**
 * The inspection ping of this protocol version. It carries no data: the panel asks the agent for the
 * sources itself, so the ping cannot carry a value.
 *
 * @returns A new ping object.
 * @example
 * import { inspectedPing } from "./bridge";
 *
 * window.postMessage(inspectedPing(), location.origin);
 * @since 1.0.0
 */
export function inspectedPing(): InspectedPing {
  return { channel: CHANNEL, v: PROTOCOL_VERSION, from: "agent", type: INSPECTED_TYPE };
}

/**
 * True when `value` is exactly an inspection ping of this protocol version: no other keys, the channel,
 * the version, the sender and the type. A ping with anything more is not from the agent.
 *
 * @param value Anything a message carried.
 * @returns True for a ping.
 * @example
 * import { inspectedPing, isInspectedPing } from "./bridge";
 *
 * isInspectedPing(inspectedPing()); // true
 * @since 1.0.0
 */
export function isInspectedPing(value: unknown): value is InspectedPing {
  if (typeof value !== "object" || value === null) return false;
  if (Object.keys(value).length !== 4) return false;
  return (
    Reflect.get(value, "channel") === CHANNEL &&
    Reflect.get(value, "v") === PROTOCOL_VERSION &&
    Reflect.get(value, "from") === "agent" &&
    Reflect.get(value, "type") === INSPECTED_TYPE
  );
}

/**
 * The rate the bridge allows one page: a bucket of `burst` messages that refills at `perSecond`. The
 * defaults hold any normal agent (one batch per microtask, at most a few hundred per second in a busy
 * render) and stop a page that floods the panel.
 *
 * @since 1.0.0
 */
export interface FloodLimit {
  /** Messages the bucket holds: how many may arrive at once. */
  readonly burst: number;
  /** Messages added to the bucket each second. */
  readonly perSecond: number;
}

/**
 * The part of a `chrome.runtime.Port` the bridge uses. An `ExtensionPort` fits this shape.
 *
 * @since 1.0.0
 */
export interface RuntimePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  readonly onMessage: {
    addListener(listener: (message: unknown) => void): void;
    removeListener(listener: (message: unknown) => void): void;
  };
  readonly onDisconnect: { addListener(listener: () => void): void };
}

/**
 * The window the content script bridges: where the agent posts its messages, and where the panel's
 * requests are posted to. The content script's `window` fits this shape.
 *
 * @since 1.0.0
 */
export interface PageWindow {
  postMessage(message: unknown, targetOrigin: string): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/**
 * Options of {@link createPageBridge}.
 *
 * @since 1.0.0
 */
export interface PageBridgeOptions {
  /** The page's window. Only messages posted by this window are accepted. */
  readonly page: PageWindow;
  /** The origin of the page. Messages from any other origin are dropped. */
  readonly origin: string;
  /** Opens a port to the background. Called again after the port disconnects. */
  readonly connect: () => RuntimePort;
  /**
   * Milliseconds to wait before reconnecting after a disconnect.
   *
   * @default 500
   */
  readonly retryDelayMs?: number;
  /**
   * Consecutive reconnects without a message from the background before the bridge gives up.
   *
   * @default 20
   */
  readonly maxRetries?: number;
  /**
   * Runs `fn` after `ms` milliseconds. Defaults to `setTimeout`; tests pass their own.
   */
  readonly schedule?: (fn: () => void, ms: number) => void;
  /**
   * The clock of the rate limit, in milliseconds. Defaults to `performance.now`; tests pass their own.
   */
  readonly now?: () => number;
  /**
   * The rate limit of messages from the page. Defaults to a burst of 2000 and 1000 a second.
   */
  readonly flood?: FloodLimit;
}

/**
 * The content-script side of the bridge: a handle to stop it.
 *
 * @since 1.0.0
 */
export interface PageBridge {
  /** Stops relaying and closes the port. */
  stop(): void;
  /** True while a port to the background is open. */
  readonly connected: () => boolean;
  /** Messages from the page the bridge dropped for their rate, their size or their serialization. */
  readonly dropped: () => number;
}

/**
 * Relays messages between the page and the extension, in both directions. The page's agent posts
 * `agent` messages to its window; they are forwarded to the background only when the message came from
 * this window, from the page's origin, and has the shape of an agent message. The panel's requests come
 * the other way and are posted to the page only when they have the shape of a panel message. Everything
 * else is dropped, so the page cannot send the panel anything but an agent message, and the panel cannot
 * send the page anything but a panel message.
 *
 * When the port disconnects (the background was stopped by the browser), the bridge reconnects after
 * `retryDelayMs`, up to `maxRetries` times in a row without an answer.
 *
 * @param options The window, origin and port factory.
 * @returns The bridge handle.
 * @example
 * import { createPageBridge } from "./bridge";
 *
 * const bridge = createPageBridge({
 *   page: window,
 *   origin: location.origin,
 *   connect: () => chrome.runtime.connect({ name: "shadowjs-devtools-page" }),
 * });
 * @since 1.0.0
 */
export function createPageBridge(options: PageBridgeOptions): PageBridge {
  const delay = options.retryDelayMs ?? 500;
  const maxRetries = options.maxRetries ?? 20;
  const schedule = options.schedule ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clock = options.now ?? (() => performance.now());
  const burst = options.flood?.burst ?? 2000;
  const perSecond = options.flood?.perSecond ?? 1000;
  // A token bucket: a message costs one token, and the bucket refills at `perSecond`, up to `burst`.
  let tokens = burst;
  let refilledAt = clock();
  let dropped = 0;
  let port: RuntimePort | undefined;
  let stopped = false;
  let failures = 0;

  /** Takes a token for one message; false when the page has sent more than its rate allows. */
  const takeToken = (): boolean => {
    const now = clock();
    tokens = Math.min(burst, tokens + ((now - refilledAt) * perSecond) / 1000);
    refilledAt = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  /** True when the message's JSON text fits the limit. A message that cannot be serialized is not sent. */
  const fitsSize = (message: unknown): boolean => {
    try {
      return JSON.stringify(message).length <= MAX_MESSAGE_CHARS;
    } catch {
      // A cycle or a value JSON cannot hold: the agent never sends one, so the message is refused.
      return false;
    }
  };

  const fromPage = (event: MessageEvent): void => {
    if (stopped || port === undefined) return;
    if ((event.source as unknown) !== options.page) return;
    if (event.origin !== options.origin) return;
    const message: unknown = event.data;
    if (!isAgentMessage(message) && !isInspectedPing(message)) return;
    if (isAgentMessage(message) && message.type === "events" && message.events.length > MAX_BATCH) {
      return;
    }
    // Only a message that has the right shape costs a token, so spoofed messages cannot starve the agent.
    if (!fitsSize(message)) {
      dropped += 1;
      return;
    }
    if (!takeToken()) {
      dropped += 1;
      return;
    }
    port.postMessage(message);
  };

  const toPage = (message: unknown): void => {
    if (stopped) return;
    failures = 0;
    if (!isPanelMessage(message)) return;
    options.page.postMessage(message, options.origin);
  };

  const onDisconnect = (): void => {
    port = undefined;
    if (stopped) return;
    failures += 1;
    if (failures > maxRetries) return;
    schedule(open, delay);
  };

  function open(): void {
    if (stopped) return;
    let next: RuntimePort;
    try {
      next = options.connect();
    } catch {
      // The extension context went away (it was reloaded): nothing to talk to any more.
      failures += 1;
      if (failures <= maxRetries) schedule(open, delay);
      return;
    }
    port = next;
    next.onMessage.addListener(toPage);
    next.onDisconnect.addListener(onDisconnect);
  }

  options.page.addEventListener("message", fromPage);
  open();

  return {
    stop(): void {
      if (stopped) return;
      stopped = true;
      options.page.removeEventListener("message", fromPage);
      if (port !== undefined) {
        port.onMessage.removeListener(toPage);
        port.disconnect();
        port = undefined;
      }
    },
    connected: () => port !== undefined,
    dropped: () => dropped,
  };
}

/**
 * A devtools transport over an extension port, for the panel page. The panel's `connectRemote` sends
 * its requests through it and receives the agent's messages; `close` disconnects the port.
 *
 * @param port The port the panel opened to the background.
 * @returns The transport.
 * @example
 * import { connectRemote } from "@shadow-js/devtools";
 * import { createRuntimeTransport } from "./bridge";
 *
 * const backend = connectRemote(createRuntimeTransport(chrome.runtime.connect({ name: "shadowjs-devtools-panel" })));
 * @since 1.0.0
 */
export function createRuntimeTransport(port: RuntimePort): Transport {
  return {
    send(message): void {
      port.postMessage(message);
    },
    listen(handler): () => void {
      port.onMessage.addListener(handler);
      return () => port.onMessage.removeListener(handler);
    },
    close(): void {
      port.disconnect();
    },
  };
}
