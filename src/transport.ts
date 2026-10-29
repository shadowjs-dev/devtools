import type { Agent, AgentRequest, AgentResponse } from "./agent";
import type { Backend, PageHooks } from "./backend";
import { isModelState, isWireEvent } from "./internal/wire-guard";
import { InspectorModel, type ModelLimits, type ModelState } from "./model";
import { PROTOCOL_VERSION, type WireEvent } from "./protocol";

/**
 * The `channel` field every devtools message carries. It lets the messages share a `postMessage`
 * or `BroadcastChannel` with other traffic: anything without this value is ignored.
 *
 * @example
 * import { CHANNEL } from "@shadow-js/devtools";
 * window.addEventListener("message", (event: MessageEvent) => {
 *   if (event.data?.channel === CHANNEL) console.log("devtools message", event.data.type);
 * });
 * @since 1.0.0
 */
export const CHANNEL = "shadowjs-devtools";

/**
 * A message the agent side sends to the panel: the answer to a `hello`, a batch of events, or the
 * answer to a request. All fields are plain data.
 *
 * Every message {@link serveAgent} sends carries `instance`, a random id of that served agent. A reloaded
 * page starts a new agent with a new id, so a panel that sees the id change knows the state it holds is
 * from a page that is gone, even when the new agent's sequence numbers happen to be higher than the old
 * ones. The field is optional so that messages of an older agent still pass {@link isAgentMessage}.
 *
 * An answer whose JSON text is longer than {@link SINGLE_RESPONSE_CHARS} (the complete state of a very
 * busy page) is not one `response` message: the agent sends it as `chunk` messages of at most
 * {@link CHUNK_CHARS} characters each, and {@link connectRemote} joins them. Smaller answers keep the
 * single `response` message, so an older panel keeps working with a newer agent for everything it could
 * receive before.
 *
 * @since 1.0.0
 */
export type AgentMessage =
  | { channel: typeof CHANNEL; v: number; from: "agent"; type: "hello"; instance?: string }
  | {
      channel: typeof CHANNEL;
      v: number;
      from: "agent";
      type: "events";
      events: WireEvent[];
      instance?: string;
    }
  | {
      channel: typeof CHANNEL;
      v: number;
      from: "agent";
      type: "response";
      id: number;
      response: AgentResponse;
      instance?: string;
    }
  | {
      channel: typeof CHANNEL;
      v: number;
      from: "agent";
      type: "chunk";
      /** The id of the request the chunked answer belongs to. */
      id: number;
      /** The index of this piece, from 0. */
      part: number;
      /** How many pieces the answer has. */
      parts: number;
      /** The length of the whole JSON text, in characters: the panel checks the pieces add up to it. */
      size: number;
      /** This piece of the JSON text of the answer. */
      data: string;
      instance?: string;
    };

/**
 * A message the panel side sends to the agent: a `hello`, or a request. The agent answers a request
 * with a `response` that carries the same `id`. All fields are plain data.
 *
 * @since 1.0.0
 */
export type PanelMessage =
  | { channel: typeof CHANNEL; v: number; from: "panel"; type: "hello" }
  | {
      channel: typeof CHANNEL;
      v: number;
      from: "panel";
      type: "request";
      id: number;
      request: AgentRequest;
    };

/**
 * A duplex channel of plain messages. Implementations must deliver messages in order; they need not
 * be synchronous. `postMessage`, `MessagePort` and `BroadcastChannel` adapters are provided.
 *
 * @since 1.0.0
 */
export interface Transport {
  /**
   * Sends a message to the other end. The message must be plain data that can be structured-cloned.
   */
  send(message: unknown): void;
  /**
   * Starts delivering incoming messages to `handler`, in order.
   *
   * @returns A function that stops this listener.
   */
  listen(handler: (message: unknown) => void): () => void;
  /**
   * Releases what the transport holds. Closing a port or a `BroadcastChannel` closes it; a window
   * transport holds nothing and does nothing.
   */
  close(): void;
}

/**
 * Longest piece of a chunked answer, in characters of its JSON text. Twice this (every character escaped
 * when the message is serialized again) plus the envelope still fits the extension bridge's message cap,
 * so a chunk is never refused for its size.
 *
 * @example
 * CHUNK_CHARS; // 400000
 * @since 1.0.0
 */
