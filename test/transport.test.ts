import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import { snapshotOf } from "../src/inspector";
import { EVENT, PROTOCOL_VERSION } from "../src/protocol";
import {
  CHANNEL,
  connectRemote,
  createBroadcastChannelTransport,
  createMemoryTransportPair,
  createPortTransport,
  createWindowTransport,
  isAgentMessage,
  isPanelMessage,
  serveAgent,
  type Transport,
} from "../src/transport";
import { instrument } from "./support/instrument";

afterEach(() => uninstallHook({ target: {} }));

function setup() {
  const hook = installHook({ target: {} });
  if (hook === undefined) throw new Error("no hook");
  const rt = instrument(hook);
  const agent = createAgent({
    now: () => rt.clock.now,
    writeSignal: (node, value) => rt.writeNode(node as never, value),
  });
  agent.attach(hook);
  return { hook, rt, agent };
}

/** A pair whose deliveries wait until the test says so, to exercise races. */
function manualPair(): {
  agentSide: Transport;
  panelSide: Transport;
  queued(): { toPanel: number; toAgent: number };
  deliver(direction: "toPanel" | "toAgent", count?: number): void;
} {
  const toPanel: unknown[] = [];
  const toAgent: unknown[] = [];
  const handlers: { panel: Array<(m: unknown) => void>; agent: Array<(m: unknown) => void> } = {
    panel: [],
    agent: [],
  };
  return {
    agentSide: {
      send: (message) => void toPanel.push(structuredClone(message)),
      listen: (handler) => {
        handlers.agent.push(handler);
        return () => undefined;
      },
      close: () => undefined,
    },
    panelSide: {
      send: (message) => void toAgent.push(structuredClone(message)),
      listen: (handler) => {
        handlers.panel.push(handler);
        return () => undefined;
      },
      close: () => undefined,
    },
    queued: () => ({ toPanel: toPanel.length, toAgent: toAgent.length }),
    deliver(direction, count = Number.POSITIVE_INFINITY) {
      const queue = direction === "toPanel" ? toPanel : toAgent;
      const targets = direction === "toPanel" ? handlers.panel : handlers.agent;
      for (let i = 0; i < count && queue.length > 0; i += 1) {
        const message = queue.shift();
        for (const handler of targets) handler(message);
      }
    },
  };
}

function buildGraph(rt: ReturnType<typeof instrument>) {
  const root = rt.component("App", () => {
    const count = rt.signal(1, "count");
    const doubled = rt.memo(() => count.read() * 2, "doubled");
    rt.effect(() => void doubled.read(), "title");
    return count;
  });
  return root.result;
}

describe("[DVT-09] messages", () => {
  it("[DVT-09.1] only well-formed devtools messages are accepted", () => {
    const hello = { channel: CHANNEL, v: 1, from: "agent", type: "hello" };
    expect(isAgentMessage(hello)).toBe(true);
    expect(isAgentMessage({ ...hello, type: "events", events: [] })).toBe(true);
    expect(isAgentMessage({ ...hello, type: "events", events: "no" })).toBe(false);
    expect(
      isAgentMessage({ ...hello, type: "response", id: 1, response: { ok: true, result: null } }),
    ).toBe(true);
    expect(isAgentMessage({ ...hello, type: "response", id: "1", response: {} })).toBe(false);
    expect(isAgentMessage({ ...hello, from: "panel" })).toBe(false);
    expect(isAgentMessage({ ...hello, channel: "other" })).toBe(false);
    expect(isAgentMessage({ ...hello, type: "unknown" })).toBe(false);
    expect(isAgentMessage(null)).toBe(false);
    expect(isAgentMessage("hi")).toBe(false);
    const request = {
      channel: CHANNEL,
      v: 1,
      from: "panel",
      type: "request",
      id: 3,
      request: { type: "pause" },
    };
    expect(isPanelMessage(request)).toBe(true);
    expect(isPanelMessage({ ...request, request: {} })).toBe(false);
    expect(isPanelMessage({ ...request, id: undefined })).toBe(false);
    expect(isPanelMessage({ ...request, type: "hello" })).toBe(true);
    expect(isPanelMessage({ ...request, from: "agent" })).toBe(false);
  });
});

