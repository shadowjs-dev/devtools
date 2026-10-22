import { type GraphSnapshot, nodeLabel, type SnapshotNode } from "../inspector";
import type { NodeType } from "../model";
import { NO_ID } from "../protocol";

/** One line of the tree view. @since 1.0.0 */
export interface TreeRow {
  /**
   * Id of the node.
   */
  id: number;
  /**
   * Nesting level of the row: `0` for a root. With components only, a row sits one level below its
   * nearest shown ancestor.
   */
  depth: number;
  /**
   * The kind of the node.
   */
  type: NodeType;
  /**
   * True for a component node.
   */
  isComponent: boolean;
  /** Display name: `<Counter>`, `count`, `effect#12`. */
  label: string;
  /**
   * Secondary text: a signal's value, a resource's state, or the run count of a memo or effect.
   */
  detail: string;
  /**
   * True when the node has children in the list. While a filter is set, only matching children count.
   */
  hasChildren: boolean;
  /**
   * True when the node's children are hidden. Always false while a filter is set.
   */
  collapsed: boolean;
  /**
   * Re-runs after the first, summed over the node and everything below it in the owners tree.
   */
  updates: number;
  /** Id of the component that owns the node ({@link NO_ID} for none). */
  component: number;
}

/** What to show in the tree. @since 1.0.0 */
export interface RowOptions {
  /** Case-insensitive text matched against names, kinds and values. Matches are shown with their ancestors. */
  filter: string;
  /** Show only components (their descendants are attached to the nearest shown ancestor). */
  componentsOnly: boolean;
  /**
   * Ids the user collapsed. Everything else is expanded. Ignored while `filter` is set.
   */
  collapsed: ReadonlySet<number>;
  /**
   * Most rows returned.
   *
   * @default 2000
   */
  limit?: number;
}

/**
 * Result of {@link buildRows}.
 *
 * @since 1.0.0
 */
export interface RowsResult {
  /**
   * The visible rows, depth first.
   */
  rows: TreeRow[];
  /** Rows that matched but were cut by `limit`. */
  hidden: number;
}

function labelOf(node: SnapshotNode): string {
  if (node.isComponent) return `<${node.name ?? `component#${node.id}`}>`;
  return nodeLabel(node);
}

function detailOf(node: SnapshotNode): string {
  switch (node.type) {
    case "signal":
      return node.preview;
    case "resource":
      return node.state;
    case "memo":
    case "effect":
      return node.runs === 0 ? "" : `${node.runs} run${node.runs === 1 ? "" : "s"}`;
    default:
      return "";
  }
}

/**
 * Flattens the owners tree into the rows the tree view shows: depth first, children in creation order,
 * honoring the collapse state, the text filter and the components-only switch. Iterative, so a deep or
 * large tree does not overflow the call stack.
 *
 * Internal to the panel: the package index does not export this function.
 *
 * @param snapshot A graph snapshot.
 * @param options Filter, switches and the row limit.
 * @returns The rows and how many matches were cut.
 * @internal
 */
export function buildRows(snapshot: GraphSnapshot, options: RowOptions): RowsResult {
  const byId = new Map<number, SnapshotNode>();
  for (const node of snapshot.nodes) byId.set(node.id, node);
  const filter = options.filter.trim().toLowerCase();
  const filtering = filter !== "";

  // Updates roll up: a component shows the re-runs of everything below it.
  const rolled = new Map<number, number>();
  for (const node of snapshot.nodes) {
    if (node.updates === 0) continue;
    let current: SnapshotNode | undefined = node;
    let guard = 0;
    while (current !== undefined && guard < snapshot.nodes.length + 1) {
      rolled.set(current.id, (rolled.get(current.id) ?? 0) + node.updates);
      current = current.parent === NO_ID ? undefined : byId.get(current.parent);
      guard += 1;
    }
  }

  // With a filter, only matches and their ancestors take part.
  let included: Set<number> | null = null;
  if (filtering) {
    const matches = new Set<number>();
    for (const node of snapshot.nodes) {
      const haystack = `${labelOf(node)} ${node.type} ${node.preview} ${node.state}`.toLowerCase();
      if (!haystack.includes(filter)) continue;
      let current: SnapshotNode | undefined = node;
      while (current !== undefined && !matches.has(current.id)) {
        matches.add(current.id);
        current = current.parent === NO_ID ? undefined : byId.get(current.parent);
      }
    }
    included = matches;
  }

  const limit = options.limit ?? 2000;
  const rows: TreeRow[] = [];
  let hidden = 0;
  const stack: Array<{ id: number; depth: number }> = [];
  for (let i = snapshot.roots.length - 1; i >= 0; i -= 1) {
    const id = snapshot.roots[i];
    if (id !== undefined) stack.push({ id, depth: 0 });
  }
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    const node = byId.get(entry.id);
    if (node === undefined) continue;
    if (included !== null && !included.has(node.id)) continue;
    const shown = !options.componentsOnly || node.isComponent;
    const children = node.children.filter((id) => included === null || included.has(id));
    const collapsed = !filtering && options.collapsed.has(node.id);
    if (shown) {
      if (rows.length < limit) {
        rows.push({
          id: node.id,
          depth: entry.depth,
          type: node.type,
          isComponent: node.isComponent,
          label: labelOf(node),
          detail: detailOf(node),
          hasChildren: children.length > 0,
          collapsed,
          updates: rolled.get(node.id) ?? 0,
          component: node.component,
        });
      } else {
        hidden += 1;
      }
    }
    if (collapsed) continue;
    const childDepth = shown ? entry.depth + 1 : entry.depth;
    for (let i = children.length - 1; i >= 0; i -= 1) {
      const child = children[i];
      if (child !== undefined) stack.push({ id: child, depth: childDepth });
    }
  }
  return { rows, hidden };
}

/**
 * One or two letters that name a row's kind in the tree: `C` for a component, `O` owner, `S` signal,
 * `M` memo, `E` effect, `R` resource and `ST` store.
 *
 * Internal to the panel: the package index does not export this function.
 *
 * @param row The row.
 * @returns The letters.
 * @internal
 */
export function kindLetter(row: { type: NodeType; isComponent: boolean }): string {
  if (row.isComponent) return "C";
  switch (row.type) {
    case "owner":
      return "O";
    case "signal":
      return "S";
    case "memo":
      return "M";
    case "effect":
      return "E";
    case "resource":
      return "R";
    case "store":
      return "ST";
  }
}
