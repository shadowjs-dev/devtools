import type { InspectorModel, NodeRecord, NodeType, RunRecord, WriteRecord } from "./model";
import { NO_ID } from "./protocol";

/**
 * One node of the graph snapshot: an owner, signal, computation, resource or store, with its edges
 * and update counts. Plain data, safe to send to a remote panel as JSON. Built by {@link snapshotOf}.
 *
 * @since 1.0.0
 */
export interface SnapshotNode {
  /** Node id, as the runtime assigned it. */
  id: number;
  /** The kind of node. */
  type: NodeType;
  /** `root`, `owner`, `memo`, `effect`, `signal`, `resource`, `store`, or `component` after a mount. */
  label: string;
  /** The name given in the source, or `undefined`. */
  name: string | undefined;
  /** Owner id, or {@link NO_ID} for roots and detached nodes. */
  parent: number;
  /** Ids of the live nodes this node owns, in creation order. */
  children: number[];
  /** Ownership depth: 0 for roots. */
  depth: number;
  /** True when a component was mounted on this node. */
  isComponent: boolean;
  /** Nearest component that owns this node (the node itself for a component), or {@link NO_ID} for none. */
  component: number;
  /** Computations: ids read by the last run. */
  sources: number[];
  /** Ids of the computations that read this node. */
  observers: number[];
  /** Computations: how many times it ran, the first run included. */
  runs: number;
  /** Computations: runs after the first (the first run is the initial computation, not an update). */
  updates: number;
  /** Computations: duration of the last run, in milliseconds. */
  lastDuration: number;
  /** Computations: total duration of all runs, in milliseconds. */
  totalDuration: number;
  /** Signals and stores: a short text of the current value (empty for other kinds). */
  preview: string;
  /** Signals: number of writes. */
  writes: number;
  /** Resources: the last reported state (empty for other kinds). */
  state: string;
  /** Computations: created during the render phase. */
  render: boolean;
}

/**
 * Counts shown in the toolbar. The node counts are live nodes; `runs`, `writes`, `flushes`, `errors`
 * and `hydration` are the records the bounded buffers hold, not totals since the start.
 *
 * @since 1.0.0
 */
export interface SnapshotCounts {
  /** Live nodes of every kind. */
  nodes: number;
  /** Live owners, roots included. */
  owners: number;
  /** Live nodes a component was mounted on. */
  components: number;
  /** Live signals. */
  signals: number;
  /** Live memos. */
  memos: number;
  /** Live effects. */
  effects: number;
  /** Live resources. */
  resources: number;
  /** Live stores. */
  stores: number;
  /** Run records held (capacity: `ModelLimits.runs`). */
  runs: number;
  /** Write records held (capacity: `ModelLimits.writes`). */
  writes: number;
  /** Flush records held. */
  flushes: number;
  /** Error records held. */
  errors: number;
  /** Hydration mismatch records held. */
  hydration: number;
}

/**
 * The graph at one point in time: every live node with its edges, the root ids and the counts. Built
 * by {@link snapshotOf}.
 *
 * @since 1.0.0
 */
export interface GraphSnapshot {
  /** Sequence number of the last event folded into the model. */
  seq: number;
  /** Every live node, in creation order. */
  nodes: SnapshotNode[];
  /** Ids without a live parent, oldest first. */
  roots: number[];
  /** Counts for the toolbar. */
  counts: SnapshotCounts;
  /** Nodes the model ignored because `maxNodes` was reached. */
  overflow: number;
}

/**
 * Update statistics of one component, from {@link componentStats}.
 *
 * @since 1.0.0
 */
export interface ComponentStat {
  /** Id of the component's owner node. */
  id: number;
  /** The component's name, or `component#<id>` when it has none. */
  name: string;
  /** False once the component's owner has been disposed. */
  alive: boolean;
  /** Time the component was mounted, in milliseconds on the reporting clock. */
  mountedAt: number;
  /** Effects and memos whose nearest component is this one. */
  computations: number;
  /** Runs after the first, summed over those computations. */
  updates: number;
  /** Total run time of those computations, in milliseconds. */
  totalDuration: number;
  /** Sequence number of the latest update run, or 0 when there was none. */
  lastUpdateSeq: number;
}

/**
 * One bar of the flame timeline, from {@link flameTimeline}.
 *
 * @since 1.0.0
 */
