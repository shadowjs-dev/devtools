import { afterEach, describe, expect, it } from "vitest";
import { MAX_CAPACITY } from "../../extension/src/timeline/recorder";
import { parseRecording, serializeRecording } from "../../extension/src/timeline/schema";
import { createTimelineSession } from "../../extension/src/timeline/session";
import { createEventTap } from "../../extension/src/timeline/tap";
import { createAgent } from "../../src/agent";
import { installHook, uninstallHook } from "../../src/hook";
import { PROTOCOL_VERSION, type WireEvent } from "../../src/protocol";
import { CHANNEL, connectRemote, createMemoryTransportPair, serveAgent } from "../../src/transport";
import { instrument } from "../support/instrument";
import { Stream } from "../support/stream";

afterEach(() => uninstallHook({ target: {} }));

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** The page side (hook, agent, runtime stand-in) wired to a panel side through a memory transport and the tap. */
function wire() {
  const hook = installHook({ target: {} });
  if (hook === undefined) throw new Error("no hook");
  const rt = instrument(hook);
  const agent = createAgent({ now: () => rt.clock.now });
  agent.attach(hook);
  const [pageSide, panelSide] = createMemoryTransportPair();
  const stopServing = serveAgent(agent, pageSide);
  const sent: unknown[] = [];
  const counting = {
    ...panelSide,
    send: (message: unknown) => {
      sent.push(message);
      panelSide.send(message);
    },
  };
  const tap = createEventTap();
  const backend = connectRemote(tap.wrap(counting));
  let batches = 0;
  let delivered = 0;
  // The source the session records from; it counts what it hands out.
  const events = (listener: (events: readonly WireEvent[]) => void): (() => void) =>
    tap.subscribe((batch) => {
      batches += 1;
      delivered += batch.length;
      listener(batch);
    });
  return {
    hook,
    rt,
    agent,
    tap,
    backend,
    sent,
    events,
    counts: () => ({ batches, delivered }),
    stop: () => {
      stopServing();
      backend.dispose();
    },
  };
}

/** App activity: a counter with a memo and an effect, bumped `times` times. */
function activity(rt: ReturnType<typeof instrument>, times: number): void {
  const count = rt.signal(0, "count");
  const doubled = rt.memo(() => count.read() * 2, "doubled");
  rt.effect(() => {
    doubled.read();
  }, "title");
  rt.flush();
  for (let i = 0; i < times; i += 1) {
    count.write(i + 1);
    rt.flush();
  }
}

describe("[DVT-TL-TP] the tap forwards the transport untouched and feeds listeners only when asked", () => {
  const eventsMessage = (events: unknown[], v = PROTOCOL_VERSION) => ({
    channel: CHANNEL,
    v,
    from: "agent",
    type: "events",
    events,
  });

  it("[DVT-TL-TP.1] without a listener the tap only forwards, with one it also passes event batches, after the handler", () => {
    const tap = createEventTap();
    const [pageSide, panelSide] = createMemoryTransportPair();
    const wrapped = tap.wrap(panelSide);
    const order: string[] = [];
    wrapped.listen(() => order.push("handler"));
    pageSide.send(eventsMessage([{ k: "flush+", seq: 1, t: 0, render: 0, user: 0 }]));
    expect(tap.listeners).toBe(0);
    expect(order).toEqual(["handler"]);
    const stop = tap.subscribe((batch) => order.push(`tap ${batch.length}`));
    expect(tap.listeners).toBe(1);
    pageSide.send(
      eventsMessage([
        { k: "flush+", seq: 2, t: 0, render: 0, user: 0 },
        { k: "flush-", seq: 3, t: 0, runs: 0 },
      ]),
    );
    expect(order).toEqual(["handler", "handler", "tap 2"]);
    stop();
    expect(tap.listeners).toBe(0);
  });

  it("[DVT-TL-TP.2] other messages, other versions and other senders never reach a listener", () => {
    const tap = createEventTap();
    const [pageSide, panelSide] = createMemoryTransportPair();
    tap.wrap(panelSide).listen(() => undefined);
    let heard = 0;
    tap.subscribe(() => {
      heard += 1;
    });
    pageSide.send({ channel: CHANNEL, v: PROTOCOL_VERSION, from: "agent", type: "hello" });
    pageSide.send(eventsMessage([{ k: "flush+" }], PROTOCOL_VERSION + 1));
    pageSide.send({ ...eventsMessage([]), from: "panel" });
    pageSide.send({ ...eventsMessage([]), channel: "other" });
    pageSide.send({ ...eventsMessage([]), events: "nope" });
    pageSide.send("events");
    expect(heard).toBe(0);
  });

  it("[DVT-TL-TP.3] sending and closing pass straight through", () => {
    const tap = createEventTap();
    const [pageSide, panelSide] = createMemoryTransportPair();
    const wrapped = tap.wrap(panelSide);
    const received: unknown[] = [];
    pageSide.listen((message) => received.push(message));
    wrapped.send({ a: 1 });
    expect(received).toEqual([{ a: 1 }]);
    wrapped.close();
    wrapped.send({ a: 2 });
    expect(received).toHaveLength(1);
  });
});

