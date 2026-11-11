import { createRoot, flushSync, useResource, useSignal } from "@shadow-js/core";
import { useStore } from "@shadow-js/core/store";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";

afterEach(() => uninstallHook());

describe("[DVT-F055] disposing an owner retires the nodes it owned at once", () => {
  it("[DVT-F055.1] a resource, a signal and a store leave the live node count when their owner disposes, with no garbage collection", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const agent = createAgent();
    agent.attach(hook);
    const liveOf = (type: string): number =>
      [...agent.model.nodes.values()].filter((node) => node.type === type).length;

    const named = (name: string): number =>
      [...agent.model.nodes.values()].filter((node) => node.name === name).length;

    const before = agent.model.nodes.size;
    let stop: (() => void) | undefined;
    // The handles stay referenced below: the finalizer cannot be what retires them.
    const keep: unknown[] = [];
    createRoot((dispose) => {
      stop = dispose;
      const [count] = useSignal(1, { name: "count" });
      const [state] = useStore({ n: 1 }, { name: "state" });
      const resource = useResource(() => Promise.resolve(1), { name: "users", key: "k" });
      keep.push(count, state, resource);
    });
    flushSync();
    expect(liveOf("resource")).toBe(1);
    expect(liveOf("store")).toBe(1);
    expect(named("count")).toBe(1);
    expect(agent.model.nodes.size).toBeGreaterThan(before + 2);

    stop?.();
    flushSync();

    expect(liveOf("resource")).toBe(0);
    expect(liveOf("store")).toBe(0);
    expect(named("count")).toBe(0);
    expect(agent.model.nodes.size).toBe(before);
    expect(keep.length).toBe(3);
  });

  it("[DVT-F055.2] repeated create and dispose keeps the live set flat and the graveyard at its bound", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const agent = createAgent({ limits: { graveyard: 50 } });
    agent.attach(hook);
    const before = agent.model.nodes.size;
    const keep: unknown[] = [];
    for (let round = 0; round < 200; round += 1) {
      createRoot((dispose) => {
        const resource = useResource(() => Promise.resolve(round), { key: `k${round}` });
        const [value] = useSignal(round);
        keep.push(resource, value);
        dispose();
      });
    }
    flushSync();
    expect(agent.model.nodes.size).toBe(before);
    expect(agent.model.graveyard.size).toBeLessThanOrEqual(50);
    expect(keep.length).toBe(400);
  });
});
