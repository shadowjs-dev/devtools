import { observersOf, sourcesOf } from "@shadow-js/core/extend";
import { snapshot, useStore } from "@shadow-js/core/store";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import { componentStats, explainRun, flameTimeline } from "../src/inspector";
import { EVENT, type WireEvent } from "../src/protocol";
import { instrument } from "./support/instrument";

afterEach(() => uninstallHook({ target: {} }));

function setup() {
  const hook = installHook({ target: {} });
  if (hook === undefined) throw new Error("hook not installed");
  const rt = instrument(hook);
  const agent = createAgent({
    now: () => rt.clock.now,
    writeSignal: (node, value) => rt.writeNode(node as never, value),
  });
  agent.attach(hook);
  return { hook, rt, agent };
}

/** App -> Counter(count signal, doubled memo, title effect) built with the real engine. */
function buildApp(rt: ReturnType<typeof instrument>) {
  const log: number[] = [];
  const app = rt.component("App", () => {
    const counter = rt.component("Counter", () => {
      const count = rt.signal(1, "count");
      const doubled = rt.memo(() => count.read() * 2, "doubled");
      const title = rt.effect(() => {
        log.push(doubled.read());
      }, "title");
      return { count, doubled, title };
    });
    return counter;
  });
  return { app, counter: app.result, log };
}

