/**
 * The timeline recorder: turns the agent's event stream into a bounded list of timeline entries (signal
 * writes, computation runs with their durations, and flushes). Nothing here touches the DOM or a timer, and
 * nothing runs unless {@link TimelineRecorder.start} was called, so a panel that never records pays nothing.
 *
 * @packageDocumentation
 */
import type { WireEvent } from "../../../src/protocol";
import { RingBuffer } from "../../../src/ring";

/**
 * Entries kept by default. The newest are kept; older ones are overwritten and counted.
 *
 * @since 1.0.0
 */
export const DEFAULT_CAPACITY = 10_000;

/**
 * Most entries a recorder may keep, and most an imported recording may hold. It bounds memory whatever the
 * caller asks for.
 *
 * @since 1.0.0
 */
export const MAX_CAPACITY = 200_000;

/**
 * Most ids one entry names in `observers` or `sources`. The rest are cut, so one entry cannot grow without
 * bound.
 *
 * @since 1.0.0
 */
export const MAX_LINKS = 64;

/**
 * Most labels a recording keeps. A node past the limit is shown as `#id`.
 *
 * @since 1.0.0
 */
export const MAX_LABELS = 50_000;

/**
 * Longest label, in characters.
 *
 * @since 1.0.0
 */
export const MAX_LABEL_LENGTH = 200;

/**
 * A signal write: which signal, who wrote it and which computations were subscribed to it.
 *
 * @since 1.0.0
 */
export interface WriteEntry {
  readonly k: "write";
  /** Sequence number of the event (the agent's gapless counter). */
  readonly seq: number;
  /** Time of the write, in milliseconds on the agent's clock. */
  readonly t: number;
  /** The signal's node id. */
  readonly signal: number;
  /** The computation that wrote it, or `0` for a write from outside any computation. */
  readonly writer: number;
  /** Ids of the computations subscribed at the time (at most {@link MAX_LINKS}). */
  readonly observers: readonly number[];
}

/**
 * One run of a memo or effect.
 *
 * @since 1.0.0
 */
export interface RunEntry {
  readonly k: "run";
  readonly seq: number;
  /** Start of the run, in milliseconds on the agent's clock. */
  readonly t: number;
  /** How long the run took, in milliseconds. */
  readonly duration: number;
  /** The computation's node id. */
  readonly comp: number;
  /** False when the computation produced the same value as before. */
  readonly changed: boolean;
  /** Ids of the nodes the run read (at most {@link MAX_LINKS}). */
  readonly sources: readonly number[];
}

/**
 * One flush of the scheduler: the computations it ran, from its start to its end.
 *
 * @since 1.0.0
 */
export interface FlushEntry {
  readonly k: "flush";
  readonly seq: number;
  /** Start of the flush, in milliseconds on the agent's clock. */
  readonly t: number;
  /** End of the flush. */
  readonly end: number;
  /** Size of the render queue when the flush started. */
  readonly render: number;
  /** Size of the user queue when the flush started. */
  readonly user: number;
  /** Computations the flush ran. */
  readonly runs: number;
}

/**
 * One recorded entry.
 *
 * @since 1.0.0
 */
export type TimelineEntry = WriteEntry | RunEntry | FlushEntry;

/**
 * What a recorder (or an imported file) holds: the entries oldest first, the labels of the nodes they name,
 * and how many older entries were overwritten.
 *
 * @since 1.0.0
 */
export interface TimelineData {
  /** The entries, oldest first. */
  readonly entries: readonly TimelineEntry[];
  /** Display names by node id. */
  readonly labels: ReadonlyMap<number, string>;
  /** Entries overwritten because the buffer was full. */
  readonly dropped: number;
  /** The capacity of the buffer that held them. */
  readonly capacity: number;
}

/**
 * Options of {@link TimelineRecorder}.
 *
 * @since 1.0.0
 */
export interface RecorderOptions {
  /**
   * Entries kept (an integer from 1 to {@link MAX_CAPACITY}).
   *
   * @default 10000
   */
  readonly capacity?: number;
  /**
   * Names a node the recorder did not see created (it existed before recording started). Return
   * `undefined` when unknown.
   */
  readonly resolve?: (id: number) => string | undefined;
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= 0x7fffffff;
}

