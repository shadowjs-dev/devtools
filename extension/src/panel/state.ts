/**
 * The extension panel's state and its selectors, as plain functions. The panel keeps one value of
 * {@link PanelViewState} in a signal and replaces it with {@link reducePanel}; the selectors pick the rows
 * of each view from the graph snapshot. Nothing here touches the DOM, so the tests run without a browser.
 *
 * @packageDocumentation
 */
import type { SnapshotNode } from "../../../src/inspector";

/**
 * The views of the panel, in tab order. `id` is what the state stores; `label` is what the tab shows.
 *
 * @since 1.0.0
 */
export const PANEL_TABS = [
  { id: "components", label: "Components" },
  { id: "signals", label: "Signals" },
  { id: "stores", label: "Stores" },
  { id: "effects", label: "Effects" },
  { id: "timeline", label: "Timeline" },
  { id: "resources", label: "Resources" },
  { id: "router", label: "Router" },
  { id: "queries", label: "Queries" },
  { id: "issues", label: "Issues" },
] as const;

/**
 * One of the panel's tab ids.
 *
 * @since 1.0.0
 */
export type PanelTab = (typeof PANEL_TABS)[number]["id"];

/**
 * The color scheme. The panel is dark unless the user chooses light.
 *
 * @since 1.0.0
 */
export type Theme = "dark" | "light";

/**
 * Everything the panel's views read. `query` is the search text shared by every view; `paused` mirrors the
 * agent's recording state, which the panel asks the agent to change.
 *
 * @since 1.0.0
 */
export interface PanelViewState {
  /** The tab on screen. */
  readonly tab: PanelTab;
  /** The search text, as typed. */
  readonly query: string;
  /** True while the agent does not record. */
  readonly paused: boolean;
  /** The color scheme. */
  readonly theme: Theme;
}

/**
 * What the user did. Each action changes only the field it names.
 *
 * @since 1.0.0
 */
export type PanelAction =
  | { readonly type: "tab"; readonly tab: PanelTab }
  | { readonly type: "step"; readonly delta: 1 | -1 }
  | { readonly type: "edge"; readonly end: "first" | "last" }
  | { readonly type: "query"; readonly text: string }
  | { readonly type: "paused"; readonly on: boolean }
  | { readonly type: "theme"; readonly theme: Theme };

/**
 * The state when the panel opens: the components tab, no search, recording, dark.
 *
 * @returns A new state object.
 * @since 1.0.0
 */
export function initialPanelState(): PanelViewState {
  return { tab: "components", query: "", paused: false, theme: "dark" };
}

/**
 * The tab `delta` places away from `tab`, wrapping at both ends.
 *
 * @param tab The current tab.
 * @param delta `1` for the next tab, `-1` for the previous one.
 * @returns The tab id.
 * @since 1.0.0
 */
export function stepTab(tab: PanelTab, delta: 1 | -1): PanelTab {
  const count = PANEL_TABS.length;
  const index = PANEL_TABS.findIndex((entry) => entry.id === tab);
  const next = (index + delta + count) % count;
  const entry = PANEL_TABS[next];
  return entry === undefined ? tab : entry.id;
}

/**
 * Applies one action to the state and returns the new state. Pure: the same inputs give the same output.
 *
 * @param state The state before the action.
 * @param action What the user did.
 * @returns The state after it.
 * @example
 * import { initialPanelState, reducePanel } from "./state";
 *
 * const next = reducePanel(initialPanelState(), { type: "tab", tab: "signals" });
 * next.tab; // "signals"
 * @since 1.0.0
 */
export function reducePanel(state: PanelViewState, action: PanelAction): PanelViewState {
  switch (action.type) {
    case "tab":
      return { ...state, tab: action.tab };
    case "step":
      return { ...state, tab: stepTab(state.tab, action.delta) };
    case "edge": {
      const first = PANEL_TABS[0];
      const last = PANEL_TABS[PANEL_TABS.length - 1];
      const entry = action.end === "first" ? first : last;
      return entry === undefined ? state : { ...state, tab: entry.id };
    }
    case "query":
      return { ...state, query: action.text };
    case "paused":
      return { ...state, paused: action.on };
    case "theme":
      return { ...state, theme: action.theme };
  }
}

/**
 * True when `text` contains the search, ignoring case and the spaces around the search. An empty search
 * matches everything.
 *
 * @param text The text to search in.
 * @param query The search as typed.
 * @returns True on a match.
 * @since 1.0.0
 */
export function matchesQuery(text: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return needle === "" || text.toLowerCase().includes(needle);
}

/** A node's name for display: the name the code gave it, or its label. */
function displayName(node: SnapshotNode): string {
  return node.name ?? node.label;
}

