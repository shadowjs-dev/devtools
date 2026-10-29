import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPageBridge,
  MAX_MESSAGE_CHARS,
  MAX_RESPONSE_CHARS,
  type PageWindow,
  type RuntimePort,
} from "../extension/src/bridge";
import { type Agent, type AgentResponse, createAgent } from "../src/agent";
import { InspectorModel, type ModelState } from "../src/model";
import { PROTOCOL_VERSION } from "../src/protocol";
import {
  type AgentMessage,
  CHANNEL,
  CHUNK_CHARS,
  CHUNK_TIMEOUT_MS,
  connectRemote,
  createMemoryTransportPair,
  isAgentMessage,
  MAX_ASSEMBLED_CHARS,
  MAX_CHUNKS,
  SINGLE_RESPONSE_CHARS,
  serveAgent,
  type Transport,
} from "../src/transport";

const ORIGIN = "http://localhost:5173";

afterEach(() => {
  vi.useRealTimers();
});

/** An empty state and one with `count` nodes that each carry `label` characters of text. */
function stateWith(count: number, label: string): ModelState {
  const seed = new InspectorModel();
  seed.apply({ k: "owner+", seq: 1, t: 0, id: 1, parent: -1, label: "root", name: "root" });
  const base = seed.exportState();
  const first = base.nodes[0];
  if (first === undefined) throw new Error("the seed model has no node");
  const nodes = Array.from({ length: count }, (_, index) => ({ ...first, id: index + 1, label }));
  return { ...base, nodes };
}

const emptyState = (): ModelState => new InspectorModel().exportState();

/** The agent of `createAgent()`, but a snapshot is answered with `state`. */
function agentAnswering(state: ModelState): Agent {
  const agent = createAgent();
  return {
    ...agent,
    handle: (request): AgentResponse =>
      request.type === "snapshot" ? { ok: true, result: state } : agent.handle(request),
  };
}

/** A memory pair whose agent side is driven by hand: requests are recorded, answers are sent by the test. */
function manual(): {
  panelSide: Transport;
  requests: number[];
  chunk(
    id: number,
    part: number,
    parts: number,
    data: string,
    size: number,
    instance?: string,
  ): void;
  respond(id: number, response: AgentResponse, instance?: string): void;
  hello(instance: string): void;
} {
  const [agentSide, panelSide] = createMemoryTransportPair();
  const requests: number[] = [];
  agentSide.listen((raw) => {
    if (typeof raw !== "object" || raw === null) return;
    if (Reflect.get(raw, "type") !== "request") return;
    const id: unknown = Reflect.get(raw, "id");
    if (typeof id === "number") requests.push(id);
  });
  const envelope = { channel: CHANNEL, v: PROTOCOL_VERSION, from: "agent" } as const;
  return {
    panelSide,
    requests,
    chunk(id, part, parts, data, size, instance = "agent-a") {
      agentSide.send({ ...envelope, type: "chunk", id, part, parts, size, data, instance });
    },
    respond(id, response, instance = "agent-a") {
      agentSide.send({ ...envelope, type: "response", id, response, instance });
    },
    hello(instance) {
      agentSide.send({ ...envelope, type: "hello", instance });
    },
  };
}

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
};

/** The JSON text of an ok snapshot answer and its three pieces. */
function threePieces(): { pieces: [string, string, string]; size: number } {
  const text = JSON.stringify({ ok: true, result: emptyState() });
  const third = Math.ceil(text.length / 3);
  return {
    pieces: [text.slice(0, third), text.slice(third, 2 * third), text.slice(2 * third)],
    size: text.length,
  };
}

