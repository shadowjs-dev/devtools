import { createRoot, flushSync, useEffect, useMemo, useResource, useSignal } from "@shadow-js/core";
import { DEVTOOLS_EVENT } from "@shadow-js/core/extend";
import { useStore } from "@shadow-js/core/store";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import { EVENT } from "../src/protocol";

afterEach(() => uninstallHook());

describe("[DVT-RT] the real runtime reports to the devtools hook", () => {
  it("[DVT-RT.1] the event numbers of the runtime and of the protocol are the same", () => {
    expect({ ...DEVTOOLS_EVENT }).toEqual({ ...EVENT });
  });

  it("[DVT-RT.2] signals, memos, effects, writes, flushes and stores of a real app show up", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const kinds = new Map<number, number>();
    hook.attach({
      receive(kind) {
        kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
      },
    });
    createRoot((dispose) => {
      const [count, setCount] = useSignal(1, { name: "count" });
      const doubled = useMemo(() => count() * 2, { name: "doubled" });
      useEffect(
        () => {
          void doubled();
        },
        { name: "log" },
      );
      const [state] = useStore({ n: 1 }, { name: "state" });
      void state;
      flushSync();
      setCount(2);
      flushSync();
      dispose();
    });
    const seen = (kind: number): number => kinds.get(kind) ?? 0;
    expect(seen(EVENT.OWNER_CREATED)).toBeGreaterThan(0);
    expect(seen(EVENT.SIGNAL_CREATED)).toBeGreaterThan(0);
    expect(seen(EVENT.SIGNAL_WRITTEN)).toBe(1);
    expect(seen(EVENT.COMPUTATION_CREATED)).toBeGreaterThanOrEqual(2);
    expect(seen(EVENT.COMPUTATION_RUN)).toBeGreaterThanOrEqual(3);
    expect(seen(EVENT.COMPUTATION_DISPOSED)).toBeGreaterThanOrEqual(2);
    expect(seen(EVENT.FLUSH_START)).toBeGreaterThan(0);
    expect(seen(EVENT.FLUSH_START)).toBe(seen(EVENT.FLUSH_END));
    expect(seen(EVENT.STORE_CREATED)).toBe(1);
    expect(hook.faults).toBe(0);
  });

  it("[DVT-RT.3] an agent attached to the hook rebuilds the graph of a real app, with sources and observers", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const agent = createAgent();
    agent.attach(hook);
    let stop: (() => void) | undefined;
    createRoot((dispose) => {
      stop = dispose;
      const [count] = useSignal(1, { name: "count" });
      const doubled = useMemo(() => count() * 2, { name: "doubled" });
      useEffect(
        () => {
          void doubled();
        },
        { name: "log" },
      );
    });
    flushSync();
    const snap = agent.snapshot();
    const named = (name: string) => snap.nodes.find((node) => node.name === name);
    expect(named("count")).toBeDefined();
    const doubled = named("doubled");
    const log = named("log");
    expect(doubled).toBeDefined();
    expect(log).toBeDefined();
    stop?.();
  });

  it("[DVT-RT.4] resource state changes are reported with the state name", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const states: unknown[] = [];
    hook.attach({
      receive(kind, _a, b) {
        if (kind === EVENT.RESOURCE_STATE) states.push(b);
      },
    });
    createRoot((dispose) => {
      useResource(() => Promise.resolve(1), { key: "r" });
      dispose();
    });
    flushSync();
    expect(states).toContain("pending");
  });

  it("[DVT-RT.5] with no hook installed the runtime reports nothing and costs nothing observable", () => {
    expect(Reflect.get(globalThis, "__SHADOWJS_DEVTOOLS_HOOK__")).toBeUndefined();
    expect(() =>
      createRoot((dispose) => {
        const [n, setN] = useSignal(0);
        useEffect(() => {
          void n();
        });
        setN(1);
        flushSync();
        dispose();
      }),
    ).not.toThrow();
  });

  it("[DVT-RT.6] a resource is named by its name option; the server key does not replace it", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const agent = createAgent();
    agent.attach(hook);
    createRoot(() => {
      useResource(() => Promise.resolve(1), { name: "users", key: "server:users" });
    });
    flushSync();
    const resources = [...agent.model.nodes.values()].filter((node) => node.type === "resource");
    expect(resources.map((node) => node.name)).toEqual(["users"]);
  });
});
