import { describe, expect, it } from "vitest";
import { isModelState } from "../src/internal/wire-guard";
import { InspectorModel, type ModelState } from "../src/model";

/** The state of a model holding owners 1..count. */
function ownersState(count: number): ModelState {
  const model = new InspectorModel();
  for (let id = 1; id <= count; id += 1)
    model.apply({ k: "owner+", seq: id, t: 0, id, parent: 0, label: "owner" });
  return model.exportState();
}

/** The state of one owner whose edge lists hold `size` entries. */
function stateWithEdges(size: number): ModelState {
  const state = ownersState(1);
  const edges = Array.from({ length: size }, (_, at) => at);
  return { ...state, nodes: state.nodes.map((n) => ({ ...n, sources: edges, observers: edges })) };
}

describe("[DEVT-R7-1] an imported state respects maxNodes", () => {
  it("[DEVT-R7-1.1] nodes past the limit are counted in overflow, like nodes created live", () => {
    const model = new InspectorModel({ maxNodes: 3 });
    model.importState(ownersState(5));
    expect([...model.nodes.keys()]).toEqual([1, 2, 3]);
    expect(model.overflow).toBe(2);
  });

  it("[DEVT-R7-1.2] the overflow the state already carried is kept and added to", () => {
    const model = new InspectorModel({ maxNodes: 2 });
    model.importState({ ...ownersState(3), overflow: 7 });
    expect(model.nodes.size).toBe(2);
    expect(model.overflow).toBe(8);
  });

  it("[DEVT-R7-1.3] a state within the limit loads whole", () => {
    const model = new InspectorModel({ maxNodes: 3 });
    model.importState(ownersState(3));
    expect(model.nodes.size).toBe(3);
    expect(model.overflow).toBe(0);
  });
});

describe("[DEVT-R7-1] the guard caps the edge lists", () => {
  it("[DEVT-R7-1.4] a node with a huge sources or observers list is refused", () => {
    const huge = Array.from({ length: 100_001 }, (_, at) => at);
    const [one] = ownersState(1).nodes;
    if (one === undefined) throw new Error("the state has no node");
    expect(isModelState(ownersState(1))).toBe(true);
    expect(isModelState({ ...ownersState(1), nodes: [{ ...one, sources: huge }] })).toBe(false);
    expect(isModelState({ ...ownersState(1), nodes: [{ ...one, observers: huge }] })).toBe(false);
  });

  it("[DEVT-R7-1.5] a list at the cap is accepted", () => {
    expect(isModelState(stateWithEdges(100_000))).toBe(true);
  });
});