export interface FlameSpan {
  /** Sequence number of the run event. */
  seq: number;
  /** The computation that ran. */
  id: number;
  /** Its display name (see {@link nodeLabel}), or `#id` when the node is unknown. */
  label: string;
  /** Its node type (`memo` or `effect`), or `unknown` when the node is unknown. */
  kind: string;
  /** Start time, in milliseconds on the reporting clock. */
  start: number;
  /** End time (`start` plus `duration`), in milliseconds. */
  end: number;
  /** Run time, in milliseconds. */
  duration: number;
  /** Lane: the number of runs of the same flush still running when this one started. */
  depth: number;
  /** Whether the run reported a changed value. */
  changed: boolean;
  /** The nearest component, or {@link NO_ID} for none. */
  component: number;
}

/**
 * The timeline of one flush, from {@link flameTimeline}.
 *
 * @since 1.0.0
 */
export interface FlameFlush {
  /** Flush sequence number, or `0` for runs that ran outside any flush. */
  flush: number;
  /** Start time in milliseconds (for flush `0`, the start of its first run). */
  start: number;
  /** End time in milliseconds (for flush `0`, the latest end of its runs). */
  end: number;
  /** `end - start` in milliseconds, never negative. */
  duration: number;
  /** Render queue size when the flush started (`0` for flush `0`). */
  render: number;
  /** User queue size when the flush started (`0` for flush `0`). */
  user: number;
  /** Number of lanes: the deepest span depth plus one, or `0` when there are no spans. */
  lanes: number;
  /** The runs of the flush, ordered by start time. */
  spans: FlameSpan[];
}

/**
 * A step of a causal chain, from {@link explainRun}.
 *
 * @since 1.0.0
 */
export interface ExplainStep {
  /**
   * `write`: a signal write. `run`: a computation run. `initial`: the first run of a computation.
   * `unknown`: a cause that is neither a write nor a run, such as a resource state change, or one that
   * was not recorded.
   */
  kind: "write" | "run" | "initial" | "unknown";
  /** The node involved, or {@link NO_ID} for an `initial` step. */
  id: number;
  /** The node's display name (see {@link nodeLabel}); for `initial` and `unknown` steps, the kind name. */
  label: string;
  /** Sequence number of the event that recorded the step. */
  seq: number;
  /** Writes: the new value (preview). */
  preview?: string;
  /** Writes: label of the computation that wrote, when known. */
  writer?: string;
  /** Runs: whether the value changed. */
  changed?: boolean;
}

/**
 * The answer to "why did this run?", from {@link explainRun}.
 *
 * @since 1.0.0
 */
export interface Explanation {
  /** The run that is explained: node id, label, event sequence number and duration in milliseconds. */
  target: { id: number; label: string; seq: number; duration: number };
  /** Root cause first, ending with the run itself. */
  chain: ExplainStep[];
  /** Other sources that also changed before the run. The chain follows only the earliest one. */
  alsoCausedBy: ExplainStep[];
  /** True when history ran out (the ring buffers dropped older records) before the chain reached its root. */
  truncated: boolean;
}

/**
 * A node of the nested owners tree, from {@link ownerTree}.
 *
 * @since 1.0.0
 */
export interface TreeNode {
  /** Node id. */
  id: number;
  /** Owned nodes, in creation order. */
  children: TreeNode[];
}

/**
 * The display name of a node: its given name, or `label#id` when it has none.
 *
 * @param node Any node record or snapshot node.
 * @returns The name, or `label#id`.
 * @example
 * import { nodeLabel } from "@shadow-js/devtools";
 *
 * nodeLabel({ name: "count", label: "signal", id: 3 }); // "count"
 * nodeLabel({ name: undefined, label: "signal", id: 3 }); // "signal#3"
 * @since 1.0.0
 */
export function nodeLabel(node: { name: string | undefined; label: string; id: number }): string {
  return node.name !== undefined && node.name !== "" ? node.name : `${node.label}#${node.id}`;
}

function toSnapshotNode(record: NodeRecord, model: InspectorModel): SnapshotNode {
  const computation = record.type === "memo" || record.type === "effect";
  return {
    id: record.id,
    type: record.type,
    label: record.label,
    name: record.name,
    parent: record.parent,
    children: [],
    depth: 0,
    isComponent: record.isComponent,
    component: model.componentOf(record.id),
    sources: record.sources.slice(),
    observers: record.observers === null ? [] : [...record.observers],
    runs: record.runs,
    updates: computation ? Math.max(record.runs - 1, 0) : 0,
    lastDuration: record.lastDuration,
    totalDuration: record.totalDuration,
    preview: record.preview,
    writes: record.writes,
    state: record.state,
    render: record.render,
  };
}

