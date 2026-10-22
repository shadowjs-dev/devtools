import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import { snapshotOf } from "../src/inspector";
import { EVENT } from "../src/protocol";

afterEach(() => uninstallHook());

interface Graph {
  owner: object;
  signals: object[];
  effects: object[];
}

function build(hook: { report: (kind: number, ...args: unknown[]) => void }): Graph {
  const owner = {};
  hook.report(EVENT.OWNER_CREATED, owner, null, "root", "App");
  const signals: object[] = [];
  const effects: object[] = [];
  for (let i = 0; i < 200; i += 1) {
    const signal = { value: i };
    signals.push(signal);
    hook.report(EVENT.SIGNAL_CREATED, signal, owner, `s${i}`, i);
  }
  for (let i = 0; i < 200; i += 1) {
    const effect = {};
    effects.push(effect);
    hook.report(EVENT.COMPUTATION_CREATED, effect, owner, "effect", `e${i}`, false);
  }
  return { owner, signals, effects };
}

/** Reports `count` events in a realistic mix: flush start, write, runs of its observers, flush end. */
function drive(
  hook: { report: (kind: number, ...args: unknown[]) => void },
  graph: Graph,
  count: number,
): void {
  const { signals, effects } = graph;
  let reported = 0;
  let round = 0;
  while (reported < count) {
    const signal = signals[round % signals.length];
    const effect = effects[round % effects.length];
    round += 1;
    hook.report(EVENT.FLUSH_START, 0, 1);
    hook.report(EVENT.SIGNAL_WRITTEN, signal, round, null, [effect]);
    hook.report(EVENT.COMPUTATION_RUN, effect, round, 0.01, true, [signal]);
    hook.report(EVENT.FLUSH_END, 1);
    reported += 4;
  }
}

describe("[DVT-08] recording is O(1) per event with bounded memory", () => {
  it("[DVT-08.1] 100 000 events: every buffer stays at its capacity", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent({
      events: 5_000,
      limits: { runs: 2_000, writes: 2_000, flushes: 500 },
    });
    agent.attach(hook);
    const graph = build(hook);
    const recordedBefore = agent.stats.recorded;
    drive(hook, graph, 100_000);
    expect(agent.stats.recorded - recordedBefore).toBe(100_000);
    expect(agent.events.size).toBe(5_000);
    expect(agent.model.runs.size).toBe(2_000);
    expect(agent.model.writes.size).toBe(2_000);
    expect(agent.model.flushes.size).toBe(500);
    expect(agent.events.dropped).toBeGreaterThan(90_000);
    // The live graph did not grow: the same 401 nodes.
    expect(snapshotOf(agent.model).nodes).toHaveLength(401);
    expect(agent.model.nodes.size).toBe(401);
  });

  it("[DVT-08.2] 100 000 events are recorded quickly and the cost per event does not grow", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent({
      events: 5_000,
      limits: { runs: 2_000, writes: 2_000, flushes: 500 },
    });
    agent.attach(hook);
    const graph = build(hook);
    const measure = (count: number): number => {
      const start = performance.now();
      drive(hook, graph, count);
      return performance.now() - start;
    };
    measure(10_000); // warm up the JIT
    // Four rounds; the fastest of the early pair and of the late pair drop scheduler and GC pauses.
    const rounds = [measure(50_000), measure(50_000), measure(50_000), measure(50_000)];
    const first = Math.min(rounds[0] ?? 0, rounds[1] ?? 0);
    const second = Math.min(rounds[2] ?? 0, rounds[3] ?? 0);
    // Typically ~50 ms on a laptop; the bounds are generous so a busy CI machine does not flake.
    expect(first + second).toBeLessThan(2_000);
    expect(second / first).toBeLessThan(4);
    expect(agent.model.runs.size).toBeLessThanOrEqual(2_000);
  });

  it("[DVT-08.3] with a subscriber the pending queue is bounded and every event is delivered once", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent({ maxPending: 1_000 });
    agent.attach(hook);
    let delivered = 0;
    let largest = 0;
    agent.subscribe((events) => {
      delivered += events.length;
      largest = Math.max(largest, events.length);
    });
    const graph = build(hook);
    drive(hook, graph, 100_000);
    agent.flush();
    expect(delivered).toBe(agent.stats.recorded);
    expect(largest).toBeLessThanOrEqual(1_000);
  });

  it("[DVT-08.4] ignored and unknown events cost nothing and record nothing", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const stranger = {};
    for (let i = 0; i < 100_000; i += 1) hook.report(EVENT.SIGNAL_WRITTEN, stranger, i, null, null);
    expect(agent.stats.unknown).toBe(100_000);
    expect(agent.stats.recorded).toBe(0);
    expect(agent.events.size).toBe(0);
  });
});