function finite(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ids(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const out: number[] = [];
  for (let i = 0; i < value.length && out.length < MAX_LINKS; i += 1) {
    const id: unknown = value[i];
    if (isId(id)) out.push(id);
  }
  return out;
}

/**
 * Cleans a label for display: control and bidirectional-override characters become spaces, and the text is
 * cut to {@link MAX_LABEL_LENGTH}. The panel shows labels as text, so this guards the reading, not the DOM.
 *
 * @param text Any string.
 * @returns The cleaned label.
 * @example
 * import { cleanLabel } from "./recorder";
 *
 * cleanLabel("a‮b"); // "a b"
 * @since 1.0.0
 */
export function cleanLabel(text: string): string {
  const cut = text.length > MAX_LABEL_LENGTH ? text.slice(0, MAX_LABEL_LENGTH) : text;
  let out = "";
  for (let i = 0; i < cut.length; i += 1) {
    const code = cut.charCodeAt(i);
    const hidden =
      code <= 0x1f ||
      (code >= 0x7f && code <= 0x9f) ||
      (code >= 0x202a && code <= 0x202e) ||
      (code >= 0x2066 && code <= 0x2069);
    out += hidden ? " " : (cut[i] ?? "");
  }
  return out;
}

/**
 * Records the timeline while it is on. Memory is bounded: the entries live in a {@link RingBuffer} of
 * `capacity` slots, each entry holds at most {@link MAX_LINKS} ids per list, and at most {@link MAX_LABELS}
 * labels are kept. While recording is off, {@link TimelineRecorder.feed} returns at once and the recorder
 * keeps nothing, so a caller that stops listening to the stream (as the panel does) costs nothing.
 *
 * @example
 * import { TimelineRecorder } from "./recorder";
 *
 * const recorder = new TimelineRecorder({ capacity: 1000 });
 * recorder.start();
 * recorder.feed([{ k: "write", seq: 1, t: 5, id: 3, preview: "1", writer: 0, observers: [4] }]);
 * recorder.snapshot().entries.length; // 1
 * @since 1.0.0
 */
export class TimelineRecorder {
  /** Entries kept at most. */
  readonly capacity: number;
  private readonly ring: RingBuffer<TimelineEntry>;
  private readonly names = new Map<number, string>();
  private readonly resolve: ((id: number) => string | undefined) | undefined;
  private on = false;
  private seen = 0;
  private openFlush: { t: number; render: number; user: number } | null = null;

  /**
   * @param options Capacity and the name resolver.
   * @throws {@link RangeError} When `capacity` is not an integer from 1 to {@link MAX_CAPACITY}.
   */
  constructor(options: RecorderOptions = {}) {
    const capacity = options.capacity ?? DEFAULT_CAPACITY;
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > MAX_CAPACITY) {
      throw new RangeError(`Timeline capacity must be an integer from 1 to ${MAX_CAPACITY}.`);
    }
    this.capacity = capacity;
    this.ring = new RingBuffer<TimelineEntry>(capacity);
    this.resolve = options.resolve;
  }

  /** True while the recorder keeps what it is fed. */
  get recording(): boolean {
    return this.on;
  }

  /** How many events were inspected while recording. It stays `0` for a recorder that never started. */
  get received(): number {
    return this.seen;
  }

  /** Entries held now. */
  get size(): number {
    return this.ring.size;
  }

  /** Entries overwritten because the buffer was full. */
  get dropped(): number {
    return this.ring.dropped;
  }

  /** Starts recording. Events fed before this call were not kept. */
  start(): void {
    this.on = true;
  }

  /** Stops recording. What was recorded stays until {@link TimelineRecorder.clear}. */
  stop(): void {
    this.on = false;
    this.openFlush = null;
  }

  /** Forgets the entries and the labels. The recording state stays as it is. */
  clear(): void {
    this.ring.clear();
    this.names.clear();
    this.openFlush = null;
  }

  /**
   * Keeps the entries of a batch of events. Events that are not writes, runs or flushes only teach the
   * recorder a name. Malformed events are skipped: the events come from the inspected page, which the panel
   * does not trust.
   *
   * @param events A batch of wire events, oldest first.
   */
  feed(events: readonly WireEvent[]): void {
    if (!this.on) return;
    for (const event of events) {
      this.seen += 1;
      if (typeof event === "object" && event !== null) this.record(event);
    }
  }

  /**
   * The recorded data: a copy of the entries (oldest first) and of the labels, safe to keep while the
   * recorder goes on.
   *
   * @returns The data.
   */
  snapshot(): TimelineData {
    const entries = this.ring.toArray();
    const labels = new Map<number, string>();
    for (const entry of entries) {
      for (const id of idsOf(entry)) {
        const label = this.names.get(id);
        if (label !== undefined) labels.set(id, label);
      }
    }
    return { entries, labels, dropped: this.ring.dropped, capacity: this.capacity };
  }

  private learn(id: number, label: string): void {
    if (!isId(id)) return;
    if (this.names.size >= MAX_LABELS && !this.names.has(id)) return;
    this.names.set(id, cleanLabel(label));
  }

  private known(id: number): void {
    if (!isId(id) || this.names.has(id) || this.resolve === undefined) return;
    const label = this.resolve(id);
    if (label !== undefined) this.learn(id, label);
  }

  private record(event: WireEvent): void {
    const raw = event as unknown as Record<string, unknown>;
    const id = raw["id"] as number;
    switch (event.k) {
      case "owner+":
        this.learn(id, nameOr(raw["name"], `${text(raw["label"], "owner")}#${id}`));
        return;
      case "signal+":
        this.learn(id, nameOr(raw["name"], `signal#${id}`));
        return;
      case "comp+":
        this.learn(id, nameOr(raw["name"], `${text(raw["kind"], "memo")}#${id}`));
        return;
      case "store+":
        this.learn(id, nameOr(raw["name"], `store#${id}`));
        return;
      case "resource":
        this.learn(id, nameOr(raw["name"], `resource#${id}`));
        return;
      case "mount":
        this.learn(id, `<${text(raw["name"], "Component")}>`);
        return;
      case "write": {
        if (!isId(id)) return;
        const observers = ids(raw["observers"]);
        const writer = isId(raw["writer"]) ? raw["writer"] : 0;
        this.known(id);
        if (writer !== 0) this.known(writer);
        for (const observer of observers) this.known(observer);
        this.ring.push({
          k: "write",
          seq: finite(raw["seq"]),
          t: finite(raw["t"]),
          signal: id,
          writer,
          observers,
        });
        return;
      }
      case "run": {
        if (!isId(id)) return;
        const sources = ids(raw["sources"]);
        this.known(id);
        for (const source of sources) this.known(source);
        this.ring.push({
          k: "run",
          seq: finite(raw["seq"]),
          t: finite(raw["start"], finite(raw["t"])),
          duration: Math.max(finite(raw["duration"]), 0),
          comp: id,
          changed: raw["changed"] !== false,
          sources,
        });
        return;
      }
      case "flush+":
        this.openFlush = {
          t: finite(raw["t"]),
          render: Math.max(finite(raw["render"]), 0),
          user: Math.max(finite(raw["user"]), 0),
        };
        return;
      case "flush-": {
        const open = this.openFlush;
        this.openFlush = null;
        if (open === null) return;
        const end = Math.max(finite(raw["t"]), open.t);
        this.ring.push({
          k: "flush",
          seq: finite(raw["seq"]),
          t: open.t,
          end,
          render: open.render,
          user: open.user,
          runs: Math.max(finite(raw["runs"]), 0),
        });
        return;
      }
      default:
        return;
    }
  }
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

function nameOr(value: unknown, fallback: string): string {
  return typeof value === "string" && value !== "" ? value : fallback;
}

/**
 * The node ids an entry names, for label lookup.
 *
 * @param entry An entry.
 * @returns The ids, with repeats.
 * @since 1.0.0
 */
export function idsOf(entry: TimelineEntry): number[] {
  switch (entry.k) {
    case "write":
      return entry.writer === 0
        ? [entry.signal, ...entry.observers]
        : [entry.signal, entry.writer, ...entry.observers];
    case "run":
      return [entry.comp, ...entry.sources];
    default:
      return [];
  }
}
