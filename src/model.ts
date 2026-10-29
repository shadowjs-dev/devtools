import { NO_ID, type WireEvent } from "./protocol";
import { RingBuffer } from "./ring";

/**
 * The kinds of node the inspector tracks: an owner, a signal, a memo, an effect, a resource or a store.
 *
 * @since 1.0.0
 */
export type NodeType = "owner" | "signal" | "memo" | "effect" | "resource" | "store";

/**
 * Everything the model knows about one node. Live nodes are in {@link InspectorModel.nodes}; disposed
 * ones are kept in {@link InspectorModel.graveyard} for a while.
 *
 * @since 1.0.0
 */
export interface NodeRecord {
  /** Id assigned by the agent. Never {@link NO_ID}. */
  id: number;
  /** What kind of node this is. */
  type: NodeType;
  /**
   * How the node is labeled: `owner` or `root` for owners, `memo` or `effect` for computations,
   * `signal`, `resource` or `store`, and `component` once a component was mounted on the owner.
   */
  label: string;
  /** The name the code gave the node, or `undefined`. */
  name: string | undefined;
  /** Owner id, or {@link NO_ID} for roots and detached nodes. */
  parent: number;
  /** False once the node left the live set: disposed, cascaded from its owner, or garbage collected. */
  alive: boolean;
  /** Sequence number of the event that created the node. */
  createdSeq: number;
  /** Time of the creation event, in milliseconds on the agent's clock. */
  createdAt: number;
  /** Sequence number of the event that removed the node, or 0 while it is alive. */
  disposedSeq: number;
  /** Computations: created in the render phase (the runtime's render flag). False otherwise. */
  render: boolean;
  /** True once a component was mounted on this owner. */
  isComponent: boolean;
  /** Time the component was mounted (agent clock, in milliseconds), or 0 when it never was. */
  mountedAt: number;
  /** Computations: ids of the nodes read by the last run. Empty for other nodes. */
  sources: number[];
  /** Ids of the computations that currently read this node. `null` when none ever did. */
  observers: Set<number> | null;
  /** Number of runs recorded. 0 for nodes that never run. */
  runs: number;
  /** Sum of the durations of all runs, in milliseconds. */
  totalDuration: number;
  /** Duration of the last run, in milliseconds. */
  lastDuration: number;
  /** Start of the last run, in milliseconds as the runtime reported it. */
  lastStart: number;
  /** Sequence number of the last run, or 0 when it never ran. */
  lastRunSeq: number;
  /**
   * Sequence number of the last change: a write for a signal, a run that changed the value for a
   * computation, or a state report for a resource. 0 when there was none.
   */
  lastChangeSeq: number;
  /** Signals: a short text of the current value. Empty for other nodes. */
  preview: string;
  /** Number of writes to a signal. 0 for other nodes. */
  writes: number;
  /** Sequence number of the last write, or 0 when never written. */
  lastWriteSeq: number;
  /**
   * Id of the computation that performed the last write, or {@link NO_ID} for a write from outside
   * any computation (an event handler, for example) and when the node was never written.
   */
  lastWriter: number;
  /** Resources: the last reported state, for example `"pending"` or `"ready"`. Empty for other nodes. */
  state: string;
}

/**
 * Why a computation ran. A run has one cause per source that changed since the computation's previous
 * run; see {@link RunRecord.causes}.
 *
 * @since 1.0.0
 */
export interface Cause {
  /**
   * `write` when the source is a signal that was written, `run` when the source is a memo or a
   * resource that changed, `initial` for the first run, and `unknown` when no recorded source changed.
   */
  kind: "write" | "run" | "initial" | "unknown";
  /** The source that changed: a signal or memo ({@link NO_ID} for `initial` and `unknown`). */
  id: number;
  /**
   * Sequence number of that change: the write or the run of the source, the creation for `initial`,
   * or the last run for `unknown`.
   */
  seq: number;
}

/**
 * One run of an effect or a memo, as recorded.
 *
 * @since 1.0.0
 */
