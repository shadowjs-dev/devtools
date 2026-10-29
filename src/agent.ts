import { readInspections } from "./inspection";
import { type GraphSnapshot, snapshotOf } from "./inspector";
import { describeElement } from "./internal/describe-element";
import { InspectorModel, type ModelLimits, type ModelState, type NodeRecord } from "./model";
import { errorMessage, parseEditableText, preview, toEditableText } from "./preview";
import {
  type DevtoolsHook,
  EVENT,
  type HookSink,
  NO_ID,
  type StoreHandle,
  type WireEvent,
} from "./protocol";
import { RingBuffer } from "./ring";

/**
 * Options of {@link createAgent}. Every field is optional.
 *
 * @since 1.0.0
 */
export interface AgentOptions {
  /** Capacities of the model's buffers. The values left out take the defaults of `DEFAULT_LIMITS`. */
  limits?: Partial<ModelLimits>;
  /**
   * Raw events kept for the events log. The newest are kept; older ones are overwritten and counted
   * in `dropped`.
   *
   * @default 10000
   */
  events?: number;
  /**
   * Most events waiting for subscribers. When this many are pending they are delivered at once,
   * instead of at the end of the current microtask.
   *
   * @default 10000
   */
  maxPending?: number;
  /**
   * Maximum length of a value preview, in characters.
   *
   * @default 80
   */
  previewLength?: number;
  /**
   * The clock, in milliseconds. Defaults to `performance.now` (or `Date.now` where it is missing).
   */
  now?: () => number;
  /**
   * Writes a signal node for the value editor. Pass `writeSignal` from `@shadow-js/core/extend`.
   * Without it signals are shown but not editable: a write is refused with "Editing is not enabled.".
   */
  writeSignal?: (node: never, value: never) => unknown;
}

/**
 * Counters of what the agent saw. They keep growing while the agent runs; {@link Agent.clear} does not
 * reset them.
 *
 * @since 1.0.0
 */
export interface AgentStats {
  /** Events the agent was offered while it was not paused. */
  received: number;
  /** Events turned into wire events. */
  recorded: number;
  /**
   * Events the agent skipped on purpose: objects created inside {@link Agent.quiet} (the tools' own
   * UI), dispose and unmount events for objects it never named, malformed store handles, and event
   * kinds from a newer runtime.
   */
  ignored: number;
  /**
   * Writes, runs and mounts about objects the agent never saw created (reported before it attached,
   * when the hook's replay buffer had been released).
   */
  unknown: number;
}

/**
 * A command a panel sends to the agent, answered by {@link Agent.handle}. All fields are plain data,
 * so a command can cross a message channel:
 *
 * - `snapshot`: the model's state.
 * - `value` and `write`: read a signal as editable text, or write it.
 * - `store` and `store-set`: read a store as editable text, or write one path of it.
 * - `highlight`: the agent acknowledges it; the page draws the highlight (see `createLocalBackend`).
 * - `pause`, `resume`, `clear`: control recording. `stats`: the counters.
 * - `inspect`: every inspection source registered with `registerInspection`, read now.
 *
 * @since 1.0.0
 */
export type AgentRequest =
  | { type: "snapshot" }
  | { type: "value"; id: number }
  | { type: "write"; id: number; text: string }
  | { type: "store"; id: number }
  | { type: "store-set"; id: number; path: Array<string | number>; text: string }
  | { type: "highlight"; id: number | null }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "clear" }
  | { type: "stats" }
  | { type: "inspect" };

/**
 * The answer to an {@link AgentRequest}: the result, or an error message to show the user.
 *
 * @since 1.0.0
 */
export type AgentResponse = { ok: true; result: unknown } | { ok: false; error: string };

/**
 * The value of a node, as text, for the value editor.
 *
 * @since 1.0.0
 */
export interface ValueResult {
  /** The node that was asked for. */
  id: number;
  /** `signal` for a signal, `store` for a store. */
  kind: "signal" | "store";
  /** The value as editable text (see {@link toEditableText}). */
  text: string;
  /** True when the panel may write it: a store always, a signal only when `writeSignal` is set. */
  editable: boolean;
}

