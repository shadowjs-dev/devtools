import { afterEach, describe, expect, it } from "vitest";
import { getHook, installHook, uninstallHook } from "../src/hook";
import { EVENT, HOOK_KEY, type HookSink, PROTOCOL_VERSION } from "../src/protocol";

class Recorder implements HookSink {
  readonly received: Array<[number, unknown, unknown, unknown, unknown, unknown]> = [];
  receive(kind: number, a: unknown, b: unknown, c: unknown, d: unknown, e: unknown): void {
    this.received.push([kind, a, b, c, d, e]);
  }
}

afterEach(() => uninstallHook());

describe("[DVT-02] the dev hook", () => {
  it("[DVT-02.1] installs once at the documented global and is versioned", () => {
    const hook = installHook();
    expect(hook).toBeDefined();
    expect(Reflect.get(globalThis, "__SHADOWJS_DEVTOOLS_HOOK__")).toBe(hook);
    expect(HOOK_KEY).toBe("__SHADOWJS_DEVTOOLS_HOOK__");
    expect(hook?.version).toBe(PROTOCOL_VERSION);
    expect(installHook()).toBe(hook);
    expect(getHook()).toBe(hook);
  });

  it("[DVT-02.2] delivers events to every sink with the runtime's own objects", () => {
    const hook = installHook();
    const first = new Recorder();
    const second = new Recorder();
    hook?.attach(first);
    hook?.attach(second);
    const node = { value: 1 };
    hook?.report(EVENT.SIGNAL_WRITTEN, node, 2, null, null);
    expect(first.received).toEqual([[EVENT.SIGNAL_WRITTEN, node, 2, null, null, undefined]]);
    expect(first.received[0]?.[1]).toBe(node);
    expect(second.received).toHaveLength(1);
    expect(hook?.sinks).toBe(2);
  });

  it("[DVT-02.3] buffers events until the first sink attaches, then replays them in order", () => {
    const hook = installHook();
    hook?.report(EVENT.OWNER_CREATED, "a");
    hook?.report(EVENT.OWNER_CREATED, "b");
    const late = new Recorder();
    hook?.attach(late);
    expect(late.received.map((entry) => entry[1])).toEqual(["a", "b"]);
    const later = new Recorder();
    hook?.attach(later);
    expect(later.received).toEqual([]);
  });

  it("[DVT-02.4] the replay buffer is bounded", () => {
    const hook = installHook({ buffer: 3 });
    for (let i = 0; i < 10; i += 1) hook?.report(EVENT.OWNER_CREATED, i);
    const late = new Recorder();
    hook?.attach(late);
    expect(late.received.map((entry) => entry[1])).toEqual([0, 1, 2]);
  });

  it("[DVT-02.5] a throwing sink never breaks the runtime and is counted", () => {
    const hook = installHook();
    const boom = new Error("tool bug");
    hook?.attach({
      receive() {
        throw boom;
      },
    });
    const healthy = new Recorder();
    hook?.attach(healthy);
    expect(() => hook?.report(EVENT.ERROR, null, new Error("x"))).not.toThrow();
    expect(hook?.faults).toBe(1);
    expect(hook?.lastFault).toBe(boom);
    expect(healthy.received).toHaveLength(1);
  });

  it("[DVT-02.6] detach stops delivery", () => {
    const hook = installHook();
    const sink = new Recorder();
    const detach = hook?.attach(sink);
    hook?.report(EVENT.FLUSH_START, 0, 0);
    detach?.();
    hook?.report(EVENT.FLUSH_END, 0);
    expect(sink.received).toHaveLength(1);
    expect(hook?.sinks).toBe(0);
  });

  it("[DVT-02.7] a hook with another protocol version is left alone", () => {
    const target = {};
    Reflect.set(target, HOOK_KEY, {
      version: 99,
      report: () => undefined,
      attach: () => () => undefined,
    });
    expect(installHook({ target })).toBeUndefined();
    expect(getHook(target)).toBeUndefined();
    expect(Reflect.get(target, HOOK_KEY)).toHaveProperty("version", 99);
  });

  it("[DVT-02.8] installs on any target object and uninstalls cleanly", () => {
    const target = {};
    const hook = installHook({ target });
    expect(getHook(target)).toBe(hook);
    expect(getHook()).toBeUndefined();
    uninstallHook(target);
    expect(getHook(target)).toBeUndefined();
  });

  it("[DVT-02.9] event kinds are unique numbers", () => {
    const values = Object.values(EVENT);
    expect(new Set(values).size).toBe(values.length);
    expect(values.every((value) => Number.isInteger(value) && value > 0)).toBe(true);
  });
});
