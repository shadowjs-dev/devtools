import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  causesOfRun,
  clampViewport,
  effectsOfWrite,
  fullViewport,
  layoutLane,
  MAX_BARS_PER_LANE,
  MAX_LANES,
  MIN_SPAN,
  neighbor,
  panViewport,
  revealRange,
  WRITES_LANE,
  zoomViewport,
} from "../../extension/src/timeline/analysis";
import {
  cleanLabel,
  DEFAULT_CAPACITY,
  MAX_CAPACITY,
  MAX_LABEL_LENGTH,
  MAX_LABELS,
  MAX_LINKS,
  type TimelineData,
  type TimelineEntry,
  TimelineRecorder,
} from "../../extension/src/timeline/recorder";
import {
  MAX_IMPORT_CHARS,
  parseRecording,
  RECORDING_FORMAT,
  RECORDING_VERSION,
  serializeRecording,
} from "../../extension/src/timeline/schema";
import { Stream } from "../support/stream";

/** A recorder that is already recording. */
function recording(
  capacity = 1000,
  resolve?: (id: number) => string | undefined,
): TimelineRecorder {
  const recorder = new TimelineRecorder(
    resolve === undefined ? { capacity } : { capacity, resolve },
  );
  recorder.start();
  return recorder;
}

/** count -> doubled (memo) -> title (effect), written once, then flushed. */
function scenario(): Stream {
  const s = new Stream();
  s.owner(1, 0, "root")
    .signal(2, 1, "count")
    .comp(3, 1, "memo", "doubled")
    .comp(4, 1, "effect", "title");
  s.tick(10).write(2, "1", 0, [3]);
  s.tick(1).flushStart(0, 1);
  s.run(3, [2], { start: 11, duration: 0.5 });
  s.run(4, [3], { start: 11.6, duration: 0.25 });
  s.tick(2).flushEnd(2);
  return s;
}