/** The nodes of the given kinds that match the search, in creation order. */
function nodesOfKinds(
  nodes: readonly SnapshotNode[],
  kinds: readonly SnapshotNode["type"][],
  query: string,
): SnapshotNode[] {
  return nodes
    .filter(
      (node) =>
        kinds.includes(node.type) &&
        (matchesQuery(displayName(node), query) || matchesQuery(node.preview, query)),
    )
    .sort((a, b) => a.id - b.id);
}

/**
 * The signals of the view, in creation order, matching the search by name, label or current value.
 *
 * @param nodes Every live node of the snapshot.
 * @param query The search text.
 * @returns The matching signal nodes.
 * @since 1.0.0
 */
export function signalNodes(nodes: readonly SnapshotNode[], query: string): SnapshotNode[] {
  return nodesOfKinds(nodes, ["signal"], query);
}

/**
 * The effects and memos of the view, in creation order, with their runs and durations.
 *
 * @param nodes Every live node of the snapshot.
 * @param query The search text.
 * @returns The matching computation nodes.
 * @since 1.0.0
 */
export function computationNodes(nodes: readonly SnapshotNode[], query: string): SnapshotNode[] {
  return nodesOfKinds(nodes, ["effect", "memo"], query);
}

/**
 * The resources of the view, in creation order, with their last state.
 *
 * @param nodes Every live node of the snapshot.
 * @param query The search text.
 * @returns The matching resource nodes.
 * @since 1.0.0
 */
export function resourceNodes(nodes: readonly SnapshotNode[], query: string): SnapshotNode[] {
  return nodesOfKinds(nodes, ["resource"], query);
}

/**
 * The stores of the view, in creation order, matching the search by name or by their current value.
 *
 * @param nodes Every live node of the snapshot.
 * @param query The search text.
 * @returns The matching store nodes.
 * @since 1.0.0
 */
export function storeNodes(nodes: readonly SnapshotNode[], query: string): SnapshotNode[] {
  return nodesOfKinds(nodes, ["store"], query);
}

/**
 * One write to a store: the top-level key (or array index) and the new value as JSON text. The agent
 * applies it with a `store-set` request.
 *
 * @since 1.0.0
 */
export interface StoreEdit {
  /** The key, or the index for an array store. */
  readonly path: Array<string | number>;
  /** The new value, as JSON text. */
  readonly text: string;
}

/**
 * The result of reading a store draft: the writes that change the store, or the reason the draft cannot
 * be applied.
 *
 * @since 1.0.0
 */
export type StoreDraft =
  | { readonly ok: true; readonly edits: StoreEdit[] }
  | { readonly ok: false; readonly error: string };

/**
 * Reads the JSON a person typed for a store and returns the writes that change it. Only the top-level keys
 * (or indices) whose JSON text differs are written, so unchanged parts of the store keep their identity.
 * A draft is refused when it is not JSON, when its root is not an object or an array of the store's kind,
 * or when it removes a key: a store cannot represent a missing key, so the user sets it to `null` instead.
 *
 * @param current The store's current value.
 * @param draft The text in the editor.
 * @returns The edits, or the error to show.
 * @example
 * import { storeEdits } from "./state";
 *
 * storeEdits({ items: [1] }, '{"items":[1,2]}'); // { ok: true, edits: [{ path: ["items"], text: "[1,2]" }] }
 * @since 1.0.0
 */
export function storeEdits(current: unknown, draft: string): StoreDraft {
  let next: unknown;
  try {
    next = JSON.parse(draft);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Not valid JSON: ${reason}` };
  }
  if (typeof next !== "object" || next === null) {
    return { ok: false, error: "The store is an object or an array: edit its keys." };
  }
  const currentIsArray = Array.isArray(current);
  const nextIsArray = Array.isArray(next);
  if (nextIsArray !== currentIsArray) {
    return {
      ok: false,
      error: currentIsArray
        ? "The store is an array: edit its indices, not its object form."
        : "The store is an object: edit its keys, not its array form.",
    };
  }
  const before: Record<string, unknown> =
    typeof current === "object" && current !== null ? { ...current } : {};
  const after: Record<string, unknown> = { ...next };
  for (const key of Object.keys(before)) {
    if (!Object.keys(after).includes(key)) {
      return { ok: false, error: `Removing "${key}" is not supported: set it to null instead.` };
    }
  }
  const edits: StoreEdit[] = [];
  for (const key of Object.keys(after)) {
    const value = after[key];
    if (JSON.stringify(before[key]) === JSON.stringify(value)) continue;
    edits.push({ path: [nextIsArray ? Number(key) : key], text: JSON.stringify(value) });
  }
  return { ok: true, edits };
}