/**
 * The agent. It receives the runtime's own objects from the hook, turns them into id-based
 * {@link WireEvent}s and folds them into an {@link InspectorModel}. Recording is O(1) per event and
 * every buffer is bounded: the raw event ring, the model's run, write and flush rings, the disposed-node
 * graveyard and the live node count.
 *
 * A development tool: the hook it attaches to is installed only in development builds (see
 * `installHook`).
 *
 * @since 1.0.0
 */
export interface Agent extends HookSink {
  /** The model the events are folded into. */
  readonly model: InspectorModel;
  /** The newest raw events, as many as the `events` option holds (default 10000). */
  readonly events: RingBuffer<WireEvent>;
  /** Counters of what the agent saw. */
  readonly stats: Readonly<AgentStats>;
  /** True while the agent drops the events the runtime reports (see {@link Agent.pause}). */
  readonly paused: boolean;
  /**
   * Attaches the agent to `hook`, so that the hook delivers its events to the agent. Pass the hook
   * from `installHook` or `getHook`.
   *
   * @param hook The hook to listen to.
   * @returns A function that detaches the agent from the hook.
   */
  attach(hook: DevtoolsHook): () => void;
  /**
   * Calls `listener` with batches of new events: once per microtask, or sooner when `maxPending`
   * events are waiting. Only events recorded after the call are delivered.
   *
   * @param listener Receives each batch, oldest first.
   * @returns A function that unsubscribes the listener.
   */
  subscribe(listener: (events: readonly WireEvent[]) => void): () => void;
  /** Delivers the pending events to the subscribers now, instead of at the end of the microtask. */
  flush(): void;
  /**
   * Runs `fn` while the agent ignores everything the runtime creates, and everything created under
   * those nodes. Use it to mount the tools' own UI, so that the tools never inspect themselves. An error
   * thrown by `fn` propagates.
   *
   * @param fn The work to run.
   * @returns What `fn` returns.
   */
  quiet<T>(fn: () => T): T;
  /** Stops recording: events the runtime reports are dropped until {@link Agent.resume}. */
  pause(): void;
  /** Resumes recording after {@link Agent.pause}. */
  resume(): void;
  /**
   * Forgets everything recorded so far: the model's nodes and records, the event ring, and the
   * references to live nodes. Nodes created later are tracked; live ones are not, and later events about
   * them count as unknown. {@link AgentStats} are not reset.
   */
  clear(): void;
  /** The graph snapshot of the model (see `snapshotOf`). Each call builds a new object. */
  snapshot(): GraphSnapshot;
  /** The model state, for sending to a remote panel. */
  state(): ModelState;
  /**
   * Answers a panel command. Never throws: a failure, such as an error from writing user state, comes
   * back as `ok: false`, and so does an unknown command.
   *
   * @param request The command.
   * @returns The answer.
   */
  handle(request: AgentRequest): AgentResponse;
  /**
   * The connected DOM nodes that the component `id` rendered, for highlighting. Empty when the
   * component is unknown or its nodes left the page. The agent holds the nodes weakly.
   *
   * @param id The component's node id.
   * @returns The nodes.
   */
  nodesOf(id: number): Node[];
  /**
   * Detaches from every hook it was attached to, and drops the listeners and the references to live
   * signals, components and stores. The model and the event ring keep what they recorded.
   */
  dispose(): void;
}

/**
 * Store handles by node id, held weakly: the handle lives as long as the store it reads, because the
 * runtime keeps it reachable from the store's root (see `createDeepStore` in `@shadow-js/core`).
 */
type Registry = Map<number, WeakRef<StoreHandle>>;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isObject(value: unknown): value is object {
  return (typeof value === "object" && value !== null) || typeof value === "function";
}

function toNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function describeSide(value: unknown): string {
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 199)}…` : value;
  if (typeof Node !== "undefined" && value instanceof Node) {
    // Built from the first nodes only: `outerHTML` would serialize the whole subtree to keep 200 characters.
    if (value instanceof Element) return describeElement(value, 200);
    return `#${value.nodeName}`;
  }
  return preview(value, 200);
}