export interface RunRecord {
  /** Sequence number of the run event. */
  seq: number;
  /** Time the event was received (agent clock, in milliseconds). */
  t: number;
  /** The computation that ran. */
  id: number;
  /** When the run started, in milliseconds as the runtime reported it. */
  start: number;
  /** How long the run took, in milliseconds. */
  duration: number;
  /** True when the computation's value changed. */
  changed: boolean;
  /** Sequence number of the flush it belongs to ({@link FlushRecord.seq}), or 0 when it ran outside a flush. */
  flush: number;
  /** Why it ran: see {@link Cause}. */
  causes: Cause[];
}

/**
 * One signal write, as recorded.
 *
 * @since 1.0.0
 */
export interface WriteRecord {
  /** Sequence number of the write event. */
  seq: number;
  /** Time the event was received (agent clock, in milliseconds). */
  t: number;
  /** The signal that was written. */
  id: number;
  /** A short text of the value written. */
  preview: string;
  /** Computation that wrote ({@link NO_ID}: outside code such as an event handler). */
  writer: number;
  /** Ids of the computations that read the signal when it was written. */
  observers: number[];
}

/**
 * One flush of the effect queues. A flush is recorded only when at least one of its runs is recorded.
 *
 * @since 1.0.0
 */
export interface FlushRecord {
  /** Sequence number of the flush-start event. */
  seq: number;
  /** The same value as {@link FlushRecord.seq}: the sequence number of the flush-start event. */
  startSeq: number;
  /** When the flush started (agent clock, in milliseconds). */
  start: number;
  /** When the flush ended (agent clock, in milliseconds). Equal to `start` while the flush is open. */
  end: number;
  /** Effects in the render queue when the flush started. */
  render: number;
  /** Effects in the user queue when the flush started. */
  user: number;
  /**
   * Runs recorded during the flush. The model counts them itself, so runs the agent ignored (the
   * tools' own) are not included. 0 while the flush is open.
   */
  runs: number;
  /** True until the flush-end event arrives. */
  open: boolean;
}

/**
 * An error the runtime reported.
 *
 * @since 1.0.0
 */
export interface ErrorRecord {
  /** Sequence number of the error event. */
  seq: number;
  /** Time the event was received (agent clock, in milliseconds). */
  t: number;
  /** The node the error came from, or {@link NO_ID} when it had no known owner. */
  id: number;
  /** The thrown value as text (see `errorMessage`). */
  message: string;
  /** A diagnostic code the runtime attached, for example `WRITE_IN_MEMO`, or `undefined`. */
  code: string | undefined;
}

/**
 * A hydration mismatch the runtime reported.
 *
 * @since 1.0.0
 */
export interface HydrationRecord {
  /** Sequence number of the mismatch event. */
  seq: number;
  /** Time the event was received (agent clock, in milliseconds). */
  t: number;
  /** What the runtime reported, as text. */
  message: string;
  /** The expected side, as text: a string, or the HTML of an element. Cut to 200 characters. */
  expected: string;
  /** The actual side, as text: a string, or the HTML of an element. Cut to 200 characters. */
  actual: string;
}

/**
 * Capacities of the model's bounded buffers. When passed to the constructor each field is optional;
 * the values left out are the defaults in {@link DEFAULT_LIMITS}.
 *
 * @since 1.0.0
 */
export interface ModelLimits {
  /**
   * Run records kept for timelines and causal chains.
   *
   * @default 20000
   */
  runs: number;
  /**
   * Write records kept for causal chains.
   *
   * @default 10000
   */
  writes: number;
  /**
   * Flush records kept.
   *
   * @default 1000
   */
  flushes: number;
  /**
   * Error records kept, and hydration records kept (each buffer on its own).
   *
   * @default 200
   */
  errors: number;
  /**
   * Disposed nodes kept so that old runs can still be named.
   *
   * @default 4000
   */
  graveyard: number;
  /**
   * Live nodes tracked. A node created beyond this count is counted in {@link InspectorModel.overflow}
   * and ignored; later events about it count as unknown.
   *
   * @default 100000
   */
  maxNodes: number;
}