describe("[DVT-TL-RC] the recorder keeps a bounded timeline and nothing while it is off", () => {
  it("[DVT-TL-RC.1] a recorder that was never started keeps nothing and counts nothing", () => {
    const recorder = new TimelineRecorder();
    recorder.feed(scenario().events);
    expect(recorder.received).toBe(0);
    expect(recorder.size).toBe(0);
    expect(recorder.snapshot().entries).toEqual([]);
    expect(recorder.capacity).toBe(DEFAULT_CAPACITY);
  });

  it("[DVT-TL-RC.2] writes, runs with durations, and flushes become entries, with names learned from the stream", () => {
    const recorder = recording();
    recorder.feed(scenario().events);
    const data = recorder.snapshot();
    expect(data.entries.map((entry) => entry.k)).toEqual(["write", "run", "run", "flush"]);
    expect(data.entries[0]).toMatchObject({ k: "write", signal: 2, writer: 0, observers: [3] });
    expect(data.entries[1]).toMatchObject({
      k: "run",
      comp: 3,
      t: 11,
      duration: 0.5,
      changed: true,
      sources: [2],
    });
    expect(data.entries[3]).toMatchObject({ k: "flush", render: 0, user: 1, runs: 2 });
    expect(data.labels.get(2)).toBe("count");
    expect(data.labels.get(3)).toBe("doubled");
    expect(data.labels.get(4)).toBe("title");
    expect(recorder.received).toBe(scenario().events.length);
  });

  it("[DVT-TL-RC.3] memory is bounded: the ring holds `capacity` entries and the labels stop at the cap", () => {
    const recorder = recording(1000);
    const s = new Stream();
    s.comp(1, 0, "memo", "m");
    for (let i = 0; i < 300_000; i += 1) s.run(1, [], { start: i, duration: 0.1 });
    // The stream builder keeps every event: feed in slices and drop each slice, as the transport does.
    for (let i = 0; i < s.events.length; i += 2000) recorder.feed(s.events.slice(i, i + 2000));
    expect(recorder.size).toBe(1000);
    expect(recorder.dropped).toBe(300_000 - 1000);
    expect(recorder.snapshot().entries[0]).toMatchObject({ t: 299_000 });

    const labels = new Stream();
    for (let id = 1; id <= MAX_LABELS + 500; id += 1) labels.signal(id, 0, `s${id}`);
    labels.write(1, "x");
    labels.write(MAX_LABELS + 400, "x");
    const other = recording();
    other.feed(labels.events);
    const kept = other.snapshot().labels;
    expect(kept.has(1)).toBe(true);
    expect(kept.has(MAX_LABELS + 400)).toBe(false);
    expect(kept.size).toBeLessThanOrEqual(MAX_LABELS);
  });

  it("[DVT-TL-RC.4] lists are cut to MAX_LINKS and malformed events from the page are skipped, not thrown", () => {
    const recorder = recording();
    const many = Array.from({ length: MAX_LINKS * 3 }, (_, i) => i + 1);
    const hostile = [
      { k: "write", seq: 1, t: 1, id: 5, preview: "", writer: 0, observers: many },
      { k: "write", seq: 2, t: 2, id: -3, preview: "", writer: 0, observers: [] },
      { k: "write", seq: 3, t: 3, id: 5, preview: "", writer: "x", observers: "no" },
      {
        k: "run",
        seq: 4,
        t: Number.NaN,
        id: 6,
        start: Number.POSITIVE_INFINITY,
        duration: -5,
        changed: 1,
        sources: [1.5, "a", 2],
      },
      { k: "run", seq: 5, t: 1, id: 0, start: 1, duration: 1, changed: true, sources: [] },
      { k: "flush-", seq: 6, t: 1, runs: 1 },
      { k: "unheard-of", seq: 7, t: 1 },
      null,
    ] as unknown as never[];
    expect(() => recorder.feed(hostile)).not.toThrow();
    const entries = recorder.snapshot().entries;
    expect(entries).toHaveLength(3);
    const [first, second, third] = entries;
    expect(first).toMatchObject({ k: "write" });
    expect(first?.k === "write" && first.observers.length).toBe(MAX_LINKS);
    expect(second).toMatchObject({ k: "write", writer: 0, observers: [] });
    expect(third).toMatchObject({ k: "run", t: 0, duration: 0, sources: [2] });
  });

  it("[DVT-TL-RC.5] capacity is validated and configurable", () => {
    expect(() => new TimelineRecorder({ capacity: 0 })).toThrow(RangeError);
    expect(() => new TimelineRecorder({ capacity: 2.5 })).toThrow(RangeError);
    expect(() => new TimelineRecorder({ capacity: MAX_CAPACITY + 1 })).toThrow(RangeError);
    expect(new TimelineRecorder({ capacity: 25 }).capacity).toBe(25);
  });

  it("[DVT-TL-RC.6] stop keeps the entries, start continues, clear forgets entries and labels", () => {
    const recorder = recording();
    const s = scenario();
    recorder.feed(s.events);
    recorder.stop();
    recorder.feed(s.events);
    expect(recorder.size).toBe(4);
    recorder.start();
    recorder.feed(new Stream().write(2, "9", 0, []).events);
    expect(recorder.size).toBe(5);
    recorder.clear();
    expect(recorder.size).toBe(0);
    expect(recorder.snapshot().labels.size).toBe(0);
    expect(recorder.recording).toBe(true);
  });

  it("[DVT-TL-RC.7] a node created before recording started is named by the resolver, once", () => {
    const asked: number[] = [];
    const recorder = recording(100, (id) => {
      asked.push(id);
      return id === 3 ? "older memo" : undefined;
    });
    recorder.feed(new Stream().write(2, "1", 0, [3]).run(3, [2]).run(3, [2]).events);
    expect(recorder.snapshot().labels.get(3)).toBe("older memo");
    expect(asked.filter((id) => id === 3)).toHaveLength(1);
  });

  it("[DVT-TL-RC.8] labels lose control and bidirectional-override characters and are cut", () => {
    expect(cleanLabel("a‮b\u0000c⁦d")).toBe("a b c d");
    expect(cleanLabel("x".repeat(MAX_LABEL_LENGTH + 50))).toHaveLength(MAX_LABEL_LENGTH);
    const recorder = recording();
    recorder.feed(new Stream().signal(7, 0, "bad‮name").write(7, "1").events);
    expect(recorder.snapshot().labels.get(7)).toBe("bad name");
  });
});

