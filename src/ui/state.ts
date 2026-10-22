import { type Accessor, useMemo, useSignal } from "@shadow-js/core";
import type { Backend } from "../backend";
import {
  type ComponentStat,
  componentStats,
  type Explanation,
  explainRun,
  type FlameFlush,
  flameTimeline,
  type GraphSnapshot,
  nodeLabel,
  type SnapshotNode,
  snapshotOf,
} from "../inspector";
import type { ErrorRecord, HydrationRecord } from "../model";
import { buildRows, type TreeRow } from "./rows";

/** The panel's tabs. @since 1.0.0 */
export type TabId = "tree" | "timeline" | "state" | "issues";

/**
 * The panel's tabs in display order. Each entry has the tab's `id` and the label shown on it.
 *
 * @example
 * import { TABS } from "@shadow-js/devtools";
 * for (const tab of TABS) console.log(tab.id, tab.label);
 * @since 1.0.0
 */
export const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "tree", label: "Components" },
  { id: "timeline", label: "Timeline" },
  { id: "state", label: "State" },
  { id: "issues", label: "Issues" },
];

/** Everything the panel's components read and write. All state is signals; the heavy views are memos. @since 1.0.0 */
export interface PanelState {
  /**
   * The backend the panel reads from. The panel does not know whether it is local or remote.
   */
  readonly backend: Backend;
  /**
   * The active tab.
   */
  readonly tab: Accessor<TabId>;
  /**
   * Makes `tab` the active tab.
   */
  setTab(tab: TabId): void;
  /**
   * Id of the selected node. `0` when no node is selected, because `NO_ID` never names a node.
   */
  readonly selected: Accessor<number>;
  /**
   * Selects the node with this id.
   */
  select(id: number): void;
  /**
   * The tree's text filter.
   */
  readonly filter: Accessor<string>;
  /**
   * Sets the tree's text filter. Matching rows are shown with their ancestors.
   */
  setFilter(text: string): void;
  /**
   * Whether the tree shows components only.
   */
  readonly componentsOnly: Accessor<boolean>;
  /**
   * Shows components only when `on` is true, and every node otherwise.
   */
  setComponentsOnly(on: boolean): void;
  /**
   * Ids of the nodes the user collapsed.
   */
  readonly collapsed: Accessor<ReadonlySet<number>>;
  /**
   * Collapses the node when it is expanded, and expands it when it is collapsed.
   */
  toggleCollapsed(id: number): void;
  /**
   * The most tree rows shown at once.
   */
  readonly rowLimit: Accessor<number>;
  /**
   * Doubles the row limit. The tree's Show more button calls this.
   */
  showMoreRows(): void;
  /**
   * Whether components flash when they update.
   */
  readonly flash: Accessor<boolean>;
  /**
   * Switches flashing on or off, then calls `onFlash`.
   */
  setFlash(on: boolean): void;
  /**
   * Whether the user paused recording.
   */
  readonly paused: Accessor<boolean>;
  /**
   * Pauses or resumes recording. Sends `pause` or `resume` to the backend, then calls `onPause`.
   */
  setPaused(on: boolean): void;
  /** Counter bumped each time the model changed; views depend on it. */
  readonly version: Accessor<number>;
  /** Re-reads the model now. */
  refresh(): void;
  /**
   * The graph snapshot of the backend's model. Recomputed when `version` changes.
   */
  readonly snapshot: Accessor<GraphSnapshot>;
  /**
   * The nodes of {@link PanelState.snapshot}, by id.
   */
  readonly nodes: Accessor<ReadonlyMap<number, SnapshotNode>>;
  /**
   * The tree rows for the current filter, switches, collapse state and row limit, and how many matching
   * rows the limit cut.
   */
  readonly rows: Accessor<{ rows: TreeRow[]; hidden: number }>;
  /**
   * The selected node, or `undefined` when it is not in the snapshot.
   */
  readonly selectedNode: Accessor<SnapshotNode | undefined>;
  /**
   * Why the selected memo or effect last ran, or `null` when the selected node is not a memo or effect.
   */
  readonly explanation: Accessor<Explanation | null>;
  /**
   * The newest 12 flushes, laid out as flame lanes.
   */
  readonly flames: Accessor<FlameFlush[]>;
  /**
   * Up to 10 components that re-ran, most re-runs first.
   */
  readonly hot: Accessor<ComponentStat[]>;
  /**
   * The errors the runtime reported, newest first.
   */
  readonly errors: Accessor<ErrorRecord[]>;
  /**
   * The hydration mismatches, newest first.
   */
  readonly hydration: Accessor<HydrationRecord[]>;
  /** Highlights a component on the page. */
  highlight(id: number | null): void;
  /** The display name of a node, `#id` when it is gone. */
  nameOf(id: number): string;
}

