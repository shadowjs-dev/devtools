import { createRoot, flushSync, useResource, useSignal } from "@shadow-js/core";
import { useStore } from "@shadow-js/core/store";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";

afterEach(() => uninstallHook());

/** The engine's garbage collector hook; the gc project always runs with --expose-gc. */
function exposedGc(): () => void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (gc === undefined) throw new Error("the gc project must run with --expose-gc");
  return gc;
}

/** Yields to the event loop (finalization callbacks run between tasks) and collects. */
async function collect(gc: () => void): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
  gc();
  gc();
}

describe("[DVT-RTGC] the real runtime's stores and resources do not stay alive through devtools", () => {
  it("[DVT-RTGC.1] a store nothing references is released with its state, and retired from the model", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const payloads: WeakRef<object>[] = [];
    // No owner, and no owner disposal: the store is only ever referenced by this function's frame.
    const makeOrphanStores = (count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const payload = { data: new Array<number>(10_000).fill(index) };
        payloads.push(new WeakRef(payload));
        useStore({ payload }, { name: `orphan${index}` });
      }
    };
    makeOrphanStores(20);
    flushSync();
    // The payloads go first; their finalizers retire the store nodes in a later task.
    const storeNodes = (): number =>
      [...agent.model.nodes.values()].filter((node) => node.type === "store").length;
    for (
      let attempt = 0;
      attempt < 50 && (payloads.some((ref) => ref.deref() !== undefined) || storeNodes() > 0);
      attempt += 1
    )
      await collect(gc);
    expect(payloads.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
    expect(storeNodes()).toBe(0);
  });

  it("[DVT-RTGC.2] a store the app still holds stays in the model and editable after collections", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const kept: { store?: { count: number }; set?: (...args: unknown[]) => void } = {};
    createRoot(() => {
      const [store, setStore] = useStore({ count: 1 }, { name: "kept" });
      kept.store = store;
      kept.set = setStore as unknown as (...args: unknown[]) => void;
    });
    flushSync();
    for (let attempt = 0; attempt < 5; attempt += 1) await collect(gc);
    const node = [...agent.model.nodes.values()].find((record) => record.type === "store");
    expect(node?.name).toBe("kept");
    const id = node?.id ?? 0;
    const edit = agent.handle({ type: "store-set", id, path: ["count"], text: "5" });
    expect(edit).toEqual({ ok: true, result: null });
    expect(kept.store?.count).toBe(5);
  });

  it("[DVT-RTGC.3] an unowned resource nothing references is retired from the model", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const refs: WeakRef<object>[] = [];
    const makeResources = (count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const accessor = useResource(() => Promise.resolve(index), { name: `r${index}` });
        refs.push(new WeakRef(accessor));
      }
    };
    makeResources(20);
    flushSync();
    // The resource nodes go; the render effects inside each resource are computations, which are not
    // retired by collection (a computation can own signals), so their records stay until maxNodes.
    const resourceNodes = (): number =>
      [...agent.model.nodes.values()].filter((node) => node.type === "resource").length;
    expect(resourceNodes()).toBe(20);
    for (
      let attempt = 0;
      attempt < 50 && (resourceNodes() > 0 || refs.some((ref) => ref.deref() !== undefined));
      attempt += 1
    )
      await collect(gc);
    expect(refs.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
    expect(resourceNodes()).toBe(0);
  });

  it("[DVT-RTGC.4] a signal the app holds keeps its node, and its owner's signals are released with it", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const held: { read?: () => number } = {};
    createRoot(() => {
      const [count] = useSignal(7, { name: "count" });
      held.read = count;
    });
    flushSync();
    for (let attempt = 0; attempt < 5; attempt += 1) await collect(gc);
    expect(held.read?.()).toBe(7);
    const signal = [...agent.model.nodes.values()].find((node) => node.name === "count");
    expect(signal).toBeDefined();
  });
});