describe("[DVT-TL-ZO] with recording off, the timeline adds nothing to the hook, the agent or the wire", () => {
  it("[DVT-TL-ZO.1] a session that never records attaches to nothing, sees no event and sends no request", async () => {
    const page = wire();
    await page.backend.ready;
    const session = createTimelineSession({ events: page.events });
    const hookSinks = page.hook.sinks;
    const requestsBefore = page.sent.length;
    activity(page.rt, 20);
    await settle();
    expect(page.agent.stats.recorded).toBeGreaterThan(50);
    expect(page.counts()).toEqual({ batches: 0, delivered: 0 });
    expect(page.tap.listeners).toBe(0);
    expect(session.received).toBe(0);
    expect(session.data().entries).toEqual([]);
    expect(page.hook.sinks).toBe(hookSinks);
    expect(hookSinks).toBe(1);
    expect(page.sent.length).toBe(requestsBefore);
    page.stop();
  });

  it("[DVT-TL-ZO.2] recording on, then off: events flow only in between, the hook and the agent are the same both ways", async () => {
    const page = wire();
    await page.backend.ready;
    const session = createTimelineSession({ events: page.events });
    const before = page.agent.stats.recorded;
    activity(page.rt, 5);
    await settle();
    const idleRecorded = page.agent.stats.recorded - before;
    expect(page.counts().delivered).toBe(0);

    expect(session.start()).toBe(true);
    expect(page.tap.listeners).toBe(1);
    const mark = page.agent.stats.recorded;
    activity(page.rt, 5);
    await settle();
    // The page agent records the same number of events whether or not the panel records.
    expect(page.agent.stats.recorded - mark).toBe(idleRecorded);
    expect(page.hook.sinks).toBe(1);
    expect(page.counts().delivered).toBe(page.agent.stats.recorded - mark);
    const data = session.data();
    expect(data.entries.filter((entry) => entry.k === "write")).toHaveLength(5);
    const firstWrite = data.entries.find((entry) => entry.k === "write");
    expect(firstWrite?.k === "write" && data.labels.get(firstWrite.signal)).toBe("count");

    session.stop();
    expect(page.tap.listeners).toBe(0);
    const delivered = page.counts().delivered;
    activity(page.rt, 5);
    await settle();
    expect(page.counts().delivered).toBe(delivered);
    expect(session.data().entries.length).toBe(data.entries.length);
    page.stop();
  });

  it("[DVT-TL-ZO.3] a session without an event source cannot start and stays empty", () => {
    const session = createTimelineSession();
    expect(session.available).toBe(false);
    expect(session.start()).toBe(false);
    expect(session.recording).toBe(false);
    expect(session.data().entries).toEqual([]);
  });

  it("[DVT-TL-ZO.4] the first recorder is built on the first start; dispose detaches and ends it", async () => {
    const page = wire();
    await page.backend.ready;
    const session = createTimelineSession({ events: page.events, capacity: 50 });
    expect(session.received).toBe(0);
    session.start();
    activity(page.rt, 2);
    await settle();
    expect(session.received).toBeGreaterThan(0);
    session.dispose();
    expect(page.tap.listeners).toBe(0);
    expect(session.start()).toBe(false);
    page.stop();
  });
});

