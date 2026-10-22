import { describe, expect, it } from "vitest";
import {
  createPageBridge,
  createRuntimeTransport,
  INSPECTED_TYPE,
  inspectedPing,
  isInspectedPing,
  MAX_BATCH,
  MAX_MESSAGE_CHARS,
  type PageWindow,
  type RuntimePort,
} from "../../extension/src/bridge";
import { PROTOCOL_VERSION } from "../../src/protocol";
import { CHANNEL } from "../../src/transport";

/** A window the bridge can post to and listen on: records posts, lets the test dispatch events. */
function fakeWindow(): PageWindow & {
  posts: Array<{ message: unknown; origin: string }>;
  dispatch(event: { source: unknown; origin: string; data: unknown }): void;
  listeners: number;
} {
  const listeners = new Set<(event: MessageEvent) => void>();
  const posts: Array<{ message: unknown; origin: string }> = [];
  return {
    posts,
    get listeners() {
      return listeners.size;
    },
    postMessage(message, origin) {
      posts.push({ message, origin });
    },
    addEventListener(_type, listener) {
      listeners.add(listener);
    },
    removeEventListener(_type, listener) {
      listeners.delete(listener);
    },
    dispatch(event) {
      for (const listener of [...listeners]) listener(event as unknown as MessageEvent);
    },
  };
}

/** A port the bridge can open: records posts and disconnects, lets the test deliver messages. */
function fakePort(): RuntimePort & {
  posts: unknown[];
  disconnected: boolean;
  deliver(message: unknown): void;
  drop(): void;
  messageListeners: number;
} {
  const messages = new Set<(message: unknown) => void>();
  const drops = new Set<() => void>();
  const posts: unknown[] = [];
  return {
    posts,
    disconnected: false,
    get messageListeners() {
      return messages.size;
    },
    postMessage(message) {
      posts.push(message);
    },
    disconnect() {
      this.disconnected = true;
    },
    onMessage: {
      addListener: (listener) => messages.add(listener),
      removeListener: (listener) => messages.delete(listener),
    },
    onDisconnect: { addListener: (listener) => drops.add(listener) },
    deliver(message) {
      for (const listener of [...messages]) listener(message);
    },
    drop() {
      for (const listener of [...drops]) listener();
    },
  };
}

const ORIGIN = "http://localhost:5173";
const agentHello = { channel: CHANNEL, v: PROTOCOL_VERSION, from: "agent", type: "hello" };
const panelHello = { channel: CHANNEL, v: PROTOCOL_VERSION, from: "panel", type: "hello" };

/** A bridge over fakes that connect to `port`. */
function bridgeOver(port: RuntimePort, page: PageWindow) {
  const scheduled: Array<() => void> = [];
  const bridge = createPageBridge({
    page,
    origin: ORIGIN,
    connect: () => port,
    schedule: (fn) => {
      scheduled.push(fn);
    },
  });
  return { bridge, scheduled };
}

