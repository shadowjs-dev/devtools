/**
 * The timeline session: the state the Timeline tab shows. It owns the recorder, switches recording on and
 * off by attaching to and detaching from the event source, and holds an imported recording when one is
 * loaded. A session that never records attaches to nothing and allocates no buffer.
 *
 * @packageDocumentation
 */
import type { WireEvent } from "../../../src/protocol";
import {
  DEFAULT_CAPACITY,
  MAX_CAPACITY,
  type RecorderOptions,
  type TimelineData,
  TimelineRecorder,
} from "./recorder";
import type { EventSource } from "./tap";

/**
 * Options of {@link createTimelineSession}.
 *
 * @since 1.0.0
 */
export interface SessionOptions {
  /** Where the events come from. Without it recording is not available. */
  readonly events?: EventSource;
  /**
   * Entries kept.
   *
   * @default 10000
   */
  readonly capacity?: number;
  /** Names a node the recorder did not see created (see {@link RecorderOptions}). */
  readonly resolve?: RecorderOptions["resolve"];
}

/**
 * The session.
 *
 * @since 1.0.0
 */
export interface TimelineSession {
  /** True when an event source was given, so recording can start. */
  readonly available: boolean;
  /** True while events are being recorded. */
  readonly recording: boolean;
  /** True while the data on screen is an imported recording and not the live one. */
  readonly imported: boolean;
  /** Entries the live recording keeps at most. */
  readonly capacity: number;
  /** Events the recorder inspected (`0` until the first recording). */
  readonly received: number;
  /**
   * Starts recording. An imported recording is dropped first: the screen shows the live one again.
   *
   * @returns False when no event source is available.
   */
  start(): boolean;
  /** Stops recording. The entries stay. */
  stop(): void;
  /** Forgets the entries, and the imported recording if there is one. */
  clear(): void;
  /**
   * Changes how many entries the live recording keeps. It stops recording and clears the entries, because a
   * ring buffer cannot be resized in place.
   *
   * @param capacity An integer from 1 to {@link MAX_CAPACITY}.
   * @returns False (and nothing changes) for a value outside that range.
   */
  setCapacity(capacity: number): boolean;
  /**
   * Shows an imported recording. Recording stops: the live entries are kept for when the import is cleared.
   *
   * @param data Validated data (see `parseRecording`).
   */
  load(data: TimelineData): void;
  /** The data to show: the imported recording, or a copy of the live one. Cached until something changes. */
  data(): TimelineData;
  /**
   * Calls `listener` after every change (an event batch while recording, a start, a stop, a clear, a load).
   *
   * @returns The function that stops the calls.
   */
  subscribe(listener: () => void): () => void;
  /** Detaches from the event source and drops the listeners and the buffers. */
  dispose(): void;
}

/**
 * Creates a session.
 *
 * @param options The event source, the capacity and the name resolver.
 * @returns The session.
 * @throws {@link RangeError} When `capacity` is out of range.
 * @example
 * import { createTimelineSession } from "./session";
 *
 * const session = createTimelineSession({ capacity: 5000 });
 * session.start(); // false: no event source
 * @since 1.0.0
 */
export function createTimelineSession(options: SessionOptions = {}): TimelineSession {
  const resolve = options.resolve;
  const make = (capacity: number): TimelineRecorder =>
    new TimelineRecorder(resolve === undefined ? { capacity } : { capacity, resolve });
  let capacity = options.capacity ?? DEFAULT_CAPACITY;
  // Validate once, up front; the recorder itself is built on the first start.
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
    throw new RangeError(`Timeline capacity must be an integer from 1 to ${MAX_CAPACITY}.`);
  }
  let recorder: TimelineRecorder | null = null;
  let detach: (() => void) | null = null;
  let loaded: TimelineData | null = null;
  let cached: TimelineData | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const empty = (): TimelineData => ({ entries: [], labels: new Map(), dropped: 0, capacity });

  const changed = (): void => {
    cached = null;
    for (const listener of [...listeners]) listener();
  };
  const onEvents = (events: readonly WireEvent[]): void => {
    recorder?.feed(events);
    changed();
  };
  const detachNow = (): void => {
    detach?.();
    detach = null;
  };

  return {
    get available(): boolean {
      return options.events !== undefined;
    },
    get recording(): boolean {
      return detach !== null;
    },
    get imported(): boolean {
      return loaded !== null;
    },
    get capacity(): number {
      return capacity;
    },
    get received(): number {
      return recorder?.received ?? 0;
    },
    start(): boolean {
      if (disposed || options.events === undefined) return false;
      if (detach !== null) return true;
      loaded = null;
      recorder ??= make(capacity);
      recorder.start();
      detach = options.events(onEvents);
      changed();
      return true;
    },
    stop(): void {
      detachNow();
      recorder?.stop();
      changed();
    },
    clear(): void {
      loaded = null;
      recorder?.clear();
      changed();
    },
    setCapacity(next): boolean {
      if (!Number.isInteger(next) || next < 1 || next > MAX_CAPACITY) return false;
      detachNow();
      recorder = null;
      capacity = next;
      changed();
      return true;
    },
    load(data): void {
      detachNow();
      recorder?.stop();
      loaded = data;
      changed();
    },
    data(): TimelineData {
      if (loaded !== null) return loaded;
      cached ??= recorder === null ? empty() : recorder.snapshot();
      return cached;
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose(): void {
      disposed = true;
      detachNow();
      recorder = null;
      loaded = null;
      cached = null;
      listeners.clear();
    },
  };
}