describe("[DEVT-R3-1] a snapshot over the bridge's cap arrives in chunks", () => {
  it("[DEVT-R3-1.1] a state of more than 16 million characters reaches the panel intact through the bridge", async () => {
    expect(SINGLE_RESPONSE_CHARS).toBeLessThan(MAX_RESPONSE_CHARS);
    const label = "x".repeat(2000);
    const state = stateWith(9000, label);
    expect(JSON.stringify({ ok: true, result: state }).length).toBeGreaterThan(16_000_000);

    // agent -> page window -> bridge -> extension port -> panel
    const agentHandlers = new Set<(message: unknown) => void>();
    const panelHandlers = new Set<(message: unknown) => void>();
    const listeners = new Set<(event: MessageEvent) => void>();
    const page: PageWindow = {
      postMessage: () => undefined,
      addEventListener: (_type, listener) => void listeners.add(listener),
      removeEventListener: (_type, listener) => void listeners.delete(listener),
    };
    const forwarded: unknown[] = [];
    const port: RuntimePort = {
      postMessage: (message) => {
        forwarded.push(message);
        for (const handler of [...panelHandlers]) handler(message);
      },
      disconnect: () => undefined,
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
      onDisconnect: { addListener: () => undefined },
    };
    const bridge = createPageBridge({
      page,
      origin: ORIGIN,
      connect: () => port,
      schedule: () => undefined,
    });
    const agentSide: Transport = {
      send: (message) => {
        for (const listener of [...listeners]) {
          listener({ source: page, origin: ORIGIN, data: message } as unknown as MessageEvent);
        }
      },
      listen: (handler) => {
        agentHandlers.add(handler);
        return () => void agentHandlers.delete(handler);
      },
      close: () => undefined,
    };
    const panelSide: Transport = {
      send: (message) => {
        for (const handler of [...agentHandlers]) handler(structuredClone(message));
      },
      listen: (handler) => {
        panelHandlers.add(handler);
        return () => void panelHandlers.delete(handler);
      },
      close: () => undefined,
    };

    const stop = serveAgent(agentAnswering(state), agentSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    expect(backend.error?.()).toBeUndefined();
    expect(backend.model.nodes.size).toBe(9000);
    expect(backend.model.nodes.get(9000)?.label).toBe(label);
    expect(bridge.dropped()).toBe(0);
    const kinds = new Set(forwarded.map((message) => (message as AgentMessage).type));
    expect(kinds.has("chunk")).toBe(true);
    expect(kinds.has("response")).toBe(false);
    for (const message of forwarded) {
      expect(JSON.stringify(message).length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    }
    stop();
    backend.dispose();
  });

  it("[DEVT-R3-1.2] a small snapshot keeps the single-message path", async () => {
    const [agentSide, panelSide] = createMemoryTransportPair();
    const seen: AgentMessage[] = [];
    panelSide.listen((raw) => void seen.push(raw as AgentMessage));
    const stop = serveAgent(agentAnswering(stateWith(10, "small")), agentSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    expect(seen.filter((message) => message.type === "response")).toHaveLength(1);
    expect(seen.some((message) => message.type === "chunk")).toBe(false);
    stop();
    backend.dispose();
  });

  it("[DEVT-R3-1.3] the agent cuts at chunkChars, numbers the pieces, and never splits a surrogate pair", async () => {
    const [agentSide, panelSide] = createMemoryTransportPair();
    const seen: AgentMessage[] = [];
    panelSide.listen((raw) => void seen.push(raw as AgentMessage));
    const state = stateWith(40, "😀".repeat(30));
    const stop = serveAgent(agentAnswering(state), agentSide, {
      chunkChars: 101,
      singleResponseChars: 500,
    });
    const backend = connectRemote(panelSide);
    await backend.ready;
    const chunks = seen.filter(
      (message): message is Extract<AgentMessage, { type: "chunk" }> => message.type === "chunk",
    );
    expect(chunks.length).toBeGreaterThan(10);
    const ids = new Set(chunks.map((chunk) => chunk.id));
    expect(ids.size).toBe(1);
    chunks.forEach((chunk, index) => {
      expect(chunk.part).toBe(index);
      expect(chunk.parts).toBe(chunks.length);
      expect(chunk.data.length).toBeLessThanOrEqual(101);
      // A lone high surrogate at the end would mean a pair was cut.
      const last = chunk.data.charCodeAt(chunk.data.length - 1);
      expect(last >= 0xd800 && last <= 0xdbff).toBe(false);
    });
    expect(chunks.reduce((sum, chunk) => sum + chunk.data.length, 0)).toBe(chunks[0]?.size);
    expect(backend.model.nodes.get(40)?.label).toBe("😀".repeat(30));
    stop();
    backend.dispose();
  });

  it("[DEVT-R3-1.4] an answer the agent cannot serialize becomes an error answer, not a thrown send", async () => {
    const [agentSide, panelSide] = createMemoryTransportPair();
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    const agent: Agent = { ...createAgent(), handle: () => ({ ok: true, result: cyclic }) };
    const stop = serveAgent(agent, agentSide, { singleResponseChars: 5 });
    const backend = connectRemote(panelSide);
    await settle();
    expect(backend.error?.()).toMatch(/could not be serialized/);
    stop();
    backend.dispose();
  });
});

describe("[DEVT-R3-2] the panel reassembles chunks with bounds", () => {
  it("[DEVT-R3-2.1] chunks that arrive out of order, with a duplicate, make the answer", async () => {
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const { pieces, size } = threePieces();
    const [id] = wire.requests;
    if (id === undefined) throw new Error("no snapshot request");
    wire.chunk(id, 2, 3, pieces[2], size);
    wire.chunk(id, 0, 3, pieces[0], size);
    wire.chunk(id, 0, 3, "DUPLICATE-IGNORED", size);
    await settle();
    expect(backend.error?.()).toBeUndefined();
    wire.chunk(id, 1, 3, pieces[1], size);
    await backend.ready;
    expect(backend.model.lastSeq).toBe(0);
    expect(backend.error?.()).toBeUndefined();
    backend.dispose();
  });

  it("[DEVT-R3-2.2] a missing chunk is given up on after the timeout, and the panel shows why", async () => {
    vi.useFakeTimers();
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const { pieces, size } = threePieces();
    const [id] = wire.requests;
    if (id === undefined) throw new Error("no snapshot request");
    wire.chunk(id, 0, 3, pieces[0], size);
    wire.chunk(id, 2, 3, pieces[2], size);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(CHUNK_TIMEOUT_MS - 1);
    expect(backend.error?.()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(backend.error?.()).toMatch(/did not arrive in full/);
    expect(vi.getTimerCount()).toBe(0);
    // The late chunk finds no set and no request: nothing starts again.
    wire.chunk(id, 1, 3, pieces[1], size);
    expect(vi.getTimerCount()).toBe(0);
    backend.dispose();
  });

  it("[DEVT-R3-2.3] each accepted chunk restarts the timeout; a set that keeps growing is not abandoned", async () => {
    vi.useFakeTimers();
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const { pieces, size } = threePieces();
    const [id] = wire.requests;
    if (id === undefined) throw new Error("no snapshot request");
    wire.chunk(id, 0, 3, pieces[0], size);
    await vi.advanceTimersByTimeAsync(CHUNK_TIMEOUT_MS - 1);
    wire.chunk(id, 1, 3, pieces[1], size);
    await vi.advanceTimersByTimeAsync(CHUNK_TIMEOUT_MS - 1);
    wire.chunk(id, 2, 3, pieces[2], size);
    await backend.ready;
    expect(backend.error?.()).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
    backend.dispose();
  });

  it("[DEVT-R3-2.4] chunks of a stale agent instance are ignored and cannot complete an answer", async () => {
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const { pieces, size } = threePieces();
    const [first] = wire.requests;
    if (first === undefined) throw new Error("no snapshot request");
    // The first agent answers the first request.
    wire.hello("agent-a");
    wire.chunk(first, 0, 3, pieces[0], size, "agent-a");
    // The page reloads: another instance says hello and the panel asks again.
    wire.hello("agent-b");
    expect(wire.requests.length).toBeGreaterThan(1);
    const second = wire.requests.at(-1);
    if (second === undefined) throw new Error("no second request");
    // The old agent's remaining chunks, for the old request, arrive late.
    wire.chunk(first, 1, 3, pieces[1], size, "agent-a");
    wire.chunk(first, 2, 3, pieces[2], size, "agent-a");
    await settle();
    expect(backend.error?.()).toBeUndefined();
    expect(wire.requests).toHaveLength(2);
    // The new agent answers: that, and only that, is the state.
    wire.respond(second, { ok: true, result: emptyState() }, "agent-b");
    await backend.ready;
    backend.dispose();
  });

  it("[DEVT-R3-2.5] chunks of one set that come from two instances do not mix", async () => {
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const { pieces, size } = threePieces();
    const [id] = wire.requests;
    if (id === undefined) throw new Error("no snapshot request");
    wire.chunk(id, 0, 3, pieces[0], size, "agent-a");
    wire.chunk(id, 1, 3, pieces[1], size, "agent-z");
    wire.chunk(id, 2, 3, pieces[2], size, "agent-a");
    await settle();
    // Nothing completed: the answer would need the middle piece from the same instance.
    let ready = false;
    void backend.ready.then(() => {
      ready = true;
    });
    await settle();
    expect(ready).toBe(false);
    backend.dispose();
  });

  it("[DEVT-R3-2.6] a chunk for a request nobody made is ignored and starts no timer", () => {
    vi.useFakeTimers();
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    wire.chunk(9999, 0, 2, "x", 2);
    expect(vi.getTimerCount()).toBe(0);
    backend.dispose();
  });

  it("[DEVT-R3-2.7] a declared size over the total bound is refused at the first chunk", async () => {
    vi.useFakeTimers();
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const [id] = wire.requests;
    if (id === undefined) throw new Error("no snapshot request");
    wire.chunk(id, 0, 2, "x", MAX_ASSEMBLED_CHARS + 1);
    await settle();
    expect(backend.error?.()).toMatch(/larger than the panel accepts/);
    expect(vi.getTimerCount()).toBe(0);
    backend.dispose();
  });

  it("[DEVT-R3-2.8] chunks that add up to more than they declared are refused", async () => {
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const [id] = wire.requests;
    if (id === undefined) throw new Error("no snapshot request");
    wire.chunk(id, 0, 2, "aaaa", 6);
    wire.chunk(id, 1, 2, "bbbb", 6);
    await settle();
    expect(backend.error?.()).toMatch(/did not match/);
    backend.dispose();
  });

  it("[DEVT-R3-2.9] a joined answer that is not an answer is reported, not thrown", async () => {
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const [id] = wire.requests;
    if (id === undefined) throw new Error("no snapshot request");
    wire.chunk(id, 0, 2, "{not ", 9);
    wire.chunk(id, 1, 2, "json", 9);
    await settle();
    expect(backend.error?.()).toMatch(/could not be read/);
    const other = manual();
    const second = connectRemote(other.panelSide);
    const [otherId] = other.requests;
    if (otherId === undefined) throw new Error("no snapshot request");
    other.chunk(otherId, 0, 1, '{"ok":"maybe"}', 14);
    await settle();
    expect(second.error?.()).toMatch(/could not be read/);
    backend.dispose();
    second.dispose();
  });

  it("[DEVT-R3-2.10] at most 4 sets are open: the oldest is given up when a fifth starts", async () => {
    vi.useFakeTimers();
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const outcomes: Array<AgentResponse | undefined> = [];
    for (let index = 0; index < 5; index += 1) {
      // Dispose at the end rejects the requests still pending; this test only reads the answered one.
      void backend.request({ type: "stats" }).then(
        (response) => {
          outcomes[index] = response;
        },
        () => undefined,
      );
    }
    // The snapshot request is the first one; the five above follow it.
    const ids = wire.requests.slice(1);
    expect(ids).toHaveLength(5);
    for (const id of ids) wire.chunk(id, 0, 2, "ab", 4);
    await settle();
    expect(outcomes[0]).toEqual({
      ok: false,
      error: "The page's answer was given up on: too many answers were arriving at once.",
    });
    expect([1, 2, 3, 4].map((index) => outcomes[index])).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
    expect(vi.getTimerCount()).toBe(4);
    backend.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[DEVT-R3-2.11] dispose clears the timers of open sets", () => {
    vi.useFakeTimers();
    const wire = manual();
    const backend = connectRemote(wire.panelSide);
    const [id] = wire.requests;
    if (id === undefined) throw new Error("no snapshot request");
    wire.chunk(id, 0, 2, "ab", 4);
    expect(vi.getTimerCount()).toBe(1);
    backend.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("[DEVT-R3-2.12] a chunk message is valid only inside the bounds", () => {
    const good = {
      channel: CHANNEL,
      v: PROTOCOL_VERSION,
      from: "agent",
      type: "chunk",
      id: 1,
      part: 0,
      parts: 2,
      size: 4,
      data: "ab",
    };
    expect(isAgentMessage(good)).toBe(true);
    expect(isAgentMessage({ ...good, parts: MAX_CHUNKS })).toBe(true);
    expect(isAgentMessage({ ...good, parts: MAX_CHUNKS + 1 })).toBe(false);
    expect(isAgentMessage({ ...good, parts: 0 })).toBe(false);
    expect(isAgentMessage({ ...good, part: 2 })).toBe(false);
    expect(isAgentMessage({ ...good, part: -1 })).toBe(false);
    expect(isAgentMessage({ ...good, part: 0.5 })).toBe(false);
    expect(isAgentMessage({ ...good, id: "1" })).toBe(false);
    expect(isAgentMessage({ ...good, size: -1 })).toBe(false);
    expect(isAgentMessage({ ...good, data: 5 })).toBe(false);
    expect(isAgentMessage({ ...good, data: "x".repeat(CHUNK_CHARS + 1) })).toBe(false);
    expect(isAgentMessage({ ...good, data: "x".repeat(CHUNK_CHARS) })).toBe(true);
  });

  it("[DEVT-R3-2.13] the bounds fit together: the most chunks of the biggest size cover the total", () => {
    expect(MAX_CHUNKS * CHUNK_CHARS).toBeGreaterThanOrEqual(MAX_ASSEMBLED_CHARS);
    // Worst case a chunk's JSON text doubles (every character escaped) and must still fit the bridge.
    expect(CHUNK_CHARS * 2 + 1000).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
  });
});

describe("[DEVT-R3-3] the bridge handles chunks", () => {
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

  const chunkMessage = (data: string) => ({
    channel: CHANNEL,
    v: PROTOCOL_VERSION,
    from: "agent",
    type: "chunk",
    id: 4,
    part: 0,
    parts: 2,
    size: 100,
    data,
  });

  it("[DEVT-R3-3.1] a chunk within the message cap is forwarded unchanged", () => {
    const { page, port } = wiring();
    createPageBridge({ page, origin: ORIGIN, connect: () => port, schedule: () => undefined });
    const message = chunkMessage("y".repeat(CHUNK_CHARS));
    page.dispatch(message);
    expect(port.posts).toEqual([message]);
  });

  it("[DEVT-R3-3.2] a chunk whose characters all double when serialized still fits the message cap", () => {
    const { page, port } = wiring();
    const bridge = createPageBridge({
      page,
      origin: ORIGIN,
      connect: () => port,
      schedule: () => undefined,
    });
    const message = chunkMessage('"'.repeat(CHUNK_CHARS));
    expect(JSON.stringify(message).length).toBeGreaterThan(CHUNK_CHARS * 2);
    page.dispatch(message);
    expect(bridge.dropped()).toBe(0);
    expect(port.posts).toEqual([message]);
  });

  it("[DEVT-R3-3.3] a chunk with an out-of-bounds count or size is not forwarded", () => {
    const { page, port } = wiring();
    createPageBridge({ page, origin: ORIGIN, connect: () => port, schedule: () => undefined });
    page.dispatch({ ...chunkMessage("z"), parts: MAX_CHUNKS + 1 });
    page.dispatch(chunkMessage("y".repeat(CHUNK_CHARS + 1)));
    expect(port.posts).toEqual([]);
  });
});