export const CHUNK_CHARS = 400_000;

/**
 * Longest answer the agent still sends as one `response` message, in characters of its JSON text. It is
 * just below the extension bridge's cap for an answer; anything longer is sent as chunks.
 *
 * @example
 * SINGLE_RESPONSE_CHARS; // 15000000
 * @since 1.0.0
 */
export const SINGLE_RESPONSE_CHARS = 15_000_000;

/**
 * Most pieces one chunked answer may have. A panel ignores a chunk that claims more.
 *
 * @example
 * MAX_CHUNKS; // 1024
 * @since 1.0.0
 */
export const MAX_CHUNKS = 1024;

/**
 * Longest chunked answer a panel assembles, in characters of its JSON text. A declared size above it is
 * refused at the first chunk, before anything is kept.
 *
 * @example
 * MAX_ASSEMBLED_CHARS; // 256000000
 * @since 1.0.0
 */
export const MAX_ASSEMBLED_CHARS = 256_000_000;

/**
 * Most chunked answers a panel assembles at the same time. The oldest is given up when another starts.
 *
 * @example
 * MAX_OPEN_CHUNK_SETS; // 4
 * @since 1.0.0
 */
export const MAX_OPEN_CHUNK_SETS = 4;

/**
 * How long a panel waits for the next chunk of an incomplete answer, in milliseconds. Each accepted
 * chunk restarts the wait; when it runs out, the request is answered with an error.
 *
 * @example
 * CHUNK_TIMEOUT_MS; // 30000
 * @since 1.0.0
 */
export const CHUNK_TIMEOUT_MS = 30_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEnvelope(value: unknown, from: "agent" | "panel"): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    value["channel"] === CHANNEL &&
    value["from"] === from &&
    typeof value["v"] === "number" &&
    typeof value["type"] === "string"
  );
}

/**
 * True for a well-formed message sent by an agent. Anything else on the channel is ignored. The check
 * covers the envelope (`channel`, `from`, `v`, `type`) and the fields each message type needs, including
 * the bounds of a `chunk` (piece number below the count, count up to {@link MAX_CHUNKS}, text up to
 * {@link CHUNK_CHARS}). It does not validate every event inside an `events` message.
 *
 * @param value A received message.
 * @returns True when `value` is an {@link AgentMessage}.
 * @example
 * import { CHANNEL, isAgentMessage } from "@shadow-js/devtools";
 * isAgentMessage({ channel: CHANNEL, v: 1, from: "agent", type: "hello" }); // true
 * isAgentMessage({ channel: CHANNEL, v: 1, from: "panel", type: "hello" }); // false
 * @since 1.0.0
 */
export function isAgentMessage(value: unknown): value is AgentMessage {
  if (!isEnvelope(value, "agent")) return false;
  switch (value["type"]) {
    case "hello":
      return true;
    case "events":
      return Array.isArray(value["events"]);
    case "response":
      return typeof value["id"] === "number" && isRecord(value["response"]);
    case "chunk": {
      const { id, part, parts, size, data } = value;
      return (
        typeof id === "number" &&
        typeof part === "number" &&
        typeof parts === "number" &&
        typeof size === "number" &&
        typeof data === "string" &&
        Number.isInteger(part) &&
        Number.isInteger(parts) &&
        Number.isInteger(size) &&
        parts >= 1 &&
        parts <= MAX_CHUNKS &&
        part >= 0 &&
        part < parts &&
        size >= 0 &&
        data.length <= CHUNK_CHARS
      );
    }
    default:
      return false;
  }
}

/**
 * True for a well-formed message sent by a panel. Anything else on the channel is ignored. The check
 * covers the envelope and the fields each message type needs, including the request's `type`.
 *
 * @param value A received message.
 * @returns True when `value` is a {@link PanelMessage}.
 * @example
 * import { CHANNEL, isPanelMessage } from "@shadow-js/devtools";
 * isPanelMessage({ channel: CHANNEL, v: 1, from: "panel", type: "hello" }); // true
 * isPanelMessage({ channel: CHANNEL, v: 1, from: "agent", type: "hello" }); // false
 * @since 1.0.0
 */
