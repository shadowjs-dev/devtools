import { describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import { EVENT } from "../src/protocol";

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

describe("[DVT-16] the agent never keeps the application's objects alive", () => {
  it("[DVT-16.1] signals nobody references are released, retired from the model and forgotten", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const owner = {};
    hook.report(EVENT.OWNER_CREATED, owner, null, "root", "App");

    const refs: WeakRef<object>[] = [];
    const make = (): void => {
      for (let index = 0; index < 5_000; index += 1) {
        const signal = { value: index };
        refs.push(new WeakRef(signal));
        hook.report(EVENT.SIGNAL_CREATED, signal, owner, `s${index}`, index);
      }
    };
    make();
    expect(agent.model.nodes.size).toBe(5_001);

    // The signals are unreachable now (the owner stays alive): the agent must not be holding them.
    await collect(gc);
    expect(refs.filter((ref) => ref.deref() === undefined).length).toBe(5_000);

    // Their finalizers retire them from the model, so the graph does not fill with dead signals.
    for (let attempt = 0; attempt < 50 && agent.model.nodes.size > 1; attempt += 1)
      await collect(gc);
    expect(agent.model.nodes.size).toBe(1);
    expect(agent.model.node(1)?.name).toBe("App");
    uninstallHook();
  });

  it("[DVT-16.3] store handles the model cannot keep (beyond maxNodes) are released", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent({ limits: { maxNodes: 1 } });
    agent.attach(hook);
    const owner = {};
    hook.report(EVENT.OWNER_CREATED, owner, null, "root", "App");

    const refs: WeakRef<object>[] = [];
    // A separate function: its frame (and so the last handle) is gone before the collections below.
    const reportStores = (count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const handle = { name: "store", snapshot: (): unknown => null, set: (): void => undefined };
        refs.push(new WeakRef(handle));
        hook.report(EVENT.STORE_CREATED, handle, owner);
      }
    };
    reportStores(100);
    // Nothing is buried for a node the model never kept, so only the agent's own references could hold them.
    expect(agent.model.overflow).toBe(100);
    for (
      let attempt = 0;
      attempt < 50 && refs.some((ref) => ref.deref() !== undefined);
      attempt += 1
    )
      await collect(gc);
    expect(refs.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
    uninstallHook();
  });

  it("[DVT-16.4] a store handle nobody holds is released with its state and retired from the model", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const owner = {};
    hook.report(EVENT.OWNER_CREATED, owner, null, "root", "App");

    const payloads: WeakRef<object>[] = [];
    // An owner-less store: nothing disposes it, so only the agent's own references could keep it alive.
    const reportStores = (count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const payload = { data: new Array<number>(1_000).fill(index) };
        payloads.push(new WeakRef(payload));
        const handle = {
          name: "orphan",
          snapshot: (): number => payload.data.length,
          set: (): void => undefined,
        };
        hook.report(EVENT.STORE_CREATED, handle, null);
      }
    };
    reportStores(50);
    expect(agent.model.nodes.size).toBe(51);
    for (
      let attempt = 0;
      attempt < 50 &&
      (payloads.some((ref) => ref.deref() !== undefined) || agent.model.nodes.size > 1);
      attempt += 1
    )
      await collect(gc);
    expect(payloads.filter((ref) => ref.deref() !== undefined)).toHaveLength(0);
    expect(agent.model.nodes.size).toBe(1);
    uninstallHook();
  });

  it("[DVT-16.5] a store the caller still holds stays in the model and editable after a collection", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const owner = {};
    hook.report(EVENT.OWNER_CREATED, owner, null, "root", "App");
    const handle = {
      name: "kept",
      snapshot: (): unknown => ({ n: 1 }),
      set: (): void => undefined,
    };
    hook.report(EVENT.STORE_CREATED, handle, owner);
    for (let attempt = 0; attempt < 5; attempt += 1) await collect(gc);
    const store = [...agent.model.nodes.values()].find((node) => node.type === "store");
    expect(store).toBeDefined();
    const response = agent.handle({ type: "store", id: store?.id ?? 0 });
    expect(response.ok).toBe(true);
    uninstallHook();
  });

  it("[DVT-16.6] a resource nobody holds is retired from the model, as signals are", async () => {
    const gc = exposedGc();
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const owner = {};
    hook.report(EVENT.OWNER_CREATED, owner, null, "root", "App");
    const refs: WeakRef<object>[] = [];
    // Owner-less resources: no owner disposal will ever announce them.
    const reportResources = (count: number): void => {
      for (let index = 0; index < count; index += 1) {
        const accessor = (): number => index;
        refs.push(new WeakRef(accessor));
        hook.report(EVENT.RESOURCE_STATE, accessor, "ready", `r${index}`, null);
      }
    };
    reportResources(200);
    expect(agent.model.nodes.size).toBe(201);
    for (let attempt = 0; attempt < 50 && agent.model.nodes.size > 1; attempt += 1)
      await collect(gc);
    expect(agent.model.nodes.size).toBe(1);
    expect(agent.model.node(1)?.name).toBe("App");
    uninstallHook();
  });

  it("[DVT-16.2] disposed owners and the hook's replay buffer do not pin objects either", async () => {
    const gc = exposedGc();
    const hook = installHook({ buffer: 10_000 });
    if (hook === undefined) throw new Error("no hook");
    // Events reported before any sink attaches are buffered: they hold the objects only until a sink arrives.
    const early: WeakRef<object>[] = [];
    const report = (): void => {
      for (let index = 0; index < 100; index += 1) {
        const owner = {};
        early.push(new WeakRef(owner));
        hook.report(EVENT.OWNER_CREATED, owner, null, "root", `o${index}`);
        hook.report(EVENT.OWNER_DISPOSED, owner);
      }
    };
    report();
    const agent = createAgent();
    agent.attach(hook);
    expect(agent.model.nodes.size).toBe(0);
    await collect(gc);
    expect(early.filter((ref) => ref.deref() === undefined).length).toBe(100);
    uninstallHook();
  });
});