/**
 * Creates an agent that records the runtime's events. Attach it to a hook with `agent.attach(hook)`.
 * A development tool: the events come only from development builds, where the hook is installed.
 *
 * @param options Buffer sizes, clock and the signal writer. Every field is optional.
 * @returns The agent.
 * @example
 * import { createAgent, installHook } from "@shadow-js/devtools";
 * import { writeSignal } from "@shadow-js/core/extend";
 *
 * const hook = installHook();
 * const agent = createAgent({ writeSignal });
 * if (hook !== undefined) agent.attach(hook);
 * agent.snapshot().counts.nodes;
 * @since 1.0.0
 */
export function createAgent(options: AgentOptions = {}): Agent {
  const clock = options.now ?? now;
  const previewLength = options.previewLength ?? 80;
  const maxPending = options.maxPending ?? 10_000;
  const model = new InspectorModel(options.limits);
  const events = new RingBuffer<WireEvent>(options.events ?? 10_000);
  const stats: AgentStats = { received: 0, recorded: 0, ignored: 0, unknown: 0 };

  // Objects are named by id through weak maps: the agent never keeps the runtime's nodes alive.
  const ids = new WeakMap<object, number>();
  const ignored = new WeakSet<object>();
  const signals = new Map<number, WeakRef<object>>();
  const components = new Map<number, WeakRef<Node>[]>();
  const stores: Registry = new Map();
  let nextId = 1;
  let seq = 0;
  let paused = false;
  let quietDepth = 0;
  /** The hook the agent listens to: its registry of inspection sources answers `inspect`. */
  let inspectionHook: DevtoolsHook | undefined;
  let pending: WireEvent[] = [];
  let scheduled = false;
  /** A flush that started but has not recorded any run yet: empty flushes are not worth a record. */
  let queuedFlush: { render: number; user: number; t: number } | null = null;
  let flushOpen = false;
  const listeners = new Set<(events: readonly WireEvent[]) => void>();
  const detachers = new Set<() => void>();
  // Signals, stores and resources have no dispose event of their own when nothing owns them (or their
  // owner never disposes): the finalizer retires their node once the runtime has collected them. It is
  // registered once per object, so a resource that reports many states is not registered many times.
  const finalizer: FinalizationRegistry<number> | undefined =
    typeof FinalizationRegistry === "function"
      ? new FinalizationRegistry<number>((id) => {
          signals.delete(id);
          stores.delete(id);
          if (model.nodes.has(id)) emit({ k: "owner-", seq: 0, t: 0, id });
        })
      : undefined;

  model.onBury = (record: NodeRecord) => {
    signals.delete(record.id);
    components.delete(record.id);
    stores.delete(record.id);
  };

  const deliver = (): void => {
    scheduled = false;
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    // Every subscriber gets the batch, even when an earlier one throws (a closed port, a view that
    // failed): the first error is rethrown afterward, so it is still reported.
    let failure: { error: unknown } | undefined;
    for (const listener of [...listeners]) {
      try {
        listener(batch);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== undefined) throw failure.error;
  };

  /** Stamps, records and fans out one event. */
  function emit(event: WireEvent, at?: number): void {
    seq += 1;
    event.seq = seq;
    event.t = at ?? clock();
    stats.recorded += 1;
    events.push(event);
    model.apply(event);
    if (listeners.size === 0) return;
    pending.push(event);
    if (pending.length >= maxPending) {
      deliver();
    } else if (!scheduled) {
      scheduled = true;
      queueMicrotask(deliver);
    }
  }

  /** Emits the held-back flush start before the first event that belongs to it. */
  const openFlush = (): void => {
    if (queuedFlush === null) return;
    const held = queuedFlush;
    queuedFlush = null;
    flushOpen = true;
    emit({ k: "flush+", seq: 0, t: 0, render: held.render, user: held.user }, held.t);
  };

  const lookup = (value: unknown): number => {
    if (!isObject(value)) return NO_ID;
    return ids.get(value) ?? NO_ID;
  };

  const register = (value: object): number => {
    const existing = ids.get(value);
    if (existing !== undefined) return existing;
    const id = nextId;
    nextId += 1;
    ids.set(value, id);
    return id;
  };

  /**
   * Like `register`, for a leaf node (signal, store, resource): the finalizer retires it once the runtime
   * has collected the object. Owners and computations are not registered: an owner can be unreachable
   * while its signals are still in use, and retiring it would bury them too.
   */
  const registerLeaf = (value: object): number => {
    const existing = ids.get(value);
    if (existing !== undefined) return existing;
    const id = register(value);
    finalizer?.register(value, id);
    return id;
  };

  /** True (and remembered) when the object belongs to the tools' own UI. */
  const isIgnored = (value: unknown, parent: unknown): boolean => {
    if (!isObject(value)) return false;
    if (quietDepth > 0 || (isObject(parent) && ignored.has(parent))) {
      ignored.add(value);
      return true;
    }
    return ignored.has(value);
  };

  const mapIds = (values: unknown): number[] => {
    const out: number[] = [];
    if (!Array.isArray(values)) return out;
    for (let i = 0; i < values.length; i += 1) {
      const id = lookup(values[i]);
      if (id !== NO_ID) out.push(id);
    }
    return out;
  };

  const nodesIn = (value: unknown): WeakRef<Node>[] => {
    const out: WeakRef<Node>[] = [];
    if (typeof Node === "undefined") return out;
    const push = (candidate: unknown): void => {
      if (candidate instanceof DocumentFragment) {
        for (const child of Array.from(candidate.childNodes)) out.push(new WeakRef(child));
      } else if (candidate instanceof Node) {
        out.push(new WeakRef(candidate));
      }
    };
    if (Array.isArray(value)) for (const entry of value) push(entry);
    else push(value);
    return out;
  };

  function receive(kind: number, a: unknown, b: unknown, c: unknown, d: unknown, e: unknown): void {
    if (paused) return;
    stats.received += 1;
    switch (kind) {
      case EVENT.OWNER_CREATED: {
        if (!isObject(a) || isIgnored(a, b)) {
          stats.ignored += 1;
          return;
        }
        const name = typeof d === "string" ? d : undefined;
        emit({
          k: "owner+",
          seq: 0,
          t: 0,
          id: register(a),
          parent: lookup(b),
          label: typeof c === "string" ? c : "owner",
          ...(name === undefined ? {} : { name }),
        });
        return;
      }
      case EVENT.OWNER_DISPOSED: {
        const id = lookup(a);
        if (id === NO_ID) {
          stats.ignored += 1;
          return;
        }
        emit({ k: "owner-", seq: 0, t: 0, id });
        return;
      }
      case EVENT.SIGNAL_CREATED: {
        if (!isObject(a) || isIgnored(a, b)) {
          stats.ignored += 1;
          return;
        }
        const id = registerLeaf(a);
        signals.set(id, new WeakRef(a));
        const name = typeof c === "string" ? c : undefined;
        emit({
          k: "signal+",
          seq: 0,
          t: 0,
          id,
          owner: lookup(b),
          preview: preview(d, previewLength),
          ...(name === undefined ? {} : { name }),
        });
        return;
      }
      case EVENT.SIGNAL_WRITTEN: {
        const id = lookup(a);
        if (id === NO_ID) {
          if (isObject(a) && ignored.has(a)) stats.ignored += 1;
          else stats.unknown += 1;
          return;
        }
        emit({
          k: "write",
          seq: 0,
          t: 0,
          id,
          preview: preview(b, previewLength),
          writer: lookup(c),
          observers: mapIds(d),
        });
        return;
      }
      case EVENT.COMPUTATION_CREATED: {
        if (!isObject(a) || isIgnored(a, b)) {
          stats.ignored += 1;
          return;
        }
        const name = typeof d === "string" ? d : undefined;
        emit({
          k: "comp+",
          seq: 0,
          t: 0,
          id: register(a),
          owner: lookup(b),
          kind: c === "memo" ? "memo" : "effect",
          render: e === true,
          ...(name === undefined ? {} : { name }),
        });
        return;
      }
      case EVENT.COMPUTATION_RUN: {
        const id = lookup(a);
        if (id === NO_ID) {
          if (isObject(a) && ignored.has(a)) stats.ignored += 1;
          else stats.unknown += 1;
          return;
        }
        openFlush();
        emit({
          k: "run",
          seq: 0,
          t: 0,
          id,
          start: toNumber(b),
          duration: toNumber(c),
          changed: d === true,
          sources: mapIds(e),
        });
        return;
      }
      case EVENT.COMPUTATION_DISPOSED: {
        const id = lookup(a);
        if (id === NO_ID) {
          stats.ignored += 1;
          return;
        }
        emit({ k: "comp-", seq: 0, t: 0, id });
        return;
      }
      case EVENT.COMPONENT_MOUNTED: {
        const id = lookup(a);
        if (id === NO_ID) {
          if (isObject(a) && ignored.has(a)) stats.ignored += 1;
          else stats.unknown += 1;
          return;
        }
        const refs = nodesIn(c);
        if (refs.length > 0) components.set(id, refs);
        emit({ k: "mount", seq: 0, t: 0, id, name: typeof b === "string" ? b : "Component" });
        // A node beyond maxNodes is never buried, so its entry would never be removed: forget it.
        if (!model.nodes.has(id)) components.delete(id);
        return;
      }
      case EVENT.COMPONENT_UNMOUNTED: {
        const id = lookup(a);
        if (id === NO_ID) {
          stats.ignored += 1;
          return;
        }
        components.delete(id);
        emit({ k: "unmount", seq: 0, t: 0, id });
        return;
      }
      case EVENT.RESOURCE_STATE: {
        if (!isObject(a) || isIgnored(a, d)) {
          stats.ignored += 1;
          return;
        }
        const name = typeof c === "string" ? c : undefined;
        emit({
          k: "resource",
          seq: 0,
          t: 0,
          id: registerLeaf(a),
          owner: lookup(d),
          state: typeof b === "string" ? b : String(b),
          ...(name === undefined ? {} : { name }),
        });
        return;
      }
      case EVENT.ERROR: {
        const code = typeof c === "string" ? c : undefined;
        emit({
          k: "error",
          seq: 0,
          t: 0,
          id: lookup(a),
          message: errorMessage(b),
          ...(code === undefined ? {} : { code }),
        });
        return;
      }
      case EVENT.HYDRATION_MISMATCH:
        emit({
          k: "hydration",
          seq: 0,
          t: 0,
          message: typeof a === "string" ? a : errorMessage(a),
          expected: describeSide(b),
          actual: describeSide(c),
        });
        return;
      case EVENT.FLUSH_START:
        queuedFlush = { render: toNumber(a), user: toNumber(b), t: clock() };
        return;
      case EVENT.FLUSH_END:
        queuedFlush = null;
        if (flushOpen) {
          flushOpen = false;
          emit({ k: "flush-", seq: 0, t: 0, runs: toNumber(a) });
        }
        return;
      case EVENT.STORE_CREATED: {
        if (!isObject(a) || isIgnored(a, b)) {
          stats.ignored += 1;
          return;
        }
        const handle = readStoreHandle(a);
        if (handle === null) {
          stats.ignored += 1;
          return;
        }
        const id = registerLeaf(a);
        stores.set(id, new WeakRef(handle));
        emit({ k: "store+", seq: 0, t: 0, id, owner: lookup(b), name: handle.name });
        // A store beyond maxNodes is never buried: nothing else would forget its handle.
        if (!model.nodes.has(id)) stores.delete(id);
        return;
      }
      default:
        // An event kind from a newer runtime: ignore it.
        stats.ignored += 1;
    }
  }

  const readStoreHandle = (value: object): StoreHandle | null => {
    const name: unknown = Reflect.get(value, "name");
    const snapshot: unknown = Reflect.get(value, "snapshot");
    const set: unknown = Reflect.get(value, "set");
    if (typeof name !== "string" || typeof snapshot !== "function" || typeof set !== "function") {
      return null;
    }
    return value as StoreHandle;
  };

  const signalValue = (id: number): { found: true; value: unknown } | { found: false } => {
    const node = signals.get(id)?.deref();
    if (node === undefined) return { found: false };
    return { found: true, value: Reflect.get(node, "value") };
  };

  const fail = (error: string): AgentResponse => ({ ok: false, error });

  function handle(request: AgentRequest): AgentResponse {
    try {
      switch (request.type) {
        case "snapshot":
          return { ok: true, result: model.exportState() };
        case "stats":
          return { ok: true, result: { ...stats, events: events.size, dropped: events.dropped } };
        case "value": {
          const read = signalValue(request.id);
          if (!read.found) return fail("The signal is gone.");
          const result: ValueResult = {
            id: request.id,
            kind: "signal",
            text: toEditableText(read.value),
            editable: options.writeSignal !== undefined,
          };
          return { ok: true, result };
        }
        case "write": {
          const node = signals.get(request.id)?.deref();
          if (node === undefined) return fail("The signal is gone.");
          if (options.writeSignal === undefined) return fail("Editing is not enabled.");
          const parsed = parseEditableText(request.text);
          if (!parsed.ok) return fail(parsed.error);
          const write = options.writeSignal as (node: object, value: unknown) => unknown;
          write(node, parsed.value);
          return { ok: true, result: null };
        }
        case "store": {
          const store = stores.get(request.id)?.deref();
          if (store === undefined) return fail("The store is gone.");
          const result: ValueResult = {
            id: request.id,
            kind: "store",
            text: toEditableText(store.snapshot()),
            editable: true,
          };
          return { ok: true, result };
        }
        case "store-set": {
          const store = stores.get(request.id)?.deref();
          if (store === undefined) return fail("The store is gone.");
          const parsed = parseEditableText(request.text);
          if (!parsed.ok) return fail(parsed.error);
          store.set(request.path, parsed.value);
          return { ok: true, result: null };
        }
        case "pause":
          paused = true;
          return { ok: true, result: null };
        case "resume":
          paused = false;
          return { ok: true, result: null };
        case "clear":
          clear();
          return { ok: true, result: null };
        case "highlight":
          // Drawing needs the page; the page side draws it (see createLocalBackend).
          return { ok: true, result: null };
        case "inspect":
          return {
            ok: true,
            result: { sources: readInspections(inspectionHook?.inspections?.() ?? []) },
          };
        default:
          return fail("Unknown command.");
      }
    } catch (error) {
      // Writing user state can throw (a validation in the app): report it to the panel.
      return fail(errorMessage(error));
    }
  }

  function clear(): void {
    model.importState({
      lastSeq: model.lastSeq,
      overflow: 0,
      unknown: 0,
      nodes: [],
      graveyard: [],
      runs: [],
      writes: [],
      flushes: [],
      errors: [],
      hydration: [],
    });
    events.clear();
    pending = [];
    queuedFlush = null;
    flushOpen = false;
    signals.clear();
    components.clear();
    stores.clear();
  }

  const agent: Agent = {
    model,
    events,
    stats,
    get paused(): boolean {
      return paused;
    },
    receive,
    attach(hook): () => void {
      inspectionHook = hook;
      const detach = hook.attach(agent);
      detachers.add(detach);
      return () => {
        detachers.delete(detach);
        detach();
      };
    },
    subscribe(listener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    flush: deliver,
    quiet<T>(fn: () => T): T {
      quietDepth += 1;
      try {
        return fn();
      } finally {
        quietDepth -= 1;
      }
    },
    pause(): void {
      paused = true;
    },
    resume(): void {
      paused = false;
    },
    clear,
    snapshot: () => snapshotOf(model),
    state: () => model.exportState(),
    handle,
    nodesOf(id): Node[] {
      const out: Node[] = [];
      const own = components.get(id);
      if (own !== undefined) {
        for (const ref of own) {
          const node = ref.deref();
          if (node?.isConnected === true) out.push(node);
        }
      }
      return out;
    },
    dispose(): void {
      for (const detach of detachers) detach();
      detachers.clear();
      inspectionHook = undefined;
      listeners.clear();
      pending = [];
      signals.clear();
      components.clear();
      stores.clear();
      model.onBury = undefined;
    },
  };
  return agent;
}