describe("[DVT-EXT-BR] the page bridge relays only well-formed messages from the page's own window", () => {
  it("[DVT-EXT-BR.1] an agent message from the page window and origin is forwarded to the background", () => {
    const page = fakeWindow();
    const port = fakePort();
    bridgeOver(port, page);
    page.dispatch({ source: page, origin: ORIGIN, data: agentHello });
    expect(port.posts).toEqual([agentHello]);
  });

  it("[DVT-EXT-BR.2] a message from another window, another origin, or without the envelope is dropped", () => {
    const page = fakeWindow();
    const port = fakePort();
    bridgeOver(port, page);
    page.dispatch({ source: {}, origin: ORIGIN, data: agentHello });
    page.dispatch({ source: page, origin: "https://evil.example", data: agentHello });
    page.dispatch({ source: page, origin: ORIGIN, data: { ...agentHello, from: "panel" } });
    page.dispatch({ source: page, origin: ORIGIN, data: { channel: "other", from: "agent" } });
    page.dispatch({ source: page, origin: ORIGIN, data: "not an object" });
    expect(port.posts).toEqual([]);
  });

  it("[DVT-EXT-BR.3] an events batch larger than MAX_BATCH is dropped as not from the agent", () => {
    const page = fakeWindow();
    const port = fakePort();
    bridgeOver(port, page);
    const events = Array.from({ length: MAX_BATCH + 1 }, () => ({
      k: "flush-",
      seq: 1,
      t: 0,
      runs: 0,
    }));
    page.dispatch({
      source: page,
      origin: ORIGIN,
      data: { channel: CHANNEL, v: PROTOCOL_VERSION, from: "agent", type: "events", events },
    });
    expect(port.posts).toEqual([]);
    page.dispatch({
      source: page,
      origin: ORIGIN,
      data: {
        channel: CHANNEL,
        v: PROTOCOL_VERSION,
        from: "agent",
        type: "events",
        events: events.slice(0, MAX_BATCH),
      },
    });
    expect(port.posts).toHaveLength(1);
  });

  it("[DVT-EXT-BR.4] a panel message from the background is posted to the page with the page's origin, and nothing else is", () => {
    const page = fakeWindow();
    const port = fakePort();
    bridgeOver(port, page);
    port.deliver(panelHello);
    port.deliver({ channel: CHANNEL, from: "agent", type: "hello" });
    port.deliver({ hostile: true });
    expect(page.posts).toEqual([{ message: panelHello, origin: ORIGIN }]);
  });

  it("[DVT-EXT-BR.5] after a disconnect the bridge reconnects later, and gives up after maxRetries in a row", () => {
    const page = fakeWindow();
    const first = fakePort();
    let connects = 0;
    const scheduled: Array<() => void> = [];
    createPageBridge({
      page,
      origin: ORIGIN,
      connect: () => {
        connects += 1;
        return first;
      },
      maxRetries: 2,
      schedule: (fn) => {
        scheduled.push(fn);
      },
    });
    expect(connects).toBe(1);
    first.drop();
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(connects).toBe(2);
    first.drop();
    scheduled.shift()?.();
    expect(connects).toBe(3);
    first.drop();
    expect(scheduled).toHaveLength(0);
  });

  it("[DVT-EXT-BR.6] a connect that throws (the extension was reloaded) is retried, not thrown into the page", () => {
    const page = fakeWindow();
    const scheduled: Array<() => void> = [];
    let attempts = 0;
    createPageBridge({
      page,
      origin: ORIGIN,
      connect: () => {
        attempts += 1;
        throw new Error("Extension context invalidated.");
      },
      maxRetries: 1,
      schedule: (fn) => {
        scheduled.push(fn);
      },
    });
    expect(attempts).toBe(1);
    expect(scheduled).toHaveLength(1);
    scheduled.shift()?.();
    expect(attempts).toBe(2);
    expect(scheduled).toHaveLength(0);
  });

  it("[DVT-EXT-BR.7] stop removes the page listener, drops the port and forgets the messages after it", () => {
    const page = fakeWindow();
    const port = fakePort();
    const { bridge } = bridgeOver(port, page);
    expect(bridge.connected()).toBe(true);
    expect(page.listeners).toBe(1);
    bridge.stop();
    expect(page.listeners).toBe(0);
    expect(port.disconnected).toBe(true);
    expect(port.messageListeners).toBe(0);
    page.dispatch({ source: page, origin: ORIGIN, data: agentHello });
    port.deliver(panelHello);
    expect(port.posts).toEqual([]);
    expect(page.posts).toEqual([]);
  });
});