/**
 * Options of {@link createPanelState}. Every field is optional.
 *
 * @since 1.0.0
 */
export interface PanelStateOptions {
  /**
   * Called when the user switches flashing on or off.
   */
  onFlash?(on: boolean): void;
  /**
   * Called with the pause state the user chose. The state also sends `pause` or `resume` to the backend,
   * so the agent stops or resumes recording either way.
   */
  onPause?(paused: boolean): void;
  /**
   * Starting tab.
   *
   * @default "tree"
   */
  tab?: TabId;
  /**
   * Starting row limit of the tree.
   *
   * @default 300
   */
  rowLimit?: number;
  /**
   * Starting value of the flash switch.
   *
   * @default true
   */
  flash?: boolean;
}

/**
 * Creates the panel's state. Call it inside the panel's reactive root, because the memos belong to the
 * current owner. The heavy views (snapshot, rows, flame lanes) are memos of the `version` counter, so a
 * burst of model changes costs one recomputation per refresh.
 *
 * @param backend The backend to read from.
 * @param options Initial values and callbacks.
 * @returns The state.
 * @example
 * import { createAgent, createLocalBackend, createPanelState } from "@shadow-js/devtools";
 * const backend = createLocalBackend(createAgent());
 * // Inside the panel's reactive root (the one render() creates):
 * const state = createPanelState(backend, { tab: "timeline", flash: false });
 * state.setTab("issues");
 * @since 1.0.0
 */
export function createPanelState(backend: Backend, options: PanelStateOptions = {}): PanelState {
  const [tab, setTab] = useSignal<TabId>(options.tab ?? "tree");
  const [selected, setSelected] = useSignal(0);
  const [filter, setFilter] = useSignal("");
  const [componentsOnly, setComponentsOnly] = useSignal(false);
  const [collapsed, setCollapsed] = useSignal<ReadonlySet<number>>(new Set());
  const [rowLimit, setRowLimit] = useSignal(options.rowLimit ?? 300);
  const [flash, setFlashSignal] = useSignal(options.flash !== false);
  const [paused, setPausedSignal] = useSignal(false);
  const [version, setVersion] = useSignal(0);

  const snapshot = useMemo(() => {
    version();
    return snapshotOf(backend.model);
  });
  const nodes = useMemo(() => new Map(snapshot().nodes.map((node) => [node.id, node] as const)));
  const rows = useMemo(() =>
    buildRows(snapshot(), {
      filter: filter(),
      componentsOnly: componentsOnly(),
      collapsed: collapsed(),
      limit: rowLimit(),
    }),
  );
  const selectedNode = useMemo(() => nodes().get(selected()));
  const explanation = useMemo(() => {
    version();
    const node = selectedNode();
    if (node === undefined || (node.type !== "memo" && node.type !== "effect")) return null;
    return explainRun(backend.model, node.id);
  });
  const flames = useMemo(() => {
    version();
    return flameTimeline(backend.model, { last: 12 });
  });
  const hot = useMemo(() => {
    version();
    return componentStats(backend.model)
      .filter((stat) => stat.updates > 0)
      .slice(0, 10);
  });
  const errors = useMemo(() => {
    version();
    return backend.model.errors.toArray().reverse();
  });
  const hydration = useMemo(() => {
    version();
    return backend.model.hydration.toArray().reverse();
  });

  return {
    backend,
    tab,
    setTab,
    selected,
    select: setSelected,
    filter,
    setFilter,
    componentsOnly,
    setComponentsOnly,
    collapsed,
    toggleCollapsed(id): void {
      setCollapsed((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      });
    },
    rowLimit,
    showMoreRows(): void {
      setRowLimit((limit) => limit * 2);
    },
    flash,
    setFlash(on): void {
      setFlashSignal(on);
      options.onFlash?.(on);
    },
    paused,
    setPaused(on): void {
      setPausedSignal(on);
      // Through the backend, so a remote agent pauses too; the callback is for page-side hooks.
      void backend.request({ type: on ? "pause" : "resume" });
      options.onPause?.(on);
    },
    version,
    refresh(): void {
      setVersion((current) => current + 1);
    },
    snapshot,
    nodes,
    rows,
    selectedNode,
    explanation,
    flames,
    hot,
    errors,
    hydration,
    highlight(id): void {
      void backend.request({ type: "highlight", id });
    },
    nameOf(id): string {
      const node = nodes().get(id) ?? backend.model.node(id);
      return node === undefined ? `#${id}` : nodeLabel(node);
    },
  };
}