/**
 * The default capacities of the model's buffers, used for each limit that the caller leaves out.
 *
 * @example
 * import { DEFAULT_LIMITS, foldEvents } from "@shadow-js/devtools";
 * import type { WireEvent } from "@shadow-js/devtools";
 *
 * const events: WireEvent[] = [];
 * const model = foldEvents(events, { ...DEFAULT_LIMITS, runs: 500 });
 * @since 1.0.0
 */
export const DEFAULT_LIMITS: Readonly<ModelLimits> = {
  /** Run records kept. @default 20000 */
  runs: 20_000,
  /** Write records kept. @default 10000 */
  writes: 10_000,
  /** Flush records kept. @default 1000 */
  flushes: 1_000,
  /** Error records kept, and hydration records kept. @default 200 */
  errors: 200,
  /** Disposed nodes kept. @default 4000 */
  graveyard: 4_000,
  /** Live nodes tracked. @default 100000 */
  maxNodes: 100_000,
};

/**
 * The JSON-safe state of a model: what the agent's `state()` returns (for a remote panel) and what
 * {@link InspectorModel.importState} accepts.
 *
 * @since 1.0.0
 */
export interface ModelState {
  /** Sequence number of the last applied event. */
  lastSeq: number;
  /** Nodes ignored because `maxNodes` was reached. */
  overflow: number;
  /** Events that referred to a node the model does not know. */
  unknown: number;
  /** Live nodes, in insertion order, with observers as arrays. */
  nodes: Array<Omit<NodeRecord, "observers"> & { observers: number[] }>;
  /** Disposed nodes, oldest first, with observers as arrays. */
  graveyard: Array<Omit<NodeRecord, "observers"> & { observers: number[] }>;
  /** Run records, oldest first. */
  runs: RunRecord[];
  /** Write records, oldest first. */
  writes: WriteRecord[];
  /** Flush records, oldest first. */
  flushes: FlushRecord[];
  /** Error records, oldest first. */
  errors: ErrorRecord[];
  /** Hydration records, oldest first. */
  hydration: HydrationRecord[];
}