describe("[DVT-EXT-RT] the panel's transport over an extension port", () => {
  it("[DVT-EXT-RT.1] send posts to the port; listen delivers and unsubscribes; close disconnects", () => {
    const port = fakePort();
    const transport = createRuntimeTransport(port);
    transport.send(panelHello);
    expect(port.posts).toEqual([panelHello]);
    const received: unknown[] = [];
    const stop = transport.listen((message) => received.push(message));
    port.deliver(agentHello);
    expect(received).toEqual([agentHello]);
    stop();
    port.deliver(agentHello);
    expect(received).toHaveLength(1);
    transport.close();
    expect(port.disconnected).toBe(true);
  });
});

describe("[DVT-EXT-FL] the page bridge limits what one page can send", () => {
  const batch = {
    channel: CHANNEL,
    v: PROTOCOL_VERSION,
    from: "agent",
    type: "events",
    events: [],
  };

  it("[DVT-EXT-FL.1] a flood is limited to a burst, then to the refill rate; the rest is dropped and counted", () => {
    const page = fakeWindow();
    const port = fakePort();
    let clock = 0;
    const bridge = createPageBridge({
      page,
      origin: ORIGIN,
      connect: () => port,
      now: () => clock,
      schedule: () => undefined,
      flood: { burst: 5, perSecond: 2 },
    });
    for (let i = 0; i < 20; i += 1) page.dispatch({ source: page, origin: ORIGIN, data: batch });
    expect(port.posts).toHaveLength(5);
    expect(bridge.dropped()).toBe(15);
    clock = 1000;
    for (let i = 0; i < 3; i += 1) page.dispatch({ source: page, origin: ORIGIN, data: batch });
    expect(port.posts).toHaveLength(7);
    expect(bridge.dropped()).toBe(16);
  });

  it("[DVT-EXT-FL.2] the refill never exceeds the burst, however long the page stays quiet", () => {
    const page = fakeWindow();
    const port = fakePort();
    let clock = 0;
    createPageBridge({
      page,
      origin: ORIGIN,
      connect: () => port,
      now: () => clock,
      schedule: () => undefined,
      flood: { burst: 3, perSecond: 1 },
    });
    clock = 60_000;
    for (let i = 0; i < 10; i += 1) page.dispatch({ source: page, origin: ORIGIN, data: batch });
    expect(port.posts).toHaveLength(3);
  });

  it("[DVT-EXT-FL.3] a message larger than MAX_MESSAGE_CHARS is dropped, however well formed it is", () => {
    const page = fakeWindow();
    const port = fakePort();
    createPageBridge({ page, origin: ORIGIN, connect: () => port, schedule: () => undefined });
    const padded = {
      ...batch,
      events: [{ k: "flush-", seq: 1, t: 0, runs: 0, pad: "x".repeat(MAX_MESSAGE_CHARS) }],
    };
    page.dispatch({ source: page, origin: ORIGIN, data: padded });
    expect(port.posts).toEqual([]);
    page.dispatch({ source: page, origin: ORIGIN, data: batch });
    expect(port.posts).toEqual([batch]);
  });

  it("[DVT-EXT-FL.4] the inspected ping is accepted only in its exact shape, from the page's own window", () => {
    expect(isInspectedPing(inspectedPing())).toBe(true);
    expect(INSPECTED_TYPE).toBe("inspected");
    expect(isInspectedPing({ ...inspectedPing(), extra: 1 })).toBe(false);
    expect(isInspectedPing({ ...inspectedPing(), v: PROTOCOL_VERSION + 1 })).toBe(false);
    expect(isInspectedPing({ ...inspectedPing(), from: "panel" })).toBe(false);
    expect(isInspectedPing({ ...inspectedPing(), type: "events" })).toBe(false);
    expect(isInspectedPing("inspected")).toBe(false);

    const page = fakeWindow();
    const port = fakePort();
    bridgeOver(port, page);
    page.dispatch({ source: page, origin: ORIGIN, data: inspectedPing() });
    page.dispatch({ source: {}, origin: ORIGIN, data: inspectedPing() });
    page.dispatch({ source: page, origin: "https://evil.example", data: inspectedPing() });
    expect(port.posts).toEqual([inspectedPing()]);
  });
});
