import { describe, expect, it } from "vitest";
import {
  createPageBridge,
  MAX_MESSAGE_CHARS,
  MAX_RESPONSE_CHARS,
  type PageWindow,
  type RuntimePort,
} from "../extension/src/bridge";
import { createEventTap } from "../extension/src/timeline/tap";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import { InspectorModel, type ModelState } from "../src/model";
import { EVENT, type HookSink, PROTOCOL_VERSION, type WireEvent } from "../src/protocol";
import { CHANNEL, connectRemote, createMemoryTransportPair, serveAgent } from "../src/transport";

const ORIGIN = "http://localhost:5173";

/** A page window and a background port, both recording what the bridge does with them. */
function wiring(): {
  page: PageWindow & { dispatch(data: unknown): void };
  port: RuntimePort & { posts: unknown[] };
} {
  const listeners = new Set<(event: MessageEvent) => void>();
  const page = {
    postMessage: () => undefined,
    addEventListener: (_type: "message", listener: (event: MessageEvent) => void) =>
      void listeners.add(listener),
    removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) =>
      void listeners.delete(listener),
    dispatch(data: unknown) {
      for (const listener of [...listeners]) {
        listener({ source: page, origin: ORIGIN, data } as unknown as MessageEvent);
      }
    },
  };
  const posts: unknown[] = [];
  const port: RuntimePort & { posts: unknown[] } = {
    posts,
    postMessage: (message) => void posts.push(message),
    disconnect: () => undefined,
    onMessage: { addListener: () => undefined, removeListener: () => undefined },
    onDisconnect: { addListener: () => undefined },
  };
  return { page, port };
}

const response = (id: number, result: unknown) => ({
  channel: CHANNEL,
  v: PROTOCOL_VERSION,
  from: "agent",
  type: "response",
  id,
  response: { ok: true, result },
});

describe("[DEVT-REV-1] the bridge forwards the answers a panel asked for", () => {
  it("[DEVT-REV-1.1] the state of a page that ran 10000 effects reaches the panel", () => {
    const agent = createAgent();
    const owner = {};
    agent.receive(EVENT.OWNER_CREATED, owner, null, "root", undefined, undefined);
    const effects = Array.from({ length: 100 }, () => ({}));
    for (const effect of effects) {
      agent.receive(EVENT.COMPUTATION_CREATED, effect, owner, "effect", "e", false);
    }
    for (let run = 0; run < 10_000; run += 1) {
      agent.receive(EVENT.COMPUTATION_RUN, effects[run % 100], 1, 0.5, true, []);
    }
    const snapshot = agent.handle({ type: "snapshot" });
    const message = { ...response(1, null), response: snapshot };
    expect(JSON.stringify(message).length).toBeGreaterThan(MAX_MESSAGE_CHARS);

    const { page, port } = wiring();
    createPageBridge({ page, origin: ORIGIN, connect: () => port, schedule: () => undefined });
    page.dispatch(message);
    expect(port.posts).toHaveLength(1);
  });

  it("[DEVT-REV-1.2] an answer beyond the cap is replaced by an error answer with the same id, not dropped in silence", () => {
    const { page, port } = wiring();
    const bridge = createPageBridge({
      page,
      origin: ORIGIN,
      connect: () => port,
      schedule: () => undefined,
    });
    page.dispatch(response(7, "x".repeat(MAX_RESPONSE_CHARS)));
    expect(bridge.dropped()).toBe(1);
    expect(port.posts).toEqual([
      {
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        from: "agent",
        type: "response",
        id: 7,
        response: { ok: false, error: "The page's answer was too large to send to the panel." },
      },
    ]);
  });

  it("[DEVT-REV-1.3] an events batch keeps the smaller cap", () => {
    const { page, port } = wiring();
    createPageBridge({ page, origin: ORIGIN, connect: () => port, schedule: () => undefined });
    page.dispatch({
      channel: CHANNEL,
      v: PROTOCOL_VERSION,
      from: "agent",
      type: "events",
      events: [{ k: "flush-", seq: 1, t: 0, runs: 0, pad: "x".repeat(MAX_MESSAGE_CHARS) }],
    });
    expect(port.posts).toEqual([]);
  });
});

