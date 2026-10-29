/**
 * The event tap: a transport wrapper that lets the timeline see the agent's event batches without a second
 * connection and without changing what the panel's backend receives. With no listener the tap forwards the
 * message and does nothing else.
 *
 * @packageDocumentation
 */
import { isWireEvent } from "../../../src/internal/wire-guard";
import { PROTOCOL_VERSION, type WireEvent } from "../../../src/protocol";
import { isAgentMessage, type Transport } from "../../../src/transport";

/**
 * A source of event batches: call it with a listener to start receiving, and call the result to stop.
 *
 * @since 1.0.0
 */
export type EventSource = (listener: (events: readonly WireEvent[]) => void) => () => void;

/**
 * The tap of {@link createEventTap}.
 *
 * @since 1.0.0
 */
export interface EventTap {
  /** Wraps a transport. The wrapper behaves exactly like the original for everything but the tap. */
  wrap(transport: Transport): Transport;
  /** Receives every batch of events the wrapped transport delivers from now on. */
  readonly subscribe: EventSource;
  /** How many listeners are attached. It is `0` while nobody records. */
  readonly listeners: number;
}

/**
 * Creates a tap. The batches reach a listener after the backend has applied them, so the backend's model
 * already holds the nodes they name. Only well-formed event messages of this protocol version are passed on.
 *
 * @returns The tap.
 * @example
 * import { createMemoryTransportPair } from "../../../src/transport";
 * import { createEventTap } from "./tap";
 *
 * const tap = createEventTap();
 * const [, panelSide] = createMemoryTransportPair();
 * const transport = tap.wrap(panelSide);
 * const stop = tap.subscribe((events) => console.log(events.length));
 * stop();
 * transport.close();
 * @since 1.0.0
 */
export function createEventTap(): EventTap {
  const listeners = new Set<(events: readonly WireEvent[]) => void>();
  return {
    get listeners(): number {
      return listeners.size;
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    wrap(transport): Transport {
      return {
        send: (message) => transport.send(message),
        close: () => transport.close(),
        listen: (handler) =>
          transport.listen((raw) => {
            handler(raw);
            if (listeners.size === 0) return;
            if (!isAgentMessage(raw) || raw.type !== "events" || raw.v !== PROTOCOL_VERSION) return;
            // The page is not trusted: the recorder reads only events that have the shape of an event.
            const events = raw.events.filter(isWireEvent);
            for (const listener of [...listeners]) listener(events);
          }),
      };
    },
  };
}