function blank(id: number, type: NodeType, label: string, seq: number, t: number): NodeRecord {
  return {
    id,
    type,
    label,
    name: undefined,
    parent: NO_ID,
    alive: true,
    createdSeq: seq,
    createdAt: t,
    disposedSeq: 0,
    render: false,
    isComponent: false,
    mountedAt: 0,
    sources: [],
    observers: null,
    runs: 0,
    totalDuration: 0,
    lastDuration: 0,
    lastStart: 0,
    lastRunSeq: 0,
    lastChangeSeq: 0,
    preview: "",
    writes: 0,
    lastWriteSeq: 0,
    lastWriter: NO_ID,
    state: "",
  };
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The inspector's incremental model of the reactive graph: a pure fold over {@link WireEvent}s. The
 * same events always produce the same state, on the page or in a remote panel. `apply` is O(1) for
 * most events and O(sources) for a run; memory is bounded by {@link ModelLimits}.
 *
 * A development tool: its events come from the dev hook, which exists only in development builds.
 *
 * @example
 * import { InspectorModel, snapshotOf } from "@shadow-js/devtools";
 * import type { WireEvent } from "@shadow-js/devtools";
 *
 * const events: WireEvent[] = [];
 * const model = new InspectorModel();
 * for (const event of events) model.apply(event);
 * snapshotOf(model).counts.nodes;
 * @since 1.0.0
 */
export class InspectorModel {
  /** The capacities in effect: the defaults with the constructor's overrides applied. */
  readonly limits: Readonly<ModelLimits>;
  /** Live nodes by id. */
  readonly nodes: Map<number, NodeRecord> = new Map();
  /**
   * Recently disposed nodes, oldest first, kept so that history can still be named. Holds at most
   * `limits.graveyard` nodes.
   */
  readonly graveyard: Map<number, NodeRecord> = new Map();
  /** Run records, the newest kept (capacity `limits.runs`). */
  readonly runs: RingBuffer<RunRecord>;
  /** Write records, the newest kept (capacity `limits.writes`). */
  readonly writes: RingBuffer<WriteRecord>;
  /** Flush records, the newest kept (capacity `limits.flushes`). */
  readonly flushes: RingBuffer<FlushRecord>;
  /** Error records, the newest kept (capacity `limits.errors`). */
  readonly errors: RingBuffer<ErrorRecord>;
  /** Hydration records, the newest kept (capacity `limits.errors`). */
  readonly hydration: RingBuffer<HydrationRecord>;
  /** Sequence number of the last applied event. */
  lastSeq = 0;
  /** Nodes ignored because `maxNodes` was reached. */
  overflow = 0;
  /** Events that referred to a node the model does not know. */
  unknown = 0;
  /**
   * Changes whenever a component is mounted, unmounted or disposed. Cached component lookups from an
   * older epoch are recomputed.
   */
  componentEpoch = 0;
  /** Entries in the component lookup cache. Never more than `limits.maxNodes` after a lookup. */
  get componentCacheSize(): number {
    return this.componentCache.size;
  }

  /**
   * Called once for every node that leaves the live set, after it moved to the graveyard: when it is
   * disposed, or when its owner is disposed (cascade). The agent uses it to drop its own references.
   */
  onBury: ((record: NodeRecord) => void) | undefined;
  private openFlush: FlushRecord | null = null;
  private flushRuns = 0;
  /** Signals, stores and resources by owner: they have no lifecycle event of their own. */
  private readonly leaves: Map<number, number[]> = new Map();
  private readonly componentCache: Map<number, { epoch: number; component: number }> = new Map();

  /**
   * @param limits Overrides for the buffer capacities. Values left out take the defaults in
   * {@link DEFAULT_LIMITS}.
   */
  constructor(limits: Partial<ModelLimits> = {}) {
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.runs = new RingBuffer(this.limits.runs);
    this.writes = new RingBuffer(this.limits.writes);
    this.flushes = new RingBuffer(this.limits.flushes);
    this.errors = new RingBuffer(this.limits.errors);
    this.hydration = new RingBuffer(this.limits.errors);
  }

  /**
   * The node with this id: alive, or recently disposed (in the graveyard).
   *
   * @param id The node id.
   * @returns The record, or `undefined` when the model does not know the id.
   */
  node(id: number): NodeRecord | undefined {
    return this.nodes.get(id) ?? this.graveyard.get(id);
  }

  private create(
    event: WireEvent & { id: number },
    type: NodeType,
    label: string,
  ): NodeRecord | null {
    if (this.nodes.size >= this.limits.maxNodes) {
      this.overflow += 1;
      return null;
    }
    const record = blank(event.id, type, label, event.seq, event.t);
    this.nodes.set(event.id, record);
    return record;
  }

  /** Remembers that a leaf node (signal, store, resource) belongs to `owner`. */
  private addLeaf(owner: number, id: number): void {
    if (owner === NO_ID) return;
    let list = this.leaves.get(owner);
    if (list === undefined) {
      list = [];
      this.leaves.set(owner, list);
    }
    list.push(id);
    // Leaves that died on their own (garbage collected) would pile up on a long-lived owner.
    if (list.length > 1024 && list.length % 1024 === 0) {
      const alive = list.filter((leaf) => this.nodes.has(leaf));
      list.length = 0;
      list.push(...alive);
    }
  }

  private bury(record: NodeRecord, seq: number): void {
    // Iterative: the cascade follows owner -> leaves only, but disposal order is user controlled.
    const stack: NodeRecord[] = [record];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined) break;
      if (!this.nodes.has(next.id)) continue;
      next.alive = false;
      next.disposedSeq = seq;
      this.nodes.delete(next.id);
      if (next.sources.length > 0) this.setSources(next, []);
      if (next.observers !== null) {
        for (const observer of next.observers) {
          const reader = this.nodes.get(observer);
          if (reader !== undefined) reader.sources = reader.sources.filter((id) => id !== next.id);
        }
      }
      next.observers = null;
      this.graveyard.set(next.id, next);
      this.trimGraveyard();
      this.componentCache.delete(next.id);
      const owned = this.leaves.get(next.id);
      if (owned !== undefined) {
        this.leaves.delete(next.id);
        for (const leafId of owned) {
          const leaf = this.nodes.get(leafId);
          if (leaf !== undefined) stack.push(leaf);
        }
      }
      this.onBury?.(next);
    }
  }

  /** Drops the oldest disposed nodes until the graveyard holds at most `limits.graveyard`. */
  private trimGraveyard(): void {
    // A loop, not one deletion: a state imported from a larger model starts above the limit.
    while (this.graveyard.size > this.limits.graveyard) {
      const oldest = this.graveyard.keys().next();
      if (oldest.done === true) return;
      this.graveyard.delete(oldest.value);
    }
  }

  private setSources(record: NodeRecord, next: readonly number[]): void {
    const previous = record.sources;
    if (sameIds(previous, next)) return;
    const keep = new Set(next);
    for (const id of previous) {
      if (keep.has(id)) continue;
      this.nodes.get(id)?.observers?.delete(record.id);
    }
    for (const id of next) {
      const source = this.nodes.get(id);
      if (source === undefined) continue;
      if (source.observers === null) source.observers = new Set();
      source.observers.add(record.id);
    }
    record.sources = next.slice();
  }

  /**
   * Applies one event. Events must arrive in `seq` order: an event whose `seq` is not greater than
   * {@link InspectorModel.lastSeq} is ignored, so a remote panel can receive events it already holds.
   * An event about a node the model does not know is counted in `unknown`. A node created beyond
   * `maxNodes` is counted in `overflow` and ignored.
   *
   * @param event The event, with the sequence number and time the agent gave it.
   */
  apply(event: WireEvent): void {
    if (event.seq <= this.lastSeq) return;
    this.lastSeq = event.seq;
    switch (event.k) {
      case "owner+": {
        const record = this.create(event, "owner", event.label);
        if (record === null) return;
        record.parent = event.parent;
        record.name = event.name;
        return;
      }
      case "owner-":
      case "comp-": {
        const record = this.nodes.get(event.id);
        if (record === undefined) {
          this.unknown += 1;
          return;
        }
        if (record.isComponent) this.componentEpoch += 1;
        this.bury(record, event.seq);
        return;
      }
      case "signal+": {
        const record = this.create(event, "signal", "signal");
        if (record === null) return;
        record.parent = event.owner;
        record.name = event.name;
        record.preview = event.preview;
        this.addLeaf(event.owner, event.id);
        return;
      }
      case "write": {
        const record = this.nodes.get(event.id);
        if (record === undefined) {
          this.unknown += 1;
          return;
        }
        record.writes += 1;
        record.preview = event.preview;
        record.lastWriteSeq = event.seq;
        record.lastChangeSeq = event.seq;
        record.lastWriter = event.writer;
        this.writes.push({
          seq: event.seq,
          t: event.t,
          id: event.id,
          preview: event.preview,
          writer: event.writer,
          observers: event.observers,
        });
        return;
      }
      case "comp+": {
        const record = this.create(event, event.kind, event.kind);
        if (record === null) return;
        record.parent = event.owner;
        record.name = event.name;
        record.render = event.render;
        return;
      }
      case "run": {
        const record = this.nodes.get(event.id);
        if (record === undefined) {
          this.unknown += 1;
          return;
        }
        const causes = this.causesOf(record);
        record.runs += 1;
        record.totalDuration += event.duration;
        record.lastDuration = event.duration;
        record.lastStart = event.start;
        record.lastRunSeq = event.seq;
        if (event.changed) record.lastChangeSeq = event.seq;
        this.setSources(record, event.sources);
        this.runs.push({
          seq: event.seq,
          t: event.t,
          id: event.id,
          start: event.start,
          duration: event.duration,
          changed: event.changed,
          flush: this.openFlush === null ? 0 : this.openFlush.seq,
          causes,
        });
        if (this.openFlush !== null) this.flushRuns += 1;
        return;
      }
      case "mount": {
        const record = this.nodes.get(event.id);
        if (record === undefined) {
          this.unknown += 1;
          return;
        }
        record.isComponent = true;
        record.label = "component";
        record.name = event.name;
        record.mountedAt = event.t;
        this.componentEpoch += 1;
        return;
      }
      case "unmount": {
        const record = this.nodes.get(event.id);
        if (record === undefined) {
          this.unknown += 1;
          return;
        }
        // The owner's disposal follows; keep the flag so the component stays attributable.
        this.componentEpoch += 1;
        return;
      }
      case "resource": {
        let record = this.nodes.get(event.id);
        if (record === undefined) {
          record = this.create(event, "resource", "resource") ?? undefined;
          if (record === undefined) return;
          record.parent = event.owner;
          this.addLeaf(event.owner, event.id);
        }
        record.state = event.state;
        if (event.name !== undefined) record.name = event.name;
        record.lastChangeSeq = event.seq;
        return;
      }
      case "store+": {
        const record = this.create(event, "store", "store");
        if (record === null) return;
        record.parent = event.owner;
        record.name = event.name;
        this.addLeaf(event.owner, event.id);
        return;
      }
      case "error":
        this.errors.push({
          seq: event.seq,
          t: event.t,
          id: event.id,
          message: event.message,
          code: event.code,
        });
        return;
      case "hydration":
        this.hydration.push({
          seq: event.seq,
          t: event.t,
          message: event.message,
          expected: event.expected,
          actual: event.actual,
        });
        return;
      case "flush+": {
        const record: FlushRecord = {
          seq: event.seq,
          startSeq: event.seq,
          start: event.t,
          end: event.t,
          render: event.render,
          user: event.user,
          runs: 0,
          open: true,
        };
        this.flushes.push(record);
        this.openFlush = record;
        this.flushRuns = 0;
        return;
      }
      case "flush-": {
        const open = this.openFlush;
        if (open === null) return;
        open.end = event.t;
        open.runs = this.flushRuns;
        open.open = false;
        this.openFlush = null;
        return;
      }
    }
  }

  /** Why a computation is about to run again: sources that changed since its last run. */
  private causesOf(record: NodeRecord): Cause[] {
    if (record.runs === 0) return [{ kind: "initial", id: NO_ID, seq: record.createdSeq }];
    const causes: Cause[] = [];
    for (const id of record.sources) {
      const source = this.nodes.get(id);
      if (source === undefined || source.lastChangeSeq <= record.lastRunSeq) continue;
      causes.push({
        kind: source.type === "signal" ? "write" : "run",
        id,
        seq: source.lastChangeSeq,
      });
    }
    if (causes.length === 0) causes.push({ kind: "unknown", id: NO_ID, seq: record.lastRunSeq });
    causes.sort((a, b) => a.seq - b.seq);
    return causes;
  }

  /**
   * The nearest component that owns `id`: the node itself when it is a component, otherwise the first
   * component above it in the owner chain (the graveyard included). The answer is cached until the next
   * component mount, unmount or disposal.
   *
   * @param id The node id.
   * @returns The component's id, or {@link NO_ID} when no component owns the node.
   */
  componentOf(id: number): number {
    const cached = this.componentCache.get(id);
    if (cached !== undefined && cached.epoch === this.componentEpoch) return cached.component;
    // Walk up to the first component; every node on the way shares the answer, so cache them all.
    const path: number[] = [];
    let component: number = NO_ID;
    let currentId = id;
    const limit = this.nodes.size + this.graveyard.size + 1;
    for (let steps = 0; steps < limit; steps += 1) {
      const hit = this.componentCache.get(currentId);
      if (hit !== undefined && hit.epoch === this.componentEpoch) {
        component = hit.component;
        break;
      }
      const current = this.node(currentId);
      if (current === undefined) break;
      path.push(currentId);
      if (current.isComponent) {
        component = current.id;
        break;
      }
      if (current.parent === NO_ID) break;
      currentId = current.parent;
    }
    const entry = { epoch: this.componentEpoch, component };
    for (const visited of path) this.componentCache.set(visited, entry);
    if (this.componentCache.size > this.limits.maxNodes) this.componentCache.clear();
    return component;
  }

  /**
   * A serializable copy of the whole state, safe to send as JSON. {@link InspectorModel.importState}
   * rebuilds an equal model from it.
   *
   * @returns The state.
   */
  exportState(): ModelState {
    const plain = (record: NodeRecord): ModelState["nodes"][number] => ({
      ...record,
      sources: record.sources.slice(),
      observers: record.observers === null ? [] : [...record.observers],
    });
    return {
      lastSeq: this.lastSeq,
      overflow: this.overflow,
      unknown: this.unknown,
      nodes: [...this.nodes.values()].map(plain),
      graveyard: [...this.graveyard.values()].map(plain),
      runs: this.runs.toArray(),
      writes: this.writes.toArray(),
      flushes: this.flushes.toArray().map((flush) => ({ ...flush })),
      errors: this.errors.toArray(),
      hydration: this.hydration.toArray(),
    };
  }

  /**
   * Replaces the whole state with `state`. A remote panel does this with the agent's state, and the
   * agent does it with an empty state to implement `clear`. The capacities of this model do not change:
   * when `state` holds more records than a buffer can keep, the newest are kept; nodes past
   * `limits.maxNodes` are left out and counted in `overflow`, as nodes created live are.
   *
   * @param state The state to load.
   */
  importState(state: ModelState): void {
    this.nodes.clear();
    this.graveyard.clear();
    this.runs.clear();
    this.writes.clear();
    this.flushes.clear();
    this.errors.clear();
    this.hydration.clear();
    this.componentCache.clear();
    this.openFlush = null;
    this.flushRuns = 0;
    const revive = (plain: ModelState["nodes"][number]): NodeRecord => ({
      ...plain,
      sources: plain.sources.slice(),
      observers: plain.observers.length === 0 ? null : new Set(plain.observers),
    });
    this.leaves.clear();
    let dropped = 0;
    for (const plain of state.nodes) {
      // The cap of the live path: the nodes that do not fit are counted, not kept.
      if (this.nodes.size >= this.limits.maxNodes) {
        dropped += 1;
        continue;
      }
      const record = revive(plain);
      this.nodes.set(plain.id, record);
      if (record.type === "signal" || record.type === "store" || record.type === "resource") {
        this.addLeaf(record.parent, record.id);
      }
    }
    for (const plain of state.graveyard) this.graveyard.set(plain.id, revive(plain));
    this.trimGraveyard();
    for (const run of state.runs) this.runs.push(run);
    for (const write of state.writes) this.writes.push(write);
    for (const flush of state.flushes) {
      const copy = { ...flush };
      this.flushes.push(copy);
      if (copy.open) this.openFlush = copy;
    }
    for (const error of state.errors) this.errors.push(error);
    for (const mismatch of state.hydration) this.hydration.push(mismatch);
    this.lastSeq = state.lastSeq;
    this.overflow = state.overflow + dropped;
    this.unknown = state.unknown;
    this.componentEpoch += 1;
  }
}

/**
 * Builds a model from a finished event stream. A pure function: the same input always gives the same
 * model. A development tool, like {@link InspectorModel}.
 *
 * @param events Events in `seq` order.
 * @param limits Buffer capacities. Values left out take the defaults in {@link DEFAULT_LIMITS}.
 * @returns The folded model.
 * @example
 * import { foldEvents } from "@shadow-js/devtools";
 * import type { WireEvent } from "@shadow-js/devtools";
 *
 * const events: WireEvent[] = [];
 * const model = foldEvents(events, { runs: 1000 });
 * @since 1.0.0
 */
export function foldEvents(
  events: Iterable<WireEvent>,
  limits?: Partial<ModelLimits>,
): InspectorModel {
  const model = new InspectorModel(limits);
  for (const event of events) model.apply(event);
  return model;
}