export function isPanelMessage(value: unknown): value is PanelMessage {
  if (!isEnvelope(value, "panel")) return false;
  switch (value["type"]) {
    case "hello":
      return true;
    case "request":
      return (
        typeof value["id"] === "number" &&
        isRecord(value["request"]) &&
        typeof value["request"]["type"] === "string"
      );
    default:
      return false;
  }
}

/**
 * Two connected in-memory transports, for tests and for connecting an agent and a panel inside one
 * page. Messages are structured-cloned, so anything that is not plain serializable data fails here
 * exactly as it would over `postMessage`. Closing either end closes both.
 *
 * @returns `[agentSide, panelSide]`.
 * @example
 * import { connectRemote, createAgent, createMemoryTransportPair, serveAgent } from "@shadow-js/devtools";
 * const [agentSide, panelSide] = createMemoryTransportPair();
 * const stop = serveAgent(createAgent(), agentSide);
 * const backend = connectRemote(panelSide);
 * await backend.ready;
 * stop();
 * @since 1.0.0
 */
export function createMemoryTransportPair(): [Transport, Transport] {
  const handlers: [Set<(message: unknown) => void>, Set<(message: unknown) => void>] = [
    new Set(),
    new Set(),
  ];
  let closed = false;
  const side = (index: 0 | 1): Transport => ({
    send(message): void {
      if (closed) return;
      const copy = structuredClone(message);
      for (const handler of [...handlers[index === 0 ? 1 : 0]]) handler(copy);
    },
    listen(handler): () => void {
      handlers[index].add(handler);
      return () => {
        handlers[index].delete(handler);
      };
    },
    close(): void {
      closed = true;
      handlers[0].clear();
      handlers[1].clear();
    },
  });
  return [side(0), side(1)];
}

/**
 * The part of a `MessagePort` the adapter uses. A `MessageChannel` end, a worker port and an
 * extension port all fit this shape.
 *
 * @since 1.0.0
 */
export interface MessagePortLike {
  /**
   * Posts a message to the other end of the port.
   */
  postMessage(message: unknown): void;
  /**
   * Adds a listener for incoming messages.
   */
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  /**
   * Removes a listener added with `addEventListener`.
   */
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  /**
   * Starts the port. The adapter calls it after it adds a listener. Optional.
   */
  start?(): void;
  /**
   * Closes the port. Optional.
   */
  close?(): void;
}

/**
 * A transport over a `MessagePort`: a `MessageChannel` end, a worker port or an extension port.
 * Incoming messages reach the listeners registered with `listen`. `close` closes the port when it
 * supports closing.
 *
 * @param port The port.
 * @returns The transport.
 * @example
 * import { connectRemote, createAgent, createPortTransport, serveAgent } from "@shadow-js/devtools";
 * const channel = new MessageChannel();
 * serveAgent(createAgent(), createPortTransport(channel.port1));
 * const backend = connectRemote(createPortTransport(channel.port2));
 * await backend.ready;
 * @since 1.0.0
 */
export function createPortTransport(port: MessagePortLike): Transport {
  return {
    send(message): void {
      port.postMessage(message);
    },
    listen(handler): () => void {
      const listener = (event: { data: unknown }): void => handler(event.data);
      port.addEventListener("message", listener);
      port.start?.();
      return () => port.removeEventListener("message", listener);
    },
    close(): void {
      port.close?.();
    },
  };
}

/**
 * The part of a `Window` the adapter uses: its `postMessage`. A `WindowProxy` such as
 * `iframe.contentWindow` fits this shape.
 *
 * @since 1.0.0
 */
export interface WindowLike {
  /**
   * Posts a message to the window. The adapter always passes a real origin as `targetOrigin`.
   */
  postMessage(message: unknown, targetOrigin: string): void;
}

/**
 * The part of the receiving window the adapter uses: its `message` listeners. `globalThis` in a page
 * or a frame fits this shape.
 *
 * @since 1.0.0
 */