function buriedModel(count: number, limit: number): InspectorModel {
  const model = new InspectorModel({ graveyard: limit });
  let seq = 0;
  for (let id = 1; id <= count; id += 1) {
    seq += 1;
    model.apply({ k: "owner+", seq, t: 0, id, parent: 0, label: "owner" });
    seq += 1;
    model.apply({ k: "owner-", seq, t: 0, id });
  }
  return model;
}

describe("[DEVT-REV-2] the graveyard stays within its limit", () => {
  it("[DEVT-REV-2.1] a state from a model with a larger graveyard is cut to the newest nodes", () => {
    const big = buriedModel(50, 100);
    expect(big.graveyard.size).toBe(50);
    const small = new InspectorModel({ graveyard: 10 });
    small.importState(big.exportState());
    expect([...small.graveyard.keys()]).toEqual([41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
    small.apply({ k: "owner+", seq: 1000, t: 0, id: 99, parent: 0, label: "owner" });
    small.apply({ k: "owner-", seq: 1001, t: 0, id: 99 });
    expect(small.graveyard.size).toBe(10);
    expect(small.graveyard.has(99)).toBe(true);
  });
});

const emptyState: ModelState = {
  lastSeq: 0,
  overflow: 0,
  unknown: 0,
  nodes: [],
  graveyard: [],
  runs: [],
  writes: [],
  flushes: [],
  errors: [],
  hydration: [],
};

const ownerEvent = (seq: number): WireEvent => ({
  k: "owner+",
  seq,
  t: seq,
  id: seq,
  parent: 0,
  label: "owner",
});

/** A panel over a pair whose agent side never answers on its own: the test plays the agent. */
function panel() {
  const [agentSide, panelSide] = createMemoryTransportPair();
  const backend = connectRemote(panelSide);
  const send = (message: unknown): void => agentSide.send(message);
  const events = (list: unknown[]): void =>
    send({ channel: CHANNEL, v: PROTOCOL_VERSION, from: "agent", type: "events", events: list });
  return { backend, send, events, agentSide };
}

describe("[DEVT-REV-3] the panel does not trust the page's messages", () => {
  it("[DEVT-REV-3.1] an element that is not an event is skipped, and a NaN sequence number cannot reach the model", async () => {
    const { backend, send, events } = panel();
    send(response(1, emptyState));
    await backend.ready;
    events([
      null,
      42,
      "owner+",
      { k: "owner+", seq: Number.NaN, t: 0, id: 5, parent: 0, label: "x" },
      { k: "owner+", seq: 1, t: 0, id: 1 },
      { k: "write", seq: 2, t: 0, id: 1, preview: "1", writer: 0, observers: "none" },
      { k: "nope", seq: 3, t: 0 },
      ownerEvent(4),
    ]);
    expect(backend.model.lastSeq).toBe(4);
    expect([...backend.model.nodes.keys()]).toEqual([4]);
  });

  it("[DEVT-REV-3.2] a state with the wrong shape is refused and the panel keeps waiting", async () => {
    const { backend, send, events } = panel();
    send(response(1, { ...emptyState, nodes: "none" }));
    send(response(1, { lastSeq: "7" }));
    events([ownerEvent(1)]);
    expect(backend.model.nodes.size).toBe(0);
    expect(backend.model.lastSeq).toBe(0);
  });

  it("[DEVT-REV-3.3] events held while the state is awaited are bounded, keeping the newest", async () => {
    const { backend, send, events } = panel();
    const total = 60_000;
    for (let from = 1; from <= total; from += 2000) {
      events(Array.from({ length: 2000 }, (_, index) => ownerEvent(from + index)));
    }
    send(response(1, emptyState));
    await backend.ready;
    expect(backend.model.nodes.size).toBe(50_000);
    expect(backend.model.nodes.has(10_000)).toBe(false);
    expect(backend.model.nodes.has(10_001)).toBe(true);
    expect(backend.model.lastSeq).toBe(total);
  });
});

describe("[DEVT-REV-4] one failing subscriber does not starve the others", () => {
  it("[DEVT-REV-4.1] every subscriber gets the batch, and the first error is still thrown", () => {
    const agent = createAgent();
    const seen: number[] = [];
    agent.subscribe(() => {
      throw new Error("port closed");
    });
    agent.subscribe((events) => void seen.push(events.length));
    agent.receive(EVENT.OWNER_CREATED, {}, null, "root", undefined, undefined);
    expect(() => agent.flush()).toThrow("port closed");
    expect(seen).toEqual([1]);
  });
});

describe("[DEVT-REV-5] a panel follows the inspected page across a reload", () => {
  it("[DEVT-REV-5.1] events from a new agent that counts from 1 again replace the old page's state", async () => {
    const [agentSide, panelSide] = createMemoryTransportPair();
    const first = createAgent();
    for (let index = 0; index < 5; index += 1) {
      first.receive(EVENT.OWNER_CREATED, {}, null, "root", `old${index}`, undefined);
    }
    const stopFirst = serveAgent(first, agentSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    expect(backend.model.nodes.size).toBe(5);
    expect(backend.model.lastSeq).toBe(5);

    // The page reloads: the old agent is gone and a new one starts at sequence number 1.
    stopFirst();
    const second = createAgent();
    serveAgent(second, agentSide);
    second.receive(EVENT.OWNER_CREATED, {}, null, "root", "fresh", undefined);
    second.flush();
    await backend.request({ type: "stats" });

    expect(backend.model.lastSeq).toBe(1);
    expect([...backend.model.nodes.values()].map((node) => node.name)).toEqual(["fresh"]);

    // And it keeps following the new agent.
    second.receive(EVENT.OWNER_CREATED, {}, null, "root", "later", undefined);
    second.flush();
    expect([...backend.model.nodes.values()].map((node) => node.name)).toEqual(["fresh", "later"]);
    backend.dispose();
  });
});

describe("[DEVT-REV-6] the hook delivers every event to every attached sink", () => {
  it("[DEVT-REV-6.1] a sink that detaches while it receives does not make the next sink miss the event", () => {
    const target = {};
    const hook = installHook({ target });
    if (hook === undefined) throw new Error("no hook");
    const seen: string[] = [];
    let detachFirst: () => void = () => undefined;
    const first: HookSink = {
      receive: () => {
        seen.push("first");
        detachFirst();
      },
    };
    const second: HookSink = { receive: () => void seen.push("second") };
    detachFirst = hook.attach(first);
    hook.attach(second);
    hook.report(EVENT.FLUSH_END, 0);
    expect(seen).toEqual(["first", "second"]);
    hook.report(EVENT.FLUSH_END, 0);
    expect(seen).toEqual(["first", "second", "second"]);
    expect(hook.sinks).toBe(1);
    uninstallHook(target);
  });
});

describe("[DEVT-REV-7] the timeline tap hands its listeners only events", () => {
  it("[DEVT-REV-7.1] an element that is not an event never reaches the recorder", () => {
    const tap = createEventTap();
    const [pageSide, panelSide] = createMemoryTransportPair();
    tap.wrap(panelSide).listen(() => undefined);
    const batches: number[] = [];
    tap.subscribe((events) => void batches.push(events.length));
    pageSide.send({
      channel: CHANNEL,
      v: PROTOCOL_VERSION,
      from: "agent",
      type: "events",
      events: [null, { k: "write", seq: Number.NaN }, ownerEvent(1)],
    });
    expect(batches).toEqual([1]);
  });
});
