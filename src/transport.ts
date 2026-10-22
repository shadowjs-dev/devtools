import type { Agent, AgentRequest, AgentResponse } from "./agent";
import type { Backend, PageHooks } from "./backend";
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
 * @since 1.0.0
 */
export type AgentMessage =
  | { channel: typeof CHANNEL; v: number; from: "agent"; type: "hello" }
  | { channel: typeof CHANNEL; v: number; from: "agent"; type: "events"; events: WireEvent[] }
  | {
      channel: typeof CHANNEL;
      v: number;
      from: "agent";
      type: "response";
      id: number;
      response: AgentResponse;
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
 * covers the envelope (`channel`, `from`, `v`, `type`) and the fields each message type needs. It does
 * not validate every event inside an `events` message.
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
  const send = (message: AgentMessage): void => transport.send(message);
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
    send({
      channel: CHANNEL,
      v: PROTOCOL_VERSION,
      from: "agent",
      type: "response",
      id: raw.id,
      response,
    });
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
}

/**
 * Connects a panel to a remote agent: asks for the complete state, then applies the event stream
 * to a local model. Events that arrive before the state are buffered, and the ones the state already
 * contains are skipped (sequence numbers), so no event is lost or applied twice. Disposing the backend
 * closes the transport.
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
    { resolve: (response: AgentResponse) => void; reject: (error: Error) => void }
  >();
  let buffered: WireEvent[] = [];
  let synced = false;
  let nextRequest = 1;
  let disposed = false;
  let notifyScheduled = false;
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

  const applyState = (state: ModelState): void => {
    model.importState(state);
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
    if (raw.type === "events") {
      if (!synced) {
        buffered.push(...raw.events);
        return;
      }
      for (const event of raw.events) model.apply(event);
      notify();
      return;
    }
    if (raw.type === "response") {
      const entry = waiting.get(raw.id);
      if (entry === undefined) return;
      waiting.delete(raw.id);
      entry.resolve(raw.response);
    }
  });

  const sync = (): void => {
    void request({ type: "snapshot" }).then(
      (response) => {
        if (response.ok) applyState(response.result as ModelState);
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
      listeners.clear();
      for (const entry of waiting.values())
        entry.reject(new Error("The devtools backend was disposed."));
      waiting.clear();
      transport.close();
    },
  };
}