/**
 * Builds the graph snapshot: the owners tree, every live node with its sources and observers, and the
 * per-node run counts. Disposed nodes are not included. O(nodes); the model is not changed.
 *
 * @param model The folded model.
 * @returns A JSON-safe snapshot.
 * @example
 * import { foldEvents, snapshotOf } from "@shadow-js/devtools";
 *
 * const snap = snapshotOf(foldEvents([]));
 * const roots = snap.roots.map((id) => snap.nodes.find((node) => node.id === id));
 * @see ownerTree
 * @since 1.0.0
 */
export function snapshotOf(model: InspectorModel): GraphSnapshot {
  const nodes: SnapshotNode[] = [];
  const byId = new Map<number, SnapshotNode>();
  for (const record of model.nodes.values()) {
    const node = toSnapshotNode(record, model);
    nodes.push(node);
    byId.set(node.id, node);
  }
  const roots: number[] = [];
  for (const node of nodes) {
    const parent = node.parent === NO_ID ? undefined : byId.get(node.parent);
    if (parent === undefined) roots.push(node.id);
    else parent.children.push(node.id);
  }
  // Depth, iteratively: ownership depth is user controlled.
  const stack: number[] = [...roots].reverse();
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    const node = byId.get(id);
    if (node === undefined) continue;
    for (const childId of node.children) {
      const child = byId.get(childId);
      if (child === undefined) continue;
      child.depth = node.depth + 1;
      stack.push(childId);
    }
  }
  const count = (type: NodeType): number => nodes.filter((node) => node.type === type).length;
  return {
    seq: model.lastSeq,
    nodes,
    roots,
    overflow: model.overflow,
    counts: {
      nodes: nodes.length,
      owners: count("owner"),
      components: nodes.filter((node) => node.isComponent).length,
      signals: count("signal"),
      memos: count("memo"),
      effects: count("effect"),
      resources: count("resource"),
      stores: count("store"),
      runs: model.runs.size,
      writes: model.writes.size,
      flushes: model.flushes.size,
      errors: model.errors.size,
      hydration: model.hydration.size,
    },
  };
}

/**
 * The owners as a nested tree, children in creation order. A node whose owner is no longer live
 * becomes a root. Built without recursion, so deep ownership cannot overflow the stack.
 *
 * @param snapshot A snapshot from {@link snapshotOf}.
 * @returns The roots, each with its children.
 * @example
 * import { foldEvents, ownerTree, snapshotOf } from "@shadow-js/devtools";
 *
 * const roots = ownerTree(snapshotOf(foldEvents([]))); // [] for an empty model
 * @see snapshotOf
 * @since 1.0.0
 */
export function ownerTree(snapshot: GraphSnapshot): TreeNode[] {
  const byId = new Map<number, TreeNode>();
  for (const node of snapshot.nodes) byId.set(node.id, { id: node.id, children: [] });
  const roots: TreeNode[] = [];
  for (const node of snapshot.nodes) {
    const tree = byId.get(node.id);
    if (tree === undefined) continue;
    const parent = node.parent === NO_ID ? undefined : byId.get(node.parent);
    if (parent === undefined) roots.push(tree);
    else parent.children.push(tree);
  }
  return roots;
}

/**
 * Per-component update counts: how many times the effects and memos under each component re-ran
 * after their first run. Components are the owners a `mount` event named. A component with no
 * computations still gets an entry.
 *
 * @param model The folded model.
 * @returns One entry per component, most updated first (ties by id).
 * @example
 * import { componentStats, foldEvents } from "@shadow-js/devtools";
 *
 * const top = componentStats(foldEvents([]))[0]; // undefined: no component is mounted yet
 * @since 1.0.0
 */
export function componentStats(model: InspectorModel): ComponentStat[] {
  const stats = new Map<number, ComponentStat>();
  const ensure = (record: NodeRecord): ComponentStat => {
    let stat = stats.get(record.id);
    if (stat === undefined) {
      stat = {
        id: record.id,
        name: record.name ?? `component#${record.id}`,
        alive: record.alive,
        mountedAt: record.mountedAt,
        computations: 0,
        updates: 0,
        totalDuration: 0,
        lastUpdateSeq: 0,
      };
      stats.set(record.id, stat);
    }
    return stat;
  };
  for (const record of model.nodes.values()) if (record.isComponent) ensure(record);
  for (const record of model.nodes.values()) {
    if (record.type !== "memo" && record.type !== "effect") continue;
    const componentId = model.componentOf(record.id);
    if (componentId === NO_ID) continue;
    const owner = model.node(componentId);
    if (owner === undefined) continue;
    const stat = ensure(owner);
    stat.computations += 1;
    stat.updates += Math.max(record.runs - 1, 0);
    stat.totalDuration += record.totalDuration;
    if (record.runs > 1 && record.lastRunSeq > stat.lastUpdateSeq)
      stat.lastUpdateSeq = record.lastRunSeq;
  }
  return [...stats.values()].sort((a, b) => b.updates - a.updates || a.id - b.id);
}