export interface WindowEvents {
  /**
   * Adds a listener for `message` events.
   */
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  /**
   * Removes a listener added with `addEventListener`.
   */
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/**
 * Options of {@link createWindowTransport}.
 *
 * @since 1.0.0
 */
export interface WindowTransportOptions {
  /**
   * The window to talk to: the page being inspected, or the panel's frame.
   */
  target: WindowLike;
  /**
   * The origin of `target`. It is used as `targetOrigin` and to check where messages come from. Never
   * `"*"`: {@link createWindowTransport} refuses it.
   */
  origin: string;
  /**
   * Where messages arrive.
   *
   * @default globalThis
   */
  receiver?: WindowEvents;
}

/**
 * A transport over `window.postMessage` between a page and a panel in another window or frame (a
 * DevTools extension page, a popup). Both sides call it, each naming the other window and its origin.
 * Messages are sent only to `target`, with `origin` as the target origin. Incoming messages are
 * delivered only when their origin equals `origin` and their source is `target`; all others are
 * ignored.
 *
 * @param options Target window, its origin and the receiving window.
 * @returns The transport.
 * @throws {TypeError} When `origin` is `"*"`: the messages would reach any origin.
 * @example
 * import { createAgent, createWindowTransport, serveAgent } from "@shadow-js/devtools";
 * const frame = document.querySelector("iframe");
 * if (frame?.contentWindow) {
 *   const transport = createWindowTransport({ target: frame.contentWindow, origin: "https://panel.example" });
 *   serveAgent(createAgent(), transport);
 * }
 * @since 1.0.0
 */
export function createWindowTransport(options: WindowTransportOptions): Transport {
  if (options.origin === "*")
    throw new TypeError('createWindowTransport: pass the real origin, not "*".');
  const receiver: WindowEvents = options.receiver ?? (globalThis as unknown as WindowEvents);
  return {
    send(message): void {
      options.target.postMessage(message, options.origin);
    },
    listen(handler): () => void {
      const listener = (event: MessageEvent): void => {
        if (event.origin !== options.origin) return;
        if ((event.source as unknown) !== options.target) return;
        handler(event.data);
      };
      receiver.addEventListener("message", listener);
      return () => receiver.removeEventListener("message", listener);
    },
    close(): void {
      // The window belongs to the page; nothing to release.
    },
  };
}

/**
 * The part of `BroadcastChannel` the adapter uses.
 *
 * @since 1.0.0
 */
export interface BroadcastChannelLike {
  /**
   * Posts a message to every other channel object with the same name.
   */
  postMessage(message: unknown): void;
  /**
   * Adds a listener for incoming messages.
   */
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  /**
   * Removes a listener added with `addEventListener`.
   */
  removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  /**
   * Closes the channel object.
   */
  close(): void;
}

/**
 * A transport over a `BroadcastChannel`, for a panel in another tab or window of the same origin.
 * Several panels can listen to one agent; each message goes to all of them.
 *
 * @param name Channel name. Both sides use the same.
 * @param factory Creates the channel (default `new BroadcastChannel(name)`).
 * @returns The transport.
 * @example
 * import { connectRemote, createBroadcastChannelTransport } from "@shadow-js/devtools";
 * const backend = connectRemote(createBroadcastChannelTransport("shadowjs-devtools"));
 * await backend.ready;
 * @since 1.0.0
 */
export function createBroadcastChannelTransport(
  name: string,
  factory: (name: string) => BroadcastChannelLike = (n) => new BroadcastChannel(n),
): Transport {
  const channel = factory(name);
  return {
    send(message): void {
      channel.postMessage(message);
    },
    listen(handler): () => void {
      const listener = (event: { data: unknown }): void => handler(event.data);
      channel.addEventListener("message", listener);
      return () => channel.removeEventListener("message", listener);
    },
    close(): void {
      channel.close();
    },
  };
}

/**
 * Options of {@link serveAgent}: the page-side hooks and the batch size.
 *
 * @since 1.0.0
 */
export interface ServeOptions extends PageHooks {
  /**
   * Largest event batch sent in one message.
   *
   * @default 2000
   */
  batch?: number;
  /**
   * The id this served agent puts on every message it sends (see {@link AgentMessage}). Leave it unset:
   * a random id is made for each call. Tests set it to get a known value.
   */
  instance?: string;
  /**
   * Longest piece of a chunked answer, in characters. Values above {@link CHUNK_CHARS} are lowered to
   * it, because the panel and the bridge refuse larger pieces.
   *
   * @default CHUNK_CHARS
   */
  chunkChars?: number;
  /**
   * Longest answer sent as one message, in characters of its JSON text. A longer one is sent as chunks.
   *
   * @default SINGLE_RESPONSE_CHARS
   */
  singleResponseChars?: number;
}

/**
 * A random id for one served agent. `crypto.randomUUID` needs a secure context, so a page on plain
 * http falls back to `getRandomValues`, and then to a time-and-`Math.random` mix: the id only has to
 * differ between two agent starts, it is not a secret.
 */
function newInstanceId(): string {
  const webCrypto: Crypto | undefined = (globalThis as { crypto?: Crypto }).crypto;
  if (typeof webCrypto?.randomUUID === "function") return webCrypto.randomUUID();
  if (typeof webCrypto?.getRandomValues === "function") {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Longest instance id the panel keeps: an id from the page is untrusted data. */
const MAX_INSTANCE_CHARS = 128;

/** The instance id a message carries, or `undefined` when it has none or the value is not a usable id. */
function instanceOf(message: AgentMessage): string | undefined {
  const id: unknown = message.instance;
  return typeof id === "string" && id.length > 0 && id.length <= MAX_INSTANCE_CHARS
    ? id
    : undefined;
}

/** Longest error text the panel keeps from an answer: the text is untrusted data. */
const MAX_ERROR_CHARS = 500;

/**
 * Cuts an answer into pieces when its JSON text is longer than `singleChars`. Returns `undefined` for an answer that
 * goes in one message, a string (the reason) when it cannot be serialized, and the pieces otherwise. A cut never
 * falls between the two halves of a surrogate pair, so every piece is well-formed text.
 */
function splitAnswer(
  response: AgentResponse,
  pieceChars: number,
  singleChars: number,
): undefined | string | { texts: string[]; size: number } {
  let text: string;
  try {
    text = JSON.stringify(response);
  } catch (error) {
    // A cycle or a BigInt: the panel gets the reason instead of a message the transport would throw on.
    return `The page's answer could not be serialized: ${errorText(error)}`.slice(
      0,
      MAX_ERROR_CHARS,
    );
  }
  if (text.length <= singleChars) return undefined;
  if (text.length > MAX_ASSEMBLED_CHARS || Math.ceil(text.length / pieceChars) > MAX_CHUNKS) {
    return "The page's answer is larger than the panel accepts.";
  }
  const texts: string[] = [];
  for (let start = 0; start < text.length; ) {
    let end = Math.min(text.length, start + pieceChars);
    const last = text.charCodeAt(end - 1);
    // Keep a pair together unless the piece is one unit long (then there is no room to move the cut).
    if (end < text.length && last >= 0xd800 && last <= 0xdbff && end - start > 1) end -= 1;
    texts.push(text.slice(start, end));
    start = end;
  }
  return { texts, size: text.length };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Exposes an agent over a transport: forwards its event stream to the panel and answers the panel's
 * requests. The agent keeps recording while no panel listens, and the stream is sent regardless. What
 * happens to events nobody receives depends on the transport. A `highlight` request is passed to
 * `options.highlight` and answered without reaching the agent. Stop serving with the returned function.
 *
 * @param agent The agent in the inspected page.
 * @param transport The channel to the panel.
 * @param options Page-side behavior (highlight overlay) and batch size.
 * @returns A function that stops serving.
 * @example
 * import { createAgent, createMemoryTransportPair, serveAgent } from "@shadow-js/devtools";
 * const [pageSide] = createMemoryTransportPair();
 * const stop = serveAgent(createAgent(), pageSide, { highlight: (id) => console.log("highlight", id) });
 * stop();
 * @since 1.0.0
 */
export function serveAgent(
  agent: Agent,
  transport: Transport,
  options: ServeOptions = {},
): () => void {
  const limit = options.batch ?? 2000;
  const instance = options.instance ?? newInstanceId();
  const pieceChars = Math.max(
    1,
    Math.min(Math.floor(options.chunkChars ?? CHUNK_CHARS), CHUNK_CHARS),
  );
  const singleChars = options.singleResponseChars ?? SINGLE_RESPONSE_CHARS;
  const send = (message: AgentMessage): void => transport.send({ ...message, instance });
  const answer = (id: number, response: AgentResponse): void => {
    const pieces = splitAnswer(response, pieceChars, singleChars);
    if (pieces === undefined) {
      send({
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        from: "agent",
        type: "response",
        id,
        response,
      });
      return;
    }
    if (typeof pieces === "string") {
      // Reported to the panel, which shows it, instead of thrown into the transport.
      send({
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        from: "agent",
        type: "response",
        id,
        response: { ok: false, error: pieces },
      });
      return;
    }
    for (let part = 0; part < pieces.texts.length; part += 1) {
      send({
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        from: "agent",
        type: "chunk",
        id,
        part,
        parts: pieces.texts.length,
        size: pieces.size,
        data: pieces.texts[part] ?? "",
      });
    }
  };
  const stopListening = transport.listen((raw) => {
    if (!isPanelMessage(raw)) return;
    if (raw.type === "hello") {
      send({ channel: CHANNEL, v: PROTOCOL_VERSION, from: "agent", type: "hello" });
      return;
    }
    const { request } = raw;
    let response: AgentResponse;
    if (request.type === "highlight") {
      options.highlight?.(request.id);
      response = { ok: true, result: null };
    } else {
      response = agent.handle(request);
    }
    answer(raw.id, response);
  });
  const stopStreaming = agent.subscribe((events) => {
    for (let i = 0; i < events.length; i += limit) {
      send({
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        from: "agent",
        type: "events",
        events: events.slice(i, i + limit) as WireEvent[],
      });
    }
  });
  return () => {
    stopListening();
    stopStreaming();
  };
}

/** A chunked answer being assembled by {@link connectRemote}. */
interface ChunkSet {
  /** The instance of the first piece: later pieces must come from the same agent. */
  readonly instance: string | undefined;
  readonly parts: number;
  /** The declared length of the whole text. */
  readonly size: number;
  readonly pieces: Array<string | undefined>;
  received: number;
  chars: number;
  timer: ReturnType<typeof setTimeout>;
}

/** Reads the JSON text of a chunked answer; what is not an answer becomes an error answer. */
function parseAnswer(text: string): AgentResponse {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: `The page's answer could not be read: ${errorText(error)}`.slice(0, MAX_ERROR_CHARS),
    };
  }
  if (isRecord(value) && !Array.isArray(value)) {
    if (value["ok"] === true) return { ok: true, result: value["result"] };
    if (value["ok"] === false && typeof value["error"] === "string") {
      return { ok: false, error: value["error"].slice(0, MAX_ERROR_CHARS) };
    }
  }
  return { ok: false, error: "The page's answer could not be read." };
}

/**
 * Most events {@link connectRemote} holds while it waits for the first complete state. The newest are
 * kept: the state names its own `seq`, and an event older than it is skipped anyway.
 */
const MAX_BUFFERED_EVENTS = 50_000;

/**
 * Options of {@link connectRemote}.
 *
 * @since 1.0.0
 */
export interface RemoteOptions {
  /**
   * Capacities of the panel's copy of the model (see {@link ModelLimits}). Fields that are not set keep
   * their defaults.
   */
  limits?: Partial<ModelLimits>;
  /**
   * How long to wait for the next piece of a chunked answer before giving the request up, in milliseconds.
   *
   * @default CHUNK_TIMEOUT_MS
   */
  chunkTimeoutMs?: number;
}

/**
 * Connects a panel to a remote agent: asks for the complete state, then applies the event stream
 * to a local model. Events that arrive before the state are buffered, and the ones the state already
 * contains are skipped (sequence numbers), so no event is lost or applied twice. Disposing the backend
 * closes the transport.
 *
 * When the agent cannot give its state (an answer the bridge refused as too large, or a state the panel
 * cannot read), `ready` stays pending and `backend.error()` returns the reason after a change notification,
 * so a panel can show it instead of waiting. A message from another agent instance (a reloaded page)
 * discards the state and asks for a new one.
 *
 * @param transport The channel to the agent.
 * @param options Model limits.
 * @returns A {@link Backend}.
 * @example
 * import { connectRemote, createBroadcastChannelTransport } from "@shadow-js/devtools";
 * const backend = connectRemote(createBroadcastChannelTransport("shadowjs-devtools"));
 * await backend.ready;
 * @since 1.0.0
 */
export function connectRemote(transport: Transport, options: RemoteOptions = {}): Backend {
  const model = new InspectorModel(options.limits);
  const listeners = new Set<() => void>();
  const waiting = new Map<
    number,
    {
      resolve: (response: AgentResponse) => void;
      reject: (error: Error) => void;
    }
  >();
  // Chunked answers being assembled, by request id. At most MAX_OPEN_CHUNK_SETS, each with a timer.
  const sets = new Map<number, ChunkSet>();
  const chunkTimeout = options.chunkTimeoutMs ?? CHUNK_TIMEOUT_MS;
  let buffered: WireEvent[] = [];
  let synced = false;
  let nextRequest = 1;
  let disposed = false;
  let notifyScheduled = false;
  // The id of the agent whose messages the panel has been following (see `AgentMessage.instance`).
  let instance: string | undefined;
  let failure: string | undefined;
  let resolveReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  const notify = (): void => {
    if (notifyScheduled) return;
    notifyScheduled = true;
    queueMicrotask(() => {
      notifyScheduled = false;
      if (disposed) return;
      for (const listener of listeners) listener();
    });
  };

  const send = (message: PanelMessage): void => transport.send(message);

  const dropSet = (id: number): void => {
    const set = sets.get(id);
    if (set === undefined) return;
    clearTimeout(set.timer);
    sets.delete(id);
  };
  const dropAllSets = (): void => {
    for (const id of [...sets.keys()]) dropSet(id);
  };
  /** Answers request `id` with `response` and forgets its pieces. */
  const settle = (id: number, response: AgentResponse): void => {
    dropSet(id);
    const entry = waiting.get(id);
    if (entry === undefined) return;
    waiting.delete(id);
    entry.resolve(response);
  };
  const giveUp = (id: number, error: string): void => settle(id, { ok: false, error });
  const armTimer = (id: number): ReturnType<typeof setTimeout> =>
    setTimeout(() => giveUp(id, "The page's answer did not arrive in full."), chunkTimeout);

  /** Takes one chunk of a chunked answer; joins the answer when the last piece is in. */
  const takeChunk = (
    raw: Extract<AgentMessage, { type: "chunk" }>,
    from: string | undefined,
  ): void => {
    let set = sets.get(raw.id);
    if (set === undefined) {
      if (raw.size > MAX_ASSEMBLED_CHARS) {
        giveUp(raw.id, "The page's answer is larger than the panel accepts.");
        return;
      }
      if (sets.size >= MAX_OPEN_CHUNK_SETS) {
        const oldest = sets.keys().next();
        if (oldest.done !== true) {
          giveUp(
            oldest.value,
            "The page's answer was given up on: too many answers were arriving at once.",
          );
        }
      }
      set = {
        instance: from,
        parts: raw.parts,
        size: raw.size,
        pieces: new Array<string | undefined>(raw.parts).fill(undefined),
        received: 0,
        chars: 0,
        timer: armTimer(raw.id),
      };
      sets.set(raw.id, set);
    } else if (set.instance !== from || set.parts !== raw.parts || set.size !== raw.size) {
      // Pieces of another agent, or of another cut of the answer, do not belong to this set.
      return;
    }
    if (set.pieces[raw.part] !== undefined) return;
    set.pieces[raw.part] = raw.data;
    set.received += 1;
    set.chars += raw.data.length;
    if (set.chars > set.size) {
      giveUp(raw.id, "The pieces of the page's answer did not match its declared size.");
      return;
    }
    clearTimeout(set.timer);
    set.timer = armTimer(raw.id);
    if (set.received < set.parts) return;
    const text = set.pieces.join("");
    if (text.length !== set.size) {
      giveUp(raw.id, "The pieces of the page's answer did not match its declared size.");
      return;
    }
    settle(raw.id, parseAnswer(text));
  };

  const applyState = (state: ModelState): void => {
    model.importState(state);
    failure = undefined;
    synced = true;
    const pending = buffered;
    buffered = [];
    for (const event of pending) model.apply(event);
    resolveReady();
    notify();
  };

  const request = (req: AgentRequest): Promise<AgentResponse> => {
    if (disposed) return Promise.reject(new Error("The devtools backend was disposed."));
    const id = nextRequest;
    nextRequest += 1;
    return new Promise<AgentResponse>((resolve, reject) => {
      waiting.set(id, { resolve, reject });
      send({
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        from: "panel",
        type: "request",
        id,
        request: req,
      });
    });
  };

  const stop = transport.listen((raw) => {
    if (!isAgentMessage(raw)) return;
    if (raw.v !== PROTOCOL_VERSION) return;
    const id = instanceOf(raw);
    if (raw.type === "chunk") {
      // A piece is only for a request this panel made, and only from the agent it follows. Anything else is
      // dropped before it can start a set or a timer. A piece of the agent that was replaced by a reload
      // must not make the panel switch back to it, which a whole message from a new agent does by design:
      // a new agent introduces itself with `hello`, events or an answer first.
      if (!waiting.has(raw.id)) return;
      if (instance !== undefined && id !== instance) return;
    }
    if (id !== undefined) {
      if (instance !== undefined && id !== instance) {
        // Another agent answers on the same channel: the page was reloaded. Its sequence numbers need not
        // start below the old ones (it may have recorded a lot before the panel noticed), so the id, not
        // the counter, tells the old state is stale.
        instance = id;
        synced = false;
        buffered = [];
        // Pieces of the old agent's answers can no longer complete anything.
        dropAllSets();
        sync();
      } else {
        instance = id;
      }
    }
    if (raw.type === "events") {
      // The page is not trusted by the tools that inspect it: an element that is not an event is skipped
      // here, so the model never reads a missing field and a `NaN` never reaches its sequence counter.
      const valid = raw.events.filter(isWireEvent);
      const first = valid[0];
      if (synced && first !== undefined && first.seq <= model.lastSeq) {
        // The agent's counter only grows, so a batch that starts at or below the last applied number is
        // from another agent: the inspected page was reloaded and its new agent counts from 1 again.
        // Ignoring it would keep the old page on screen, so the panel asks for the new state.
        synced = false;
        buffered = [];
        sync();
      }
      if (!synced) {
        // Bounded: a page whose state never arrives (a refused or oversized answer) must not fill the panel.
        for (const event of valid) buffered.push(event);
        if (buffered.length > MAX_BUFFERED_EVENTS) {
          buffered.splice(0, buffered.length - MAX_BUFFERED_EVENTS);
        }
        return;
      }
      for (const event of valid) model.apply(event);
      notify();
      return;
    }
    if (raw.type === "chunk") {
      takeChunk(raw, id);
      return;
    }
    if (raw.type === "response") {
      // A whole answer (or the bridge's refusal) ends any pieces collected for the same request.
      settle(raw.id, raw.response);
    }
  });

  const sync = (): void => {
    void request({ type: "snapshot" }).then(
      (response) => {
        if (response.ok && isModelState(response.result)) {
          applyState(response.result);
          return;
        }
        // Without this the panel would say "connecting" for good: tell it why there is no state.
        failure = response.ok
          ? "The page sent a state the panel cannot read."
          : String(response.error).slice(0, MAX_ERROR_CHARS);
        notify();
      },
      () => {
        // The only rejection is dispose(): there is nothing left to synchronize.
        synced = false;
      },
    );
  };

  send({ channel: CHANNEL, v: PROTOCOL_VERSION, from: "panel", type: "hello" });
  sync();

  return {
    model,
    ready,
    error: () => failure,
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    request(req): Promise<AgentResponse> {
      if (req.type === "clear") {
        // A clear empties the agent; the panel's copy must follow.
        return request(req).then((response) => {
          if (response.ok) {
            synced = false;
            sync();
          }
          return response;
        });
      }
      return request(req);
    },
    dispose(): void {
      disposed = true;
      stop();
      dropAllSets();
      listeners.clear();
      for (const entry of waiting.values())
        entry.reject(new Error("The devtools backend was disposed."));
      waiting.clear();
      transport.close();
    },
  };
}
