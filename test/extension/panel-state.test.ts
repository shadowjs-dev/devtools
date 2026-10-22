import { describe, expect, it } from "vitest";
import {
  computationNodes,
  initialPanelState,
  matchesQuery,
  PANEL_TABS,
  type PanelAction,
  reducePanel,
  resourceNodes,
  signalNodes,
  stepTab,
  storeEdits,
  storeNodes,
} from "../../extension/src/panel/state";
import type { SnapshotNode } from "../../src/inspector";

function node(partial: Partial<SnapshotNode> & Pick<SnapshotNode, "id" | "type">): SnapshotNode {
  return {
    label: partial.type,
    name: undefined,
    parent: 0,
    children: [],
    depth: 0,
    isComponent: false,
    component: 0,
    sources: [],
    observers: [],
    runs: 0,
    updates: 0,
    lastDuration: 0,
    totalDuration: 0,
    preview: "",
    writes: 0,
    state: "",
    render: false,
    ...partial,
  };
}

const nodes: SnapshotNode[] = [
  node({ id: 3, type: "signal", name: "count", preview: "4", writes: 2 }),
  node({ id: 1, type: "signal", name: "label", preview: '"todo"' }),
  node({ id: 2, type: "memo", name: "doubled", runs: 3, updates: 2, lastDuration: 0.5 }),
  node({ id: 4, type: "effect", label: "effect", runs: 1 }),
  node({ id: 5, type: "resource", name: "todos", state: "success" }),
  node({ id: 6, type: "store", name: "cart", preview: '{"items":[]}' }),
  node({ id: 7, type: "owner", label: "<Counter>", isComponent: true }),
];

describe("[DVT-EXT-PS] the extension panel's state is a pure reducer", () => {
  it("[DVT-EXT-PS.1] the initial state is the components tab, no query, recording, dark", () => {
    expect(initialPanelState()).toEqual({
      tab: "components",
      query: "",
      paused: false,
      theme: "dark",
    });
    expect(PANEL_TABS.map((tab) => tab.id)).toEqual([
      "components",
      "signals",
      "stores",
      "effects",
      "timeline",
      "resources",
      "router",
      "queries",
      "issues",
    ]);
  });

  it("[DVT-EXT-PS.2] each action changes only its own field", () => {
    const start = initialPanelState();
    const cases: Array<[PanelAction, Partial<ReturnType<typeof initialPanelState>>]> = [
      [{ type: "tab", tab: "signals" }, { tab: "signals" }],
      [{ type: "query", text: "cou" }, { query: "cou" }],
      [{ type: "paused", on: true }, { paused: true }],
      [{ type: "theme", theme: "light" }, { theme: "light" }],
    ];
    for (const [action, change] of cases) {
      expect(reducePanel(start, action)).toEqual({ ...start, ...change });
    }
  });

  it("[DVT-EXT-PS.3] tab steps wrap in both directions and the first and last keys jump to the ends", () => {
    expect(stepTab("components", 1)).toBe("signals");
    expect(stepTab("issues", 1)).toBe("components");
    expect(stepTab("components", -1)).toBe("issues");
    let state = initialPanelState();
    state = reducePanel(state, { type: "edge", end: "last" });
    expect(state.tab).toBe("issues");
    state = reducePanel(state, { type: "edge", end: "first" });
    expect(state.tab).toBe("components");
    state = reducePanel(state, { type: "step", delta: -1 });
    expect(state.tab).toBe("issues");
    state = reducePanel(state, { type: "step", delta: -1 });
    expect(state.tab).toBe("queries");
  });

  it("[DVT-EXT-PS.4] the search matches case-insensitively and ignores surrounding spaces; an empty search matches everything", () => {
    expect(matchesQuery("Counter", "  cou ")).toBe(true);
    expect(matchesQuery("Counter", "")).toBe(true);
    expect(matchesQuery("Counter", "xyz")).toBe(false);
  });
});

describe("[DVT-EXT-PS2] the views select their nodes from the snapshot, filtered and in creation order", () => {
  it("[DVT-EXT-PS2.1] signals are listed by creation order and matched by name, label or value", () => {
    expect(signalNodes(nodes, "").map((n) => n.id)).toEqual([1, 3]);
    expect(signalNodes(nodes, "4").map((n) => n.id)).toEqual([3]);
    expect(signalNodes(nodes, "todo").map((n) => n.id)).toEqual([1]);
    expect(signalNodes(nodes, "nothing")).toEqual([]);
  });

  it("[DVT-EXT-PS2.2] effects and memos are listed with their runs and last duration", () => {
    expect(computationNodes(nodes, "").map((n) => n.id)).toEqual([2, 4]);
    expect(computationNodes(nodes, "doub").map((n) => n.id)).toEqual([2]);
  });

  it("[DVT-EXT-PS2.3] resources and stores are listed on their own", () => {
    expect(resourceNodes(nodes, "").map((n) => n.id)).toEqual([5]);
    expect(storeNodes(nodes, "").map((n) => n.id)).toEqual([6]);
    expect(storeNodes(nodes, "items").map((n) => n.id)).toEqual([6]);
  });
});

describe("[DVT-EXT-PS3] a store draft becomes the edits that change it, or an error", () => {
  const current = { items: [1], total: 1 };

  it("[DVT-EXT-PS3.1] only the top-level keys that changed are edited, each as JSON text", () => {
    const result = storeEdits(current, JSON.stringify({ items: [1, 2], total: 1 }));
    expect(result).toEqual({
      ok: true,
      edits: [{ path: ["items"], text: "[1,2]" }],
    });
  });

  it("[DVT-EXT-PS3.2] an unchanged draft has no edits", () => {
    expect(storeEdits(current, JSON.stringify(current))).toEqual({ ok: true, edits: [] });
  });

  it("[DVT-EXT-PS3.3] invalid JSON, a scalar root and a root of another kind are refused with a reason", () => {
    expect(storeEdits(current, "{nope")).toMatchObject({ ok: false });
    expect(storeEdits(current, "42")).toEqual({
      ok: false,
      error: "The store is an object or an array: edit its keys.",
    });
    expect(storeEdits(current, "[1]")).toEqual({
      ok: false,
      error: "The store is an object: edit its keys, not its array form.",
    });
  });

  it("[DVT-EXT-PS3.4] removing a key is refused, because the store cannot represent a missing key", () => {
    expect(storeEdits(current, JSON.stringify({ items: [1] }))).toEqual({
      ok: false,
      error: 'Removing "total" is not supported: set it to null instead.',
    });
  });

  it("[DVT-EXT-PS3.5] array stores edit their indices as numbers", () => {
    expect(storeEdits([1, 2], "[1,3]")).toEqual({
      ok: true,
      edits: [{ path: [1], text: "3" }],
    });
  });
});