/**
 * Lays the runs of each flush out as flame-graph lanes: a run that started inside another run (a memo
 * pulled by an effect) sits one lane deeper. Runs outside any flush are grouped as flush `0`.
 *
 * @param model The folded model.
 * @param options `last`: only the newest N flushes (default: all kept). When `last` is set, flush `0`
 * is left out, and `last: 0` returns no flushes.
 * @returns One entry per flush, oldest first. Flush `0` comes first, when there are runs outside any
 * flush and `last` is not set.
 * @example
 * import { flameTimeline, foldEvents } from "@shadow-js/devtools";
 *
 * const lanes = flameTimeline(foldEvents([]), { last: 10 }).map((f) => [f.flush, f.lanes]); // []
 * @since 1.0.0
 */
export function flameTimeline(
  model: InspectorModel,
  options: { last?: number } = {},
): FlameFlush[] {
  const byFlush = new Map<number, RunRecord[]>();
  for (const run of model.runs) {
    const bucket = byFlush.get(run.flush);
    if (bucket === undefined) byFlush.set(run.flush, [run]);
    else bucket.push(run);
  }
  const lay = (runs: RunRecord[]): { spans: FlameSpan[]; lanes: number } => {
    const sorted = runs
      .slice()
      .sort((a, b) => a.start - b.start || b.duration - a.duration || a.seq - b.seq);
    const open: number[] = [];
    const spans: FlameSpan[] = [];
    let lanes = 0;
    for (const run of sorted) {
      while (open.length > 0 && (open[open.length - 1] ?? 0) <= run.start) open.pop();
      const node = model.node(run.id);
      const end = run.start + run.duration;
      spans.push({
        seq: run.seq,
        id: run.id,
        label: node === undefined ? `#${run.id}` : nodeLabel(node),
        kind: node === undefined ? "unknown" : node.type,
        start: run.start,
        end,
        duration: run.duration,
        depth: open.length,
        changed: run.changed,
        component: model.componentOf(run.id),
      });
      open.push(end);
      if (open.length > lanes) lanes = open.length;
    }
    return { spans, lanes };
  };
  let flushes = model.flushes.toArray();
  if (options.last !== undefined && options.last >= 0)
    flushes = options.last === 0 ? [] : flushes.slice(-options.last);
  const out: FlameFlush[] = [];
  const loose = byFlush.get(0);
  if (loose !== undefined && loose.length > 0 && options.last === undefined) {
    const { spans, lanes } = lay(loose);
    const start = spans[0]?.start ?? 0;
    const end = spans.reduce((latest, span) => Math.max(latest, span.end), start);
    out.push({
      flush: 0,
      start,
      end,
      duration: end - start,
      render: 0,
      user: 0,
      lanes,
      spans,
    });
  }
  for (const flush of flushes) {
    const { spans, lanes } = lay(byFlush.get(flush.seq) ?? []);
    out.push({
      flush: flush.seq,
      start: flush.start,
      end: flush.end,
      duration: Math.max(flush.end - flush.start, 0),
      render: flush.render,
      user: flush.user,
      lanes,
      spans,
    });
  }
  return out;
}

function findRun(
  model: InspectorModel,
  predicate: (run: RunRecord) => boolean,
): RunRecord | undefined {
  for (let i = model.runs.size - 1; i >= 0; i -= 1) {
    const run = model.runs.at(i);
    if (run !== undefined && predicate(run)) return run;
  }
  return undefined;
}

function findWrite(model: InspectorModel, seq: number, id: number): WriteRecord | undefined {
  for (let i = model.writes.size - 1; i >= 0; i -= 1) {
    const write = model.writes.at(i);
    if (write === undefined) continue;
    if (write.seq === seq && write.id === id) return write;
    if (write.seq < seq) return undefined;
  }
  return undefined;
}

function label(model: InspectorModel, id: number): string {
  const node = model.node(id);
  return node === undefined ? `#${id}` : nodeLabel(node);
}