function sample(): TimelineData {
  const recorder = recording();
  recorder.feed(scenario().events);
  return recorder.snapshot();
}

describe("[DVT-TL-SC] the recording file is validated like untrusted input", () => {
  it("[DVT-TL-SC.1] a recording survives export and import, and the text is deterministic", () => {
    const data = sample();
    const text = serializeRecording(data);
    expect(serializeRecording(data)).toBe(text);
    const result = parseRecording(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toEqual(data.entries);
    expect([...result.data.labels]).toEqual([...data.labels]);
    expect(result.data.dropped).toBe(data.dropped);
    const parsed = JSON.parse(text) as { format: string; version: number };
    expect(parsed.format).toBe(RECORDING_FORMAT);
    expect(parsed.version).toBe(RECORDING_VERSION);
  });

  const valid = (): Record<string, unknown> => JSON.parse(serializeRecording(sample()));
  const refused = (value: unknown): string => {
    const result = parseRecording(typeof value === "string" ? value : JSON.stringify(value));
    expect(result.ok).toBe(false);
    return result.ok ? "" : result.error;
  };

  it("[DVT-TL-SC.2] text that is too large, not text, not JSON or not an object is refused before any parsing work", () => {
    expect(refused("x".repeat(MAX_IMPORT_CHARS + 1))).toMatch(/larger than/);
    expect(parseRecording(42).ok).toBe(false);
    expect(parseRecording(null).ok).toBe(false);
    expect(refused("{not json")).toMatch(/not valid JSON/);
    expect(refused("[]")).toMatch(/not an object/);
    expect(refused("null")).toMatch(/not an object/);
    expect(refused("42")).toMatch(/not an object/);
  });

  it("[DVT-TL-SC.3] a wrong format or version is refused, a newer version with its number", () => {
    expect(refused({ ...valid(), format: "other" })).toMatch(/not a ShadowJS timeline/);
    expect(refused({ ...valid(), version: 2 })).toMatch(/version 2/);
    expect(refused({ ...valid(), version: 0 })).toMatch(/unknown version/);
    expect(refused({ ...valid(), version: "1" })).toMatch(/unknown version/);
  });

  it("[DVT-TL-SC.4] missing and unknown fields are refused, at the top and in each entry", () => {
    const missing = valid();
    delete missing["labels"];
    expect(refused(missing)).toMatch(/missing field "labels"/);
    expect(refused({ ...valid(), extra: 1 })).toMatch(/unknown field "extra"/);
    const entries = (valid()["entries"] as Array<Record<string, unknown>>).map((entry) => ({
      ...entry,
    }));
    const first = entries[0];
    if (first === undefined) throw new Error("no entry");
    first["bonus"] = true;
    expect(refused({ ...valid(), entries })).toMatch(/entry 0: unknown field "bonus"/);
  });

  it("[DVT-TL-SC.5] prototype pollution keys are refused and never reach Object.prototype", () => {
    const attacks = [
      '{"__proto__":{"polluted":true}}',
      '{"constructor":{"prototype":{"polluted":true}}}',
      `{"format":"${RECORDING_FORMAT}","version":1,"capacity":10,"dropped":0,"labels":[],"entries":[],"__proto__":{"polluted":true}}`,
      `{"format":"${RECORDING_FORMAT}","version":1,"capacity":10,"dropped":0,"labels":[],"entries":[{"k":"write","seq":1,"t":1,"signal":1,"writer":0,"observers":[],"__proto__":{"polluted":true}}]}`,
      `{"format":"${RECORDING_FORMAT}","version":1,"capacity":10,"dropped":0,"labels":[[1,"a"]],"entries":[{"k":"write","seq":1,"t":1,"signal":1,"writer":0,"observers":[],"constructor":{"prototype":{"polluted":1}}}]}`,
    ];
    for (const text of attacks) {
      const result = parseRecording(text);
      expect(result.ok).toBe(false);
      expect(Reflect.get({}, "polluted")).toBeUndefined();
      expect(Reflect.get(Object.prototype, "polluted")).toBeUndefined();
    }
    // A label whose text is a pollution key is only a label.
    const labeled = {
      ...valid(),
      labels: [
        [2, "__proto__"],
        [3, "constructor"],
      ],
    };
    const ok = parseRecording(JSON.stringify(labeled));
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.data.labels.get(2)).toBe("__proto__");
      expect(Object.getPrototypeOf(ok.data.entries[0])).toBe(Object.prototype);
    }
  });

  it("[DVT-TL-SC.6] numbers must be in range: ids, times, durations, counts, infinity and fractions", () => {
    const write = (patch: Record<string, unknown>): unknown => ({
      ...valid(),
      entries: [{ k: "write", seq: 1, t: 1, signal: 1, writer: 0, observers: [], ...patch }],
    });
    const run = (patch: Record<string, unknown>): unknown => ({
      ...valid(),
      entries: [
        { k: "run", seq: 1, t: 1, duration: 1, comp: 1, changed: true, sources: [], ...patch },
      ],
    });
    for (const patch of [
      { signal: 0 },
      { signal: 1.5 },
      { signal: 2 ** 31 },
      { signal: "1" },
      { writer: -1 },
      { t: -1 },
      { t: "1" },
      { seq: -1 },
      { seq: 1.2 },
    ]) {
      refused(write(patch));
    }
    expect(
      refused(
        `{"format":"${RECORDING_FORMAT}","version":1,"capacity":10,"dropped":0,"labels":[],"entries":[{"k":"write","seq":1,"t":1e999,"signal":1,"writer":0,"observers":[]}]}`,
      ),
    ).toMatch(/entry 0 t/);
    for (const patch of [
      { duration: -1 },
      { duration: 1e10 },
      { changed: "yes" },
      { comp: 0 },
      { sources: [0] },
      { sources: "x" },
    ]) {
      refused(run(patch));
    }
    refused({ ...valid(), capacity: 0 });
    refused({ ...valid(), capacity: MAX_CAPACITY + 1 });
    refused({ ...valid(), dropped: -1 });
    refused({
      ...valid(),
      entries: [{ k: "flush", seq: 1, t: 5, end: 4, render: 0, user: 0, runs: 0 }],
    });
    refused({ ...valid(), entries: [{ k: "mystery", seq: 1 }] });
    refused({ ...valid(), entries: [1, 2] });
  });

  it("[DVT-TL-SC.7] size caps: too many entries, too many ids in a list, too many or too long labels", () => {
    const entry = '{"k":"write","seq":1,"t":1,"signal":1,"writer":0,"observers":[]}';
    const head = `{"format":"${RECORDING_FORMAT}","version":1,"capacity":10,"dropped":0,"labels":[],"entries":[`;
    const many = `${head}${Array.from({ length: MAX_CAPACITY + 1 }, () => entry).join(",")}]}`;
    expect(refused(many)).toMatch(/at most/);
    const ok = `${head}${Array.from({ length: 1000 }, () => entry).join(",")}]}`;
    expect(parseRecording(ok).ok).toBe(true);
    const ids = Array.from({ length: MAX_LINKS + 1 }, (_, i) => i + 1);
    refused({
      ...valid(),
      entries: [{ k: "write", seq: 1, t: 1, signal: 1, writer: 0, observers: ids }],
    });
    refused({ ...valid(), labels: Array.from({ length: MAX_LABELS + 1 }, (_, i) => [i + 1, "x"]) });
    refused({ ...valid(), labels: [[1, "x".repeat(MAX_LABEL_LENGTH + 1)]] });
    refused({ ...valid(), labels: [[1]] });
    refused({ ...valid(), labels: [[0, "x"]] });
    refused({ ...valid(), labels: [[1, 5]] });
    refused({ ...valid(), labels: { 1: "x" } });
  });

  it("[DVT-TL-SC.8] sequence numbers may not go down, and imported labels are cleaned", () => {
    refused({
      ...valid(),
      entries: [
        { k: "write", seq: 5, t: 1, signal: 1, writer: 0, observers: [] },
        { k: "write", seq: 4, t: 2, signal: 1, writer: 0, observers: [] },
      ],
    });
    const result = parseRecording(JSON.stringify({ ...valid(), labels: [[1, "a‮b"]] }));
    expect(result.ok && result.data.labels.get(1)).toBe("a b");
  });

  it("[DVT-TL-SC.9] deep nesting, huge numbers and random corruption never throw", () => {
    expect(parseRecording("[".repeat(200_000)).ok).toBe(false);
    expect(parseRecording(`{"a":${"[".repeat(100_000)}`).ok).toBe(false);
    const text = serializeRecording(sample());
    let seed = 7;
    const next = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed;
    };
    let accepted = 0;
    for (let i = 0; i < 400; i += 1) {
      const at = next() % text.length;
      const junk = ["", "0", "-1", "null", '"', "{", "9e99", "[]", "true"][next() % 9] ?? "";
      const mutated = `${text.slice(0, at)}${junk}${text.slice(at + 1 + (next() % 3))}`;
      const result = parseRecording(mutated);
      if (result.ok) accepted += 1;
    }
    expect(accepted).toBeLessThan(400);
  });
});