describe("[DVT-TL-SS] the session records, clears, resizes and shows an import", () => {
  /** A source the test drives by hand. */
  function manual() {
    const listeners = new Set<(events: readonly WireEvent[]) => void>();
    return {
      source: (listener: (events: readonly WireEvent[]) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      emit: (events: readonly WireEvent[]) => {
        for (const listener of [...listeners]) listener(events);
      },
      listeners,
    };
  }
  const stream = () =>
    new Stream().comp(3, 0, "memo", "m").signal(2, 0, "s").write(2, "1", 0, [3]).run(3, [2]);

  it("[DVT-TL-SS.1] start, stop and clear change what data() shows and tell the subscribers", () => {
    const hand = manual();
    const session = createTimelineSession({ events: hand.source });
    let calls = 0;
    session.subscribe(() => {
      calls += 1;
    });
    session.start();
    hand.emit(stream().events);
    expect(session.data().entries).toHaveLength(2);
    expect(session.recording).toBe(true);
    session.stop();
    hand.emit(stream().events);
    expect(session.data().entries).toHaveLength(2);
    expect(hand.listeners.size).toBe(0);
    session.clear();
    expect(session.data().entries).toHaveLength(0);
    expect(calls).toBeGreaterThanOrEqual(4);
  });

  it("[DVT-TL-SS.2] changing the buffer size stops recording and clears; a bad size changes nothing", () => {
    const hand = manual();
    const session = createTimelineSession({ events: hand.source, capacity: 10 });
    session.start();
    hand.emit(stream().events);
    expect(session.setCapacity(0)).toBe(false);
    expect(session.setCapacity(MAX_CAPACITY + 1)).toBe(false);
    expect(session.setCapacity(1.5)).toBe(false);
    expect(session.recording).toBe(true);
    expect(session.capacity).toBe(10);
    expect(session.setCapacity(3)).toBe(true);
    expect(session.recording).toBe(false);
    expect(session.capacity).toBe(3);
    expect(session.data().entries).toEqual([]);
    session.start();
    hand.emit(new Stream().write(2, "1").write(2, "2").write(2, "3").write(2, "4").events);
    expect(session.data().entries).toHaveLength(3);
    expect(session.data().dropped).toBe(1);
    expect(() => createTimelineSession({ capacity: 0 })).toThrow(RangeError);
  });

  it("[DVT-TL-SS.3] an imported recording replaces the view, stops recording, and a new start returns to the live one", () => {
    const hand = manual();
    const session = createTimelineSession({ events: hand.source });
    session.start();
    hand.emit(stream().events);
    const live = session.data();
    const text = serializeRecording(live);
    const parsed = parseRecording(text);
    if (!parsed.ok) throw new Error(parsed.error);
    session.load({ ...parsed.data, entries: parsed.data.entries.slice(0, 1) });
    expect(session.imported).toBe(true);
    expect(session.recording).toBe(false);
    expect(hand.listeners.size).toBe(0);
    expect(session.data().entries).toHaveLength(1);
    session.start();
    expect(session.imported).toBe(false);
    expect(session.data().entries).toHaveLength(live.entries.length);
    session.load(parsed.data);
    session.clear();
    expect(session.imported).toBe(false);
    expect(session.data().entries).toEqual([]);
  });
});
