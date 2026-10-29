import { afterEach, describe, expect, it } from "vitest";
import { inspectedPing } from "../../extension/src/bridge";
import { type PageHookWindow, startPageAgent, watchInspections } from "../../extension/src/page";
import { installHook, uninstallHook } from "../../src/hook";
import { type InspectionSource, registerInspection } from "../../src/inspection";
import { HOOK_KEY, PROTOCOL_VERSION } from "../../src/protocol";
import { CHANNEL } from "../../src/transport";

afterEach(() => uninstallHook());

/** A window with a message listener the test can call, as the page's window has. */
function fakePageWindow(): PageHookWindow & {
  posts: Array<{ message: unknown; origin: string }>;
  dispatch(event: { source: unknown; origin: string; data: unknown }): void;
} {
  const listeners = new Set<(event: MessageEvent) => void>();
  const posts: Array<{ message: unknown; origin: string }> = [];
  const window = {
    posts,
    postMessage(message: unknown, origin: string) {
      posts.push({ message, origin });
    },
    addEventListener(_type: "message", listener: (event: MessageEvent) => void) {
      listeners.add(listener);
    },
    removeEventListener(_type: "message", listener: (event: MessageEvent) => void) {
      listeners.delete(listener);
    },
    dispatch(event: { source: unknown; origin: string; data: unknown }) {
      for (const listener of [...listeners]) listener(event as unknown as MessageEvent);
    },
  };
  return window;
}

describe("[DVT-EXT-PG] the page hook installs the hook and answers the panel over the window", () => {
  it("[DVT-EXT-PG.1] startPageAgent installs the hook, and the agent answers a panel hello with an agent hello", () => {
    const win = fakePageWindow();
    const stop = startPageAgent({ window: win, origin: "http://localhost:5173" });
    expect(stop).toBeTypeOf("function");
    expect(Reflect.get(globalThis, HOOK_KEY)).toBeDefined();
    win.dispatch({
      source: win,
      origin: "http://localhost:5173",
      data: { channel: CHANNEL, v: PROTOCOL_VERSION, from: "panel", type: "hello" },
    });
    expect(win.posts).toEqual([
      {
        message: {
          channel: CHANNEL,
          v: PROTOCOL_VERSION,
          from: "agent",
          type: "hello",
          instance: expect.any(String),
        },
        origin: "http://localhost:5173",
      },
    ]);
    stop?.();
  });

  it("[DVT-EXT-PG.2] a request from another origin or window is ignored", () => {
    const win = fakePageWindow();
    startPageAgent({ window: win, origin: "http://localhost:5173" });
    win.dispatch({
      source: win,
      origin: "https://evil.example",
      data: { channel: CHANNEL, v: PROTOCOL_VERSION, from: "panel", type: "hello" },
    });
    win.dispatch({
      source: {},
      origin: "http://localhost:5173",
      data: { channel: CHANNEL, v: PROTOCOL_VERSION, from: "panel", type: "hello" },
    });
    expect(win.posts).toEqual([]);
  });

  it("[DVT-EXT-PG.3] when another hook of a different protocol version is installed, nothing is served", () => {
    Reflect.set(globalThis, HOOK_KEY, {
      version: PROTOCOL_VERSION + 1,
      report() {
        // Nothing to report to in this test.
      },
      attach: () => () => {
        // Detaching is not needed here.
      },
    });
    expect(
      startPageAgent({ window: fakePageWindow(), origin: "http://localhost" }),
    ).toBeUndefined();
  });
});

describe("[DVT-EXT-PG2] the page tells the panel when an inspection source changed", () => {
  it("[DVT-EXT-PG2.1] watchInspections subscribes to every subscribable source, now and when it registers later; stop removes the subscriptions and restores the hook", () => {
    const target = {};
    const hook = installHook({ target });
    if (hook === undefined) throw new Error("the hook is not installed");
    const original = hook.inspect;
    const register = (name: string, source: InspectionSource): boolean =>
      hook.inspect?.(name, source) ?? false;
    const active = new Map<string, number>();
    const notifiers = new Map<string, () => void>();
    const subscribable = (name: string): InspectionSource => ({
      title: name,
      rows: () => [],
      subscribe(notify) {
        active.set(name, (active.get(name) ?? 0) + 1);
        notifiers.set(name, notify);
        return () => {
          active.set(name, (active.get(name) ?? 1) - 1);
          notifiers.delete(name);
        };
      },
    });
    const plain: InspectionSource = { title: "plain", rows: () => [] };
    register("early", subscribable("early"));
    register("plain", plain);
    let changes = 0;
    const stop = watchInspections(hook, () => {
      changes += 1;
    });
    expect(active.get("early")).toBe(1);
    expect(active.has("plain")).toBe(false);
    register("late", subscribable("late"));
    expect(active.get("late")).toBe(1);
    register("early", subscribable("early"));
    expect(active.get("early")).toBe(1);
    notifiers.get("late")?.();
    expect(changes).toBe(1);
    stop();
    expect(active.get("early")).toBe(0);
    expect(active.get("late")).toBe(0);
    expect(hook.inspect).toBe(original);
    notifiers.get("late")?.();
    expect(changes).toBe(1);
  });

  it("[DVT-EXT-PG2.2] startPageAgent posts one inspected ping per burst of source changes, from the page's origin", async () => {
    const win = fakePageWindow();
    const stop = startPageAgent({ window: win, origin: "http://localhost:5173" });
    let notify: (() => void) | undefined;
    expect(
      registerInspection("live", {
        title: "Live",
        rows: () => [],
        subscribe(listener) {
          notify = listener;
          return () => undefined;
        },
      }),
    ).toBe(true);
    notify?.();
    notify?.();
    notify?.();
    expect(win.posts).toEqual([]);
    await Promise.resolve();
    expect(win.posts).toEqual([{ message: inspectedPing(), origin: "http://localhost:5173" }]);
    stop?.();
  });
});