function entries(...list: TimelineEntry[]): TimelineData {
  const labels = new Map<number, string>([
    [2, "count"],
    [3, "doubled"],
    [4, "title"],
  ]);
  return { entries: list, labels, dropped: 0, capacity: 100 };
}

describe("[DVT-TL-MD] the timeline model: lanes, window, bars and causes", () => {
  it("[DVT-TL-MD.1] one lane for the writes, then one per computation in order of first appearance", () => {
    const timeline = buildTimeline(sample());
    expect(timeline.lanes.map((lane) => lane.label)).toEqual(["Signal writes", "doubled", "title"]);
    expect(timeline.lanes[0]?.id).toBe(WRITES_LANE);
    expect(timeline.origin).toBe(10);
    expect(timeline.span).toBeCloseTo(3, 5);
    expect(timeline.flushes).toHaveLength(1);
    expect(timeline.laneOf).toEqual([0, 1, 2, -1]);
  });

  it("[DVT-TL-MD.2] an empty recording has the writes lane, a span of 1 and no flushes", () => {
    const timeline = buildTimeline(entries());
    expect(timeline.lanes).toHaveLength(1);
    expect(timeline.span).toBe(1);
    expect(fullViewport(timeline)).toEqual({ start: 0, end: 1 });
  });

  it("[DVT-TL-MD.3] only the busiest MAX_LANES computations get a lane, the rest are counted", () => {
    const list: TimelineEntry[] = [];
    for (let comp = 1; comp <= MAX_LANES + 30; comp += 1) {
      list.push({ k: "run", seq: comp, t: comp, duration: 1, comp, changed: true, sources: [] });
    }
    list.push({
      k: "run",
      seq: 9999,
      t: 5000,
      duration: 1,
      comp: MAX_LANES + 30,
      changed: true,
      sources: [],
    });
    const timeline = buildTimeline(entries(...list));
    expect(timeline.lanes).toHaveLength(MAX_LANES + 1);
    expect(timeline.hiddenLanes).toBe(30);
    expect(timeline.lanes.some((lane) => lane.id === MAX_LANES + 30)).toBe(true);
  });

  it("[DVT-TL-MD.4] zoom keeps the anchor in place, pan stops at the ends, nothing goes below MIN_SPAN", () => {
    expect(zoomViewport({ start: 0, end: 100 }, 0.5, 0.5, 100)).toEqual({ start: 25, end: 75 });
    expect(zoomViewport({ start: 0, end: 100 }, 0.5, 0, 100)).toEqual({ start: 0, end: 50 });
    expect(zoomViewport({ start: 20, end: 60 }, 10, 0.5, 100)).toEqual({ start: 0, end: 100 });
    expect(panViewport({ start: 10, end: 30 }, -50, 100)).toEqual({ start: 0, end: 20 });
    expect(panViewport({ start: 10, end: 30 }, 500, 100)).toEqual({ start: 80, end: 100 });
    let view = { start: 0, end: 100 };
    for (let i = 0; i < 60; i += 1) view = zoomViewport(view, 0.5, 0.5, 100);
    expect(view.end - view.start).toBeCloseTo(MIN_SPAN, 9);
    expect(clampViewport({ start: Number.NaN, end: 5 }, 100).start).toBeGreaterThanOrEqual(0);
    expect(panViewport({ start: 0, end: 10 }, Number.NaN, 100)).toEqual({ start: 0, end: 10 });
    expect(zoomViewport({ start: 0, end: 10 }, Number.NaN, 0.5, 100)).toEqual({
      start: 0,
      end: 10,
    });
  });

  it("[DVT-TL-MD.5] revealRange scrolls the least, and zooms out for a range wider than the window", () => {
    expect(revealRange({ start: 0, end: 10 }, 2, 3, 100)).toEqual({ start: 0, end: 10 });
    const later = revealRange({ start: 0, end: 10 }, 40, 41, 100);
    expect(later.start).toBeLessThanOrEqual(40);
    expect(later.end).toBeGreaterThanOrEqual(41);
    expect(later.end - later.start).toBeCloseTo(10, 9);
    const wide = revealRange({ start: 0, end: 10 }, 20, 60, 100);
    expect(wide.start).toBeLessThanOrEqual(20);
    expect(wide.end).toBeGreaterThanOrEqual(60);
  });

  it("[DVT-TL-MD.6] a lane lays out only what is in the window, found by binary search", () => {
    const list: TimelineEntry[] = [];
    for (let i = 0; i < 5000; i += 1) {
      list.push({
        k: "run",
        seq: i + 1,
        t: i * 10,
        duration: 2,
        comp: 3,
        changed: true,
        sources: [],
      });
    }
    const timeline = buildTimeline(entries(...list));
    const laneIndex = timeline.lanes.findIndex((lane) => lane.id === 3);
    const bars = layoutLane(timeline, laneIndex, { start: 1000, end: 1100 }, 1000);
    expect(bars.hidden).toBe(0);
    expect(bars.bars.map((bar) => bar.index)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110,
    ]);
    const first = bars.bars[0];
    expect(first?.x).toBeCloseTo(0, 6);
    expect(first?.width).toBeCloseTo(20, 6);
    expect(layoutLane(timeline, laneIndex, { start: 0, end: 0 }, 1000).bars).toEqual([]);
    expect(layoutLane(timeline, 99, { start: 0, end: 10 }, 1000).bars).toEqual([]);
  });

  it("[DVT-TL-MD.7] bars closer than a pixel merge, a lane draws at most MAX_BARS_PER_LANE, and the rest are counted", () => {
    const dense: TimelineEntry[] = [];
    for (let i = 0; i < 2000; i += 1) {
      dense.push({
        k: "run",
        seq: i + 1,
        t: i * 0.01,
        duration: 0.001,
        comp: 3,
        changed: true,
        sources: [],
      });
    }
    const timeline = buildTimeline(entries(...dense));
    const lane = timeline.lanes.findIndex((candidate) => candidate.id === 3);
    const merged = layoutLane(timeline, lane, fullViewport(timeline), 1000);
    expect(merged.bars.length).toBeLessThan(2000);
    expect(
      merged.bars.reduce((sum, bar) => sum + bar.count, 0) + merged.hidden,
    ).toBeGreaterThanOrEqual(1);
    const sparse: TimelineEntry[] = [];
    for (let i = 0; i < MAX_BARS_PER_LANE * 3; i += 1) {
      sparse.push({
        k: "run",
        seq: i + 1,
        t: i * 1000,
        duration: 1,
        comp: 3,
        changed: true,
        sources: [],
      });
    }
    const wide = buildTimeline(entries(...sparse));
    const capped = layoutLane(
      wide,
      wide.lanes.findIndex((l) => l.id === 3),
      fullViewport(wide),
      100_000,
    );
    expect(capped.bars).toHaveLength(MAX_BARS_PER_LANE);
    expect(capped.hidden).toBe(MAX_BARS_PER_LANE * 2);
  });

  it("[DVT-TL-MD.8] arrows move along a lane and between lanes; with nothing selected they start at the first entry", () => {
    const timeline = buildTimeline(sample());
    expect(neighbor(timeline, -1, "right")).toBe(0);
    expect(neighbor(timeline, 0, "down")).toBe(1);
    expect(neighbor(timeline, 1, "down")).toBe(2);
    expect(neighbor(timeline, 2, "up")).toBe(1);
    expect(neighbor(timeline, 2, "down")).toBe(2);
    expect(neighbor(timeline, 0, "left")).toBe(0);
    expect(neighbor(timeline, 1, "right")).toBe(1);
  });

  it("[DVT-TL-MD.9] a run is traced to the write that set it off, through the memo it read", () => {
    const data = sample();
    const effect = data.entries.findIndex((entry) => entry.k === "run" && entry.comp === 4);
    const memo = data.entries.findIndex((entry) => entry.k === "run" && entry.comp === 3);
    expect(causesOfRun(data, memo)).toEqual({ writes: [0], via: [] });
    expect(causesOfRun(data, effect)).toEqual({ writes: [], via: [memo] });
    expect(causesOfRun(data, 0)).toEqual({ writes: [], via: [] });
  });

  it("[DVT-TL-MD.10] a write lists the runs it set off, directly and through a memo, up to the end of the flush", () => {
    const data = sample();
    expect(effectsOfWrite(data, 0)).toEqual([1, 2]);
    expect(effectsOfWrite(data, 1)).toEqual([]);
    const second: TimelineEntry[] = [
      ...data.entries,
      { k: "run", seq: 99, t: 50, duration: 1, comp: 3, changed: true, sources: [2] },
    ];
    expect(effectsOfWrite({ ...data, entries: second }, 0)).toEqual([1, 2]);
  });

  it("[DVT-TL-MD.11] a computation that did not run between two writes is only attributed to the one before its run", () => {
    const twice = new Stream();
    twice.comp(3, 0, "memo", "m").signal(2, 0, "s");
    twice
      .tick(1)
      .write(2, "1", 0, [3])
      .tick(1)
      .run(3, [2])
      .tick(1)
      .write(2, "2", 0, [3])
      .tick(1)
      .write(2, "3", 0, [3])
      .tick(1)
      .run(3, [2]);
    const recorder = recording();
    recorder.feed(twice.events);
    const data = recorder.snapshot();
    const second = data.entries.findLastIndex((entry) => entry.k === "run");
    expect(causesOfRun(data, second).writes).toEqual([3, 2]);
  });
});