/**
 * "Why did this run?": follows the changed sources of a run back to the signal write that started
 * it. A write made inside another effect continues with that effect's own run, so the chain can span
 * several computations. The primary path follows the earliest changed source; the others are
 * listed in `alsoCausedBy`. A chain longer than `maxDepth` is cut at that length.
 *
 * @param model The folded model.
 * @param id The computation to explain.
 * @param options `runSeq`: explain this run instead of the latest; `maxDepth`: chain length limit (default 64).
 * @returns The explanation, or `null` when the computation has no recorded run.
 * @example
 * import { explainRun, foldEvents } from "@shadow-js/devtools";
 *
 * const why = explainRun(foldEvents([]), 3);
 * const labels = why?.chain.map((step) => step.label); // undefined: no run of node 3 is recorded
 * @see nodeLabel
 * @since 1.0.0
 */
export function explainRun(
  model: InspectorModel,
  id: number,
  options: { runSeq?: number; maxDepth?: number } = {},
): Explanation | null {
  const target = findRun(
    model,
    (run) => run.id === id && (options.runSeq === undefined || run.seq === options.runSeq),
  );
  if (target === undefined) return null;
  const maxDepth = options.maxDepth ?? 64;
  const reverse: ExplainStep[] = [
    {
      kind: "run",
      id: target.id,
      label: label(model, target.id),
      seq: target.seq,
      changed: target.changed,
    },
  ];
  const alsoCausedBy: ExplainStep[] = [];
  const visited = new Set<number>([target.seq]);
  let truncated = false;
  let current: RunRecord = target;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    const [primary, ...others] = current.causes;
    if (primary === undefined) break;
    if (current === target) {
      for (const other of others) {
        alsoCausedBy.push({
          kind: other.kind,
          id: other.id,
          label: label(model, other.id),
          seq: other.seq,
        });
      }
    }
    if (primary.kind === "initial" || primary.kind === "unknown") {
      reverse.push({ kind: primary.kind, id: primary.id, label: primary.kind, seq: primary.seq });
      break;
    }
    if (primary.kind === "write") {
      const write = findWrite(model, primary.seq, primary.id);
      if (write === undefined) {
        reverse.push({
          kind: "write",
          id: primary.id,
          label: label(model, primary.id),
          seq: primary.seq,
        });
        truncated = true;
        break;
      }
      const step: ExplainStep = {
        kind: "write",
        id: write.id,
        label: label(model, write.id),
        seq: write.seq,
        preview: write.preview,
      };
      if (write.writer !== NO_ID) step.writer = label(model, write.writer);
      reverse.push(step);
      if (write.writer === NO_ID) break;
      // The writing computation's run ends after the write: take its first run recorded later.
      const writerRun = findRunAfter(model, write.writer, write.seq);
      if (writerRun === undefined || visited.has(writerRun.seq)) {
        truncated = writerRun === undefined;
        break;
      }
      visited.add(writerRun.seq);
      reverse.push({
        kind: "run",
        id: writerRun.id,
        label: label(model, writerRun.id),
        seq: writerRun.seq,
        changed: writerRun.changed,
      });
      current = writerRun;
      continue;
    }
    // A source that is not a computation (a resource changed state) has no run to step into.
    const source = model.node(primary.id);
    if (source !== undefined && source.type !== "memo" && source.type !== "effect") {
      reverse.push({
        kind: "unknown",
        id: primary.id,
        label: label(model, primary.id),
        seq: primary.seq,
      });
      break;
    }
    const upstream = findRun(model, (run) => run.seq === primary.seq);
    if (upstream === undefined || visited.has(upstream.seq)) {
      reverse.push({
        kind: "run",
        id: primary.id,
        label: label(model, primary.id),
        seq: primary.seq,
      });
      truncated = upstream === undefined;
      break;
    }
    visited.add(upstream.seq);
    reverse.push({
      kind: "run",
      id: upstream.id,
      label: label(model, upstream.id),
      seq: upstream.seq,
      changed: upstream.changed,
    });
    current = upstream;
  }
  return {
    target: {
      id: target.id,
      label: label(model, target.id),
      seq: target.seq,
      duration: target.duration,
    },
    chain: reverse.reverse(),
    alsoCausedBy,
    truncated,
  };
}

function findRunAfter(model: InspectorModel, id: number, seq: number): RunRecord | undefined {
  let found: RunRecord | undefined;
  for (let i = model.runs.size - 1; i >= 0; i -= 1) {
    const run = model.runs.at(i);
    if (run === undefined || run.seq <= seq) break;
    if (run.id === id) found = run;
  }
  return found;
}