describe("[DVT-09] a remote panel over a transport", () => {
  it("[DVT-09.2] gets the whole state, then the live stream, and ends up equal to the agent", async () => {
    const { rt, agent } = setup();
    const count = buildGraph(rt);
    rt.flush();
    const [pageSide, panelSide] = createMemoryTransportPair();
    serveAgent(agent, pageSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    expect(snapshotOf(backend.model)).toEqual(agent.snapshot());

    let notified = 0;
    backend.subscribe(() => {
      notified += 1;
    });
    count.write(4);
    rt.flush();
    agent.flush();
    await Promise.resolve();
    await Promise.resolve();
    expect(notified).toBeGreaterThan(0);
    expect(snapshotOf(backend.model)).toEqual(agent.snapshot());
    expect(backend.model.lastSeq).toBe(agent.model.lastSeq);
    expect(
      backend.model.node(
        count ? (agent.snapshot().nodes.find((n) => n.name === "count")?.id ?? 0) : 0,
      )?.preview,
    ).toBe("4");
  });

  it("[DVT-09.3] events that arrive before the state are buffered; none is lost or applied twice", async () => {
    const { rt, agent } = setup();
    const count = buildGraph(rt);
    rt.flush();
    const wire = manualPair();
    serveAgent(agent, wire.agentSide);
    const backend = connectRemote(wire.panelSide);
    // The panel's hello and snapshot request are in flight. Meanwhile the app keeps running.
    wire.deliver("toAgent", 1); // hello -> agent answers with hello
    count.write(10);
    rt.flush();
    agent.flush();
    // The stream message reaches the panel BEFORE the snapshot response.
    expect(wire.queued().toPanel).toBeGreaterThanOrEqual(2);
    wire.deliver("toAgent"); // snapshot request -> response queued after the events
    wire.deliver("toPanel");
    await backend.ready;
    expect(backend.model.lastSeq).toBe(agent.model.lastSeq);
    expect(snapshotOf(backend.model)).toEqual(agent.snapshot());
    const countId = agent.snapshot().nodes.find((node) => node.name === "count")?.id ?? 0;
    expect(backend.model.node(countId)?.writes).toBe(agent.model.node(countId)?.writes);
  });

  it("[DVT-09.4] requests travel and come back: edit a real signal from the panel", async () => {
    const { rt, agent } = setup();
    const count = buildGraph(rt);
    rt.flush();
    const [pageSide, panelSide] = createMemoryTransportPair();
    serveAgent(agent, pageSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    const id = backend.model.nodes.values().next().value?.id;
    const countId =
      [...backend.model.nodes.values()].find((node) => node.name === "count")?.id ?? id ?? 0;
    expect(await backend.request({ type: "value", id: countId })).toEqual({
      ok: true,
      result: { id: countId, kind: "signal", text: "1", editable: true },
    });
    expect(await backend.request({ type: "write", id: countId, text: "7" })).toEqual({
      ok: true,
      result: null,
    });
    expect(count.node.value).toBe(7);
    expect(await backend.request({ type: "write", id: countId, text: "{bad" })).toMatchObject({
      ok: false,
    });
    rt.flush();
    agent.flush();
    await Promise.resolve();
    expect(backend.model.node(countId)?.preview).toBe("7");
  });

  it("[DVT-09.5] highlight requests reach the page, not the agent", async () => {
    const { agent } = setup();
    const highlighted: Array<number | null> = [];
    const [pageSide, panelSide] = createMemoryTransportPair();
    serveAgent(agent, pageSide, { highlight: (id) => highlighted.push(id) });
    const backend = connectRemote(panelSide);
    await backend.ready;
    expect(await backend.request({ type: "highlight", id: 5 })).toEqual({ ok: true, result: null });
    await backend.request({ type: "highlight", id: null });
    expect(highlighted).toEqual([5, null]);
  });

  it("[DVT-09.6] clear empties the agent and the panel resyncs", async () => {
    const { rt, agent } = setup();
    buildGraph(rt);
    const [pageSide, panelSide] = createMemoryTransportPair();
    serveAgent(agent, pageSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    expect(backend.model.nodes.size).toBeGreaterThan(0);
    await backend.request({ type: "clear" });
    await Promise.resolve();
    await Promise.resolve();
    expect(agent.snapshot().nodes).toEqual([]);
    expect(backend.model.nodes.size).toBe(0);
  });

  it("[DVT-09.7] large streams are split into bounded messages", async () => {
    const { hook, agent } = setup();
    const sizes: number[] = [];
    const [pageSide, panelSide] = createMemoryTransportPair();
    serveAgent(agent, pageSide, { batch: 50 });
    panelSide.listen((message) => {
      if (isAgentMessage(message) && message.type === "events") sizes.push(message.events.length);
    });
    const owner = {};
    hook.report(EVENT.OWNER_CREATED, owner, null, "root", "App");
    for (let i = 0; i < 120; i += 1) hook.report(EVENT.ERROR, owner, new Error(`e${i}`));
    agent.flush();
    expect(sizes).toEqual([50, 50, 21]);
  });

  it("[DVT-09.8] foreign messages and other protocol versions are ignored", async () => {
    const { agent } = setup();
    const [pageSide, panelSide] = createMemoryTransportPair();
    serveAgent(agent, pageSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    const before = backend.model.lastSeq;
    pageSide.send({ not: "ours" });
    pageSide.send({
      channel: CHANNEL,
      v: PROTOCOL_VERSION + 1,
      from: "agent",
      type: "events",
      events: [{ k: "flush+", seq: 999, t: 0, render: 0, user: 0 }],
    });
    expect(backend.model.lastSeq).toBe(before);
  });

  it("[DVT-09.9] disposing rejects pending requests, refuses new ones and closes the transport", async () => {
    const { agent } = setup();
    const wire = manualPair();
    serveAgent(agent, wire.agentSide);
    const backend = connectRemote(wire.panelSide);
    const pending = backend.request({ type: "stats" });
    backend.dispose();
    await expect(pending).rejects.toThrow("disposed");
    await expect(backend.request({ type: "stats" })).rejects.toThrow("disposed");
  });

  it("[DVT-09.10] everything the agent sends survives structured cloning (it is plain data)", async () => {
    const { hook, rt, agent } = setup();
    buildGraph(rt);
    const owner = {};
    hook.report(EVENT.OWNER_CREATED, owner, null, "root", "x");
    hook.report(EVENT.ERROR, owner, new RangeError("nope"), "CODE");
    hook.report(EVENT.HYDRATION_MISMATCH, "m", "<i>", "<b>");
    const [pageSide, panelSide] = createMemoryTransportPair();
    serveAgent(agent, pageSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    // The memory transport clones every message: a function or a Node inside would have thrown.
    expect(backend.model.errors.last()).toMatchObject({
      code: "CODE",
      message: "RangeError: nope",
    });
    expect(JSON.parse(JSON.stringify(agent.state()))).toEqual(
      JSON.parse(JSON.stringify(backend.model.exportState())),
    );
  });
});

describe("[DVT-09] adapters", () => {
  it("[DVT-09.11] postMessage windows: only the expected origin and window are heard; '*' is refused", () => {
    const sent: Array<[unknown, string]> = [];
    const peer = {
      postMessage: (message: unknown, origin: string) => sent.push([message, origin]),
    };
    const listeners: Array<(event: MessageEvent) => void> = [];
    const receiver = {
      addEventListener: (_type: "message", listener: (event: MessageEvent) => void) =>
        listeners.push(listener),
      removeEventListener: (_type: "message", listener: (event: MessageEvent) => void) => {
        listeners.splice(listeners.indexOf(listener), 1);
      },
    };
    const transport = createWindowTransport({ target: peer, origin: "https://app.test", receiver });
    const heard: unknown[] = [];
    const stop = transport.listen((message) => heard.push(message));
    transport.send({ hello: 1 });
    expect(sent).toEqual([[{ hello: 1 }, "https://app.test"]]);
    const event = (data: unknown, origin: string, source: unknown) =>
      ({ data, origin, source }) as unknown as MessageEvent;
    for (const listener of listeners) {
      listener(event("ok", "https://app.test", peer));
      listener(event("wrong origin", "https://evil.test", peer));
      listener(event("wrong window", "https://app.test", {}));
    }
    expect(heard).toEqual(["ok"]);
    stop();
    expect(listeners).toHaveLength(0);
    expect(() => createWindowTransport({ target: peer, origin: "*", receiver })).toThrow(
      "real origin",
    );
  });

  it("[DVT-09.12] a MessageChannel port carries a full session", async () => {
    const { rt, agent } = setup();
    buildGraph(rt);
    const channel = new MessageChannel();
    const stop = serveAgent(agent, createPortTransport(channel.port1 as never));
    const backend = connectRemote(createPortTransport(channel.port2 as never));
    await backend.ready;
    expect(snapshotOf(backend.model)).toEqual(agent.snapshot());
    stop();
    backend.dispose();
    channel.port1.close();
    channel.port2.close();
  });

  it("[DVT-09.13] a BroadcastChannel carries a full session between two channel objects", async () => {
    const { rt, agent } = setup();
    buildGraph(rt);
    const name = `shadowjs-test-${Math.random().toString(36).slice(2)}`;
    const agentSide = createBroadcastChannelTransport(name);
    const stop = serveAgent(agent, agentSide);
    const backend = connectRemote(createBroadcastChannelTransport(name));
    await backend.ready;
    expect(snapshotOf(backend.model)).toEqual(agent.snapshot());
    stop();
    agentSide.close();
    backend.dispose();
  });
});