describe("[DVT-06] the agent records a real instrumented graph", () => {
  it("[DVT-06.1] reconstructs owners, computations, sources and observers equal to the engine's own edges", () => {
    const { rt, agent } = setup();
    const { counter } = buildApp(rt);
    const { count, doubled, title } = counter.result;
    rt.flush();
    count.write(5);
    rt.flush();

    const snap = agent.snapshot();
    const byName = (name: string) => snap.nodes.find((node) => node.name === name);
    const namesOf = (ids: number[]) =>
      ids.map((id) => snap.nodes.find((n) => n.id === id)?.name).sort();

    // The model's edges equal the engine's.
    expect(namesOf(byName("doubled")?.sources ?? [])).toEqual(["count"]);
    expect(namesOf(byName("title")?.sources ?? [])).toEqual(["doubled"]);
    expect(namesOf(byName("count")?.observers ?? [])).toEqual(["doubled"]);
    expect(namesOf(byName("doubled")?.observers ?? [])).toEqual(["title"]);
    expect(observersOf(count.node).map((node) => node.name)).toEqual(["doubled"]);
    expect(sourcesOf(doubled.node).map((source) => (source as { name?: string }).name)).toEqual([
      "count",
    ]);
    expect(sourcesOf(title).map((source) => (source as { name?: string }).name)).toEqual([
      "doubled",
    ]);

    // The ownership tree: App > Counter > (count, doubled, title).
    const app = byName("App");
    const counterNode = byName("Counter");
    expect(app?.children).toEqual([counterNode?.id]);
    expect(namesOf(counterNode?.children ?? [])).toEqual(["count", "doubled", "title"]);
    expect(snap.counts).toMatchObject({ components: 2, signals: 1, memos: 1, effects: 1 });
  });

  it("[DVT-06.2] counts updates per component and explains why the effect re-ran", () => {
    const { rt, agent } = setup();
    const { counter } = buildApp(rt);
    rt.flush();
    counter.result.count.write(2);
    rt.flush();
    counter.result.count.write(3);
    rt.flush();

    const stats = componentStats(agent.model);
    expect(stats.find((stat) => stat.name === "Counter")).toMatchObject({
      computations: 2,
      updates: 4,
    });
    expect(stats.find((stat) => stat.name === "App")).toMatchObject({ updates: 0 });

    const titleId = agent.snapshot().nodes.find((node) => node.name === "title")?.id ?? -1;
    const why = explainRun(agent.model, titleId);
    expect(why?.chain.map((step) => `${step.kind}:${step.label}`)).toEqual([
      "write:count",
      "run:doubled",
      "run:title",
    ]);
    expect(why?.chain[0]?.preview).toBe("3");
  });

  it("[DVT-06.3] lays flushes out with queue sizes and nests a memo first read inside an effect", () => {
    const { rt, agent } = setup();
    const { counter } = buildApp(rt);
    rt.flush();
    counter.result.count.write(9);
    rt.flush();
    const flushes = flameTimeline(agent.model);
    const last = flushes[flushes.length - 1];
    expect(last).toMatchObject({ render: 0, user: 1 });
    expect(last?.spans.map((span) => span.label).sort()).toEqual(["doubled", "title"]);

    // A lazy memo is computed by the effect that first reads it: its run nests inside the effect's.
    const lazy = rt.signal(1, "lazy-source");
    const late = rt.memo(() => lazy.read() + 1, "late", { lazy: true });
    rt.effect(() => {
      late.read();
    }, "reader");
    rt.flush();
    const nested = flameTimeline(agent.model).at(-1);
    const memoSpan = nested?.spans.find((span) => span.label === "late");
    const effectSpan = nested?.spans.find((span) => span.label === "reader");
    expect(effectSpan?.depth).toBe(0);
    expect(memoSpan?.depth).toBe(1);
    expect(nested?.lanes).toBe(2);
  });

  it("[DVT-06.4] disposing a component retires its computations and signals", () => {
    const { rt, agent } = setup();
    const { app, counter } = buildApp(rt);
    rt.flush();
    expect(agent.snapshot().counts.nodes).toBe(5);
    rt.dispose(counter.owner);
    const snap = agent.snapshot();
    expect(snap.nodes.map((node) => node.name)).toEqual(["App"]);
    expect(agent.model.node(snap.nodes[0]?.id ?? 0)?.alive).toBe(true);
    rt.dispose(app.owner);
    expect(agent.snapshot().nodes).toEqual([]);
    // Everything stays nameable for history.
    expect([...agent.model.graveyard.values()].map((node) => node.name).sort()).toEqual(
      ["App", "Counter", "count", "doubled", "title"].sort(),
    );
  });

  it("[DVT-06.5] the value editor writes the real signal and the write is recorded with its effects", () => {
    const { rt, agent } = setup();
    const { counter, log } = buildApp(rt);
    rt.flush();
    const countId = agent.snapshot().nodes.find((node) => node.name === "count")?.id ?? -1;
    const read = agent.handle({ type: "value", id: countId });
    expect(read).toEqual({
      ok: true,
      result: { id: countId, kind: "signal", text: "1", editable: true },
    });
    expect(agent.handle({ type: "write", id: countId, text: "21" })).toEqual({
      ok: true,
      result: null,
    });
    rt.flush();
    expect(counter.result.count.node.value).toBe(21);
    expect(log.at(-1)).toBe(42);
    const titleId = agent.snapshot().nodes.find((node) => node.name === "title")?.id ?? -1;
    expect(explainRun(agent.model, titleId)?.chain[0]).toMatchObject({
      kind: "write",
      preview: "21",
    });
    expect(agent.handle({ type: "write", id: countId, text: "{nope" })).toMatchObject({
      ok: false,
    });
    expect(agent.handle({ type: "value", id: 99_999 })).toEqual({
      ok: false,
      error: "The signal is gone.",
    });
  });

  it("[DVT-06.6] without a writer signals are read-only", () => {
    const hook = installHook({ target: {} });
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const rt = instrument(hook);
    const signal = rt.signal(1, "n");
    const id = agent.snapshot().nodes[0]?.id ?? -1;
    expect(agent.handle({ type: "value", id })).toMatchObject({
      ok: true,
      result: { editable: false },
    });
    expect(agent.handle({ type: "write", id, text: "2" })).toEqual({
      ok: false,
      error: "Editing is not enabled.",
    });
    expect(signal.node.value).toBe(1);
  });

  it("[DVT-06.7] work done inside quiet() and everything below it is invisible", () => {
    const { rt, agent } = setup();
    let hidden: ReturnType<typeof rt.signal<number>> | undefined;
    agent.quiet(() => {
      const ui = rt.owner("panel");
      hidden = rt.signal(0, "ui-state");
      rt.effect(() => {
        hidden?.read();
      }, "ui-effect");
      // A node created later under an ignored owner is ignored too.
      void ui;
    });
    hidden?.write(1);
    rt.flush();
    expect(agent.snapshot().nodes).toEqual([]);
    expect(agent.stats.ignored).toBeGreaterThan(0);
    expect(agent.stats.unknown).toBe(0);
  });

  it("[DVT-06.8] events about objects created before the agent attached are counted, not guessed", () => {
    const hook = installHook({ target: {} });
    if (hook === undefined) throw new Error("no hook");
    // The first sink drains the replay buffer, so a later agent misses what was created before it.
    createAgent().attach(hook);
    const rt = instrument(hook);
    const early = rt.signal(0, "early");
    const agent = createAgent();
    const detach = agent.attach(hook);
    early.write(1);
    expect(agent.stats.unknown).toBe(1);
    expect(agent.snapshot().nodes).toEqual([]);
    detach();
    early.write(2);
    expect(agent.stats.received).toBe(1);
  });

  it("[DVT-06.8b] an agent that attaches late still sees what the hook buffered", () => {
    const hook = installHook({ target: {} });
    if (hook === undefined) throw new Error("no hook");
    const rt = instrument(hook);
    rt.signal(0, "buffered");
    const agent = createAgent();
    agent.attach(hook);
    expect(agent.snapshot().nodes.map((node) => node.name)).toEqual(["buffered"]);
  });

  it("[DVT-06.9] pause stops recording; resume continues; clear forgets", () => {
    const { rt, agent } = setup();
    const signal = rt.signal(0, "s");
    agent.pause();
    signal.write(1);
    agent.resume();
    signal.write(2);
    expect(agent.model.node(agent.snapshot().nodes[0]?.id ?? 0)?.writes).toBe(1);
    expect(agent.handle({ type: "pause" })).toEqual({ ok: true, result: null });
    expect(agent.paused).toBe(true);
    expect(agent.handle({ type: "resume" })).toEqual({ ok: true, result: null });
    expect(agent.handle({ type: "clear" })).toEqual({ ok: true, result: null });
    expect(agent.snapshot().nodes).toEqual([]);
    expect(agent.events.size).toBe(0);
  });

  it("[DVT-06.10] subscribers get ordered batches once per microtask", async () => {
    const { rt, agent } = setup();
    const batches: WireEvent[][] = [];
    agent.subscribe((events) => batches.push([...events]));
    const signal = rt.signal(0, "s");
    signal.write(1);
    signal.write(2);
    expect(batches).toEqual([]);
    await Promise.resolve();
    expect(batches).toHaveLength(1);
    expect(batches[0]?.map((event) => event.k)).toEqual(["signal+", "write", "write"]);
    const seqs = batches[0]?.map((event) => event.seq) ?? [];
    expect(seqs).toEqual([1, 2, 3]);
    signal.write(3);
    agent.flush();
    expect(batches).toHaveLength(2);
  });

  it("[DVT-06.11] a large burst is delivered in bounded batches", () => {
    const { hook, rt, agent } = setup();
    const sizes: number[] = [];
    const small = createAgent({ maxPending: 100 });
    small.attach(hook);
    small.subscribe((events) => sizes.push(events.length));
    const signal = rt.signal(0, "s");
    for (let i = 1; i <= 350; i += 1) signal.write(i);
    expect(sizes).toEqual([100, 100, 100]);
    small.flush();
    expect(sizes).toEqual([100, 100, 100, 51]);
    expect(agent.stats.recorded).toBe(351);
  });

  it("[DVT-06.12] errors, hydration mismatches, resources and unknown event kinds", () => {
    const { hook, rt, agent } = setup();
    const owner = rt.owner("root");
    const resource = {};
    hook.report(EVENT.RESOURCE_STATE, resource, "pending", "user", owner);
    hook.report(EVENT.RESOURCE_STATE, resource, "ready", "user", owner);
    hook.report(EVENT.ERROR, owner, new TypeError("boom"), "WRITE_IN_MEMO");
    hook.report(EVENT.HYDRATION_MISMATCH, "text differs", "<b>a</b>", "<b>b</b>");
    hook.report(9999, owner);
    const snap = agent.snapshot();
    expect(snap.nodes.find((node) => node.type === "resource")).toMatchObject({
      state: "ready",
      name: "user",
    });
    expect(agent.model.errors.toArray()[0]).toMatchObject({
      message: "TypeError: boom",
      code: "WRITE_IN_MEMO",
    });
    expect(agent.model.hydration.toArray()[0]).toMatchObject({
      expected: "<b>a</b>",
      actual: "<b>b</b>",
    });
    expect(agent.stats.ignored).toBe(1);
  });

  it("[DVT-06.13] a real store is shown and edited through its handle", () => {
    const { hook, rt, agent } = setup();
    const owner = rt.owner("root");
    const [todos, setTodos] = useStore({ items: [{ id: 1, done: false }], title: "Todos" });
    const handle = {
      name: "todos",
      snapshot: () => snapshot(todos),
      set: (path: readonly (string | number)[], value: unknown) => {
        (setTodos as (...args: unknown[]) => void)(...path, value);
      },
    };
    hook.report(EVENT.STORE_CREATED, handle, owner);
    const id = agent.snapshot().nodes.find((node) => node.type === "store")?.id ?? -1;
    const read = agent.handle({ type: "store", id });
    expect(read).toMatchObject({ ok: true, result: { kind: "store", editable: true } });
    expect(JSON.parse((read as { result: { text: string } }).result.text)).toEqual({
      items: [{ id: 1, done: false }],
      title: "Todos",
    });
    expect(
      agent.handle({ type: "store-set", id, path: ["items", 0, "done"], text: "true" }),
    ).toEqual({
      ok: true,
      result: null,
    });
    expect(todos.items[0]?.done).toBe(true);
    expect(agent.handle({ type: "store-set", id, path: ["title"], text: "oops{" })).toMatchObject({
      ok: false,
    });
    rt.dispose(owner);
    expect(agent.handle({ type: "store", id })).toEqual({ ok: false, error: "The store is gone." });
  });

  it("[DVT-06.16] a flush that ran nothing the agent knows leaves no flush record", () => {
    const { hook, rt, agent } = setup();
    hook.report(EVENT.FLUSH_START, 0, 3);
    hook.report(EVENT.FLUSH_END, 3);
    expect(agent.model.flushes.size).toBe(0);
    expect(agent.stats.recorded).toBe(0);
    // A flush that does run recorded work keeps the time it started.
    const signal = rt.signal(1, "n");
    rt.effect(() => void signal.read(), "fx");
    rt.flush();
    signal.write(2);
    rt.flush();
    expect(agent.model.flushes.size).toBe(2);
    const record = agent.model.flushes.last();
    expect(record).toMatchObject({ render: 0, user: 1, runs: 1, open: false });
    expect(record?.end).toBeGreaterThanOrEqual(record?.start ?? Number.POSITIVE_INFINITY);
  });

  it("[DVT-06.17] an unknown command is answered with an error, never with nothing", () => {
    const { agent } = setup();
    expect(agent.handle({ type: "nope" } as never)).toEqual({
      ok: false,
      error: "Unknown command.",
    });
  });

  it("[DVT-06.15] dispose detaches from the hook and drops references", () => {
    const { hook, rt, agent } = setup();
    expect(hook.sinks).toBe(1);
    agent.dispose();
    expect(hook.sinks).toBe(0);
    rt.signal(0, "late");
    expect(agent.snapshot().nodes).toEqual([]);
  });
});
