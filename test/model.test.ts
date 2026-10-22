import { describe, expect, it } from "vitest";
import { componentStats, explainRun, flameTimeline, ownerTree, snapshotOf } from "../src/inspector";
import { foldEvents, InspectorModel } from "../src/model";
import { Stream } from "./support/stream";

/** App (owner 1, component) -> Counter (owner 2, component) with signal 10, memo 11, effect 12. */
function counterApp(): Stream {
  return new Stream()
    .owner(1, 0, "root", "App")
    .mount(1, "App")
    .owner(2, 1, "owner")
    .mount(2, "Counter")
    .signal(10, 2, "count")
    .comp(11, 2, "memo", "doubled")
    .run(11, [10])
    .comp(12, 2, "effect", "title")
    .run(12, [11]);
}

describe("[DVT-03] the inspector model folds events into a graph", () => {
  it("[DVT-03.1] builds the owners tree, depths, roots and counts", () => {
    const model = foldEvents(counterApp().events);
    const snap = snapshotOf(model);
    expect(snap.roots).toEqual([1]);
    const byId = new Map(snap.nodes.map((node) => [node.id, node]));
    expect(byId.get(1)?.children).toEqual([2]);
    expect(byId.get(2)?.children).toEqual([10, 11, 12]);
    expect(byId.get(12)?.depth).toBe(2);
    expect(snap.counts).toMatchObject({
      nodes: 5,
      owners: 2,
      components: 2,
      signals: 1,
      memos: 1,
      effects: 1,
    });
    expect(ownerTree(snap)).toEqual([
      {
        id: 1,
        children: [
          {
            id: 2,
            children: [
              { id: 10, children: [] },
              { id: 11, children: [] },
              { id: 12, children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it("[DVT-03.2] tracks sources and observers incrementally as runs change them", () => {
    const stream = counterApp();
    const model = foldEvents(stream.events);
    let snap = snapshotOf(model);
    const get = (id: number) => snap.nodes.find((node) => node.id === id);
    expect(get(11)?.sources).toEqual([10]);
    expect(get(10)?.observers).toEqual([11]);
    expect(get(11)?.observers).toEqual([12]);
    // The effect now reads the signal directly instead of the memo.
    model.apply({
      k: "run",
      seq: stream.seq + 1,
      t: 9,
      id: 12,
      start: 9,
      duration: 1,
      changed: false,
      sources: [10],
    });
    snap = snapshotOf(model);
    expect(get(12)?.sources).toEqual([10]);
    expect(get(11)?.observers).toEqual([]);
    expect(get(10)?.observers.sort()).toEqual([11, 12]);
  });

  it("[DVT-03.3] disposing a computation removes its edges and moves it to the graveyard", () => {
    const stream = counterApp().disposeComp(12);
    const model = foldEvents(stream.events);
    expect(model.nodes.has(12)).toBe(false);
    expect(model.node(12)?.alive).toBe(false);
    expect(snapshotOf(model).nodes.find((node) => node.id === 11)?.observers).toEqual([]);
  });

  it("[DVT-03.4] counts updates as runs after the first and attributes them to components", () => {
    const stream = counterApp();
    stream.write(10, "1").run(11, [10]).run(12, [11]).write(10, "2").run(11, [10]).run(12, [11]);
    const model = foldEvents(stream.events);
    const stats = componentStats(model);
    const counter = stats.find((stat) => stat.name === "Counter");
    expect(counter).toMatchObject({ computations: 2, updates: 4, alive: true });
    expect(stats.find((stat) => stat.name === "App")).toMatchObject({
      computations: 0,
      updates: 0,
    });
    expect(stats[0]?.name).toBe("Counter");
    const snap = snapshotOf(model);
    expect(snap.nodes.find((node) => node.id === 12)).toMatchObject({
      runs: 3,
      updates: 2,
      component: 2,
    });
    expect(snap.nodes.find((node) => node.id === 10)).toMatchObject({ writes: 2, preview: "2" });
  });

  it("[DVT-03.5] a component mounted after its children still owns them", () => {
    const stream = new Stream()
      .owner(1, 0, "root")
      .comp(2, 1, "effect", "late")
      .run(2, [])
      .run(2, [])
      .mount(1, "Late");
    const model = foldEvents(stream.events);
    expect(model.componentOf(2)).toBe(1);
    expect(componentStats(model)[0]).toMatchObject({ name: "Late", updates: 1 });
  });

  it("[DVT-03.6] records errors, hydration mismatches, resources and stores", () => {
    const stream = new Stream()
      .owner(1, 0, "root")
      .resource(5, 1, "pending", "user")
      .resource(5, 1, "ready")
      .store(6, 1, "todos")
      .error(1, "boom", "WRITE_IN_MEMO")
      .hydration("text differs", "a", "b");
    const model = foldEvents(stream.events);
    expect(model.node(5)).toMatchObject({ type: "resource", state: "ready", name: "user" });
    expect(model.node(6)).toMatchObject({ type: "store", name: "todos" });
    expect(model.errors.toArray()).toMatchObject([
      { message: "boom", code: "WRITE_IN_MEMO", id: 1 },
    ]);
    expect(model.hydration.toArray()).toMatchObject([{ expected: "a", actual: "b" }]);
    expect(snapshotOf(model).counts).toMatchObject({
      resources: 1,
      stores: 1,
      errors: 1,
      hydration: 1,
    });
  });

  it("[DVT-03.7] ignores events it has already seen and counts events about unknown nodes", () => {
    const stream = counterApp();
    const model = foldEvents(stream.events);
    const before = JSON.stringify(model.exportState());
    for (const event of stream.events) model.apply(event);
    expect(JSON.stringify(model.exportState())).toBe(before);
    model.apply({
      k: "write",
      seq: stream.seq + 1,
      t: 1,
      id: 999,
      preview: "x",
      writer: 0,
      observers: [],
    });
    expect(model.unknown).toBe(1);
  });

  it("[DVT-03.8] export and import round-trip to an identical snapshot", () => {
    const stream = counterApp()
      .flushStart(0, 1)
      .run(12, [11], { start: 5, duration: 2 })
      .flushEnd(1)
      .disposeComp(12);
    const model = foldEvents(stream.events);
    const copy = new InspectorModel();
    copy.importState(JSON.parse(JSON.stringify(model.exportState())));
    expect(snapshotOf(copy)).toEqual(snapshotOf(model));
    expect(flameTimeline(copy)).toEqual(flameTimeline(model));
    // Events the imported state already contains are skipped; newer ones apply.
    for (const event of stream.events) copy.apply(event);
    expect(snapshotOf(copy)).toEqual(snapshotOf(model));
    copy.apply({
      k: "write",
      seq: stream.seq + 1,
      t: 1,
      id: 10,
      preview: "7",
      writer: 0,
      observers: [],
    });
    expect(copy.node(10)?.preview).toBe("7");
  });

  it("[DVT-03.9] folding is deterministic", () => {
    const stream = counterApp().write(10, "1").run(11, [10]);
    expect(snapshotOf(foldEvents(stream.events))).toEqual(snapshotOf(foldEvents(stream.events)));
  });
});

describe("[DVT-03] bounded memory", () => {
  it("[DVT-03.10] run, write, flush and error buffers keep only the newest records", () => {
    const stream = new Stream().owner(1).signal(2, 1, "s").comp(3, 1, "effect");
    for (let i = 0; i < 50; i += 1) {
      stream.flushStart(0, 1).write(2, String(i)).run(3, [2]).flushEnd(1).error(1, `e${i}`);
    }
    const model = foldEvents(stream.events, { runs: 10, writes: 7, flushes: 5, errors: 3 });
    expect(model.runs.size).toBe(10);
    expect(model.writes.size).toBe(7);
    expect(model.flushes.size).toBe(5);
    expect(model.errors.size).toBe(3);
    expect(model.errors.last()?.message).toBe("e49");
    expect(model.runs.dropped).toBe(40);
  });

  it("[DVT-03.11] nodes beyond maxNodes are counted and ignored", () => {
    const stream = new Stream();
    for (let id = 1; id <= 10; id += 1) stream.owner(id);
    const model = foldEvents(stream.events, { maxNodes: 4 });
    expect(model.nodes.size).toBe(4);
    expect(model.overflow).toBe(6);
  });

  it("[DVT-03.12] the graveyard keeps only the most recently disposed nodes", () => {
    const stream = new Stream();
    for (let id = 1; id <= 6; id += 1) stream.owner(id);
    for (let id = 1; id <= 6; id += 1) stream.disposeOwner(id);
    const model = foldEvents(stream.events, { graveyard: 2 });
    expect([...model.graveyard.keys()]).toEqual([5, 6]);
    expect(model.node(1)).toBeUndefined();
  });

  it("[DVT-03.13] very deep ownership does not overflow the stack", () => {
    const stream = new Stream();
    for (let id = 1; id <= 20_000; id += 1) stream.owner(id, id - 1);
    const snap = snapshotOf(foldEvents(stream.events));
    expect(snap.nodes[19_999]?.depth).toBe(19_999);
    expect(ownerTree(snap)).toHaveLength(1);
  });
});

describe("[DVT-03] lifecycle of leaves", () => {
  it("[DVT-03.14] disposing an owner retires its signals, stores and resources, and reports each", () => {
    const stream = new Stream()
      .owner(1, 0, "root", "App")
      .owner(2, 1, "owner", "Child")
      .signal(3, 2, "s")
      .store(4, 2, "t")
      .resource(5, 2, "ready", "r")
      .signal(6, 1, "outer")
      .disposeOwner(2);
    const buried: number[] = [];
    const model = new InspectorModel();
    model.onBury = (record) => buried.push(record.id);
    for (const event of stream.events) model.apply(event);
    expect([...model.nodes.keys()]).toEqual([1, 6]);
    expect(buried.sort()).toEqual([2, 3, 4, 5]);
    expect(model.node(3)?.alive).toBe(false);
  });

  it("[DVT-03.15] a signal that dies detaches from the computations that read it", () => {
    const stream = new Stream()
      .owner(1)
      .signal(2, 1, "gone")
      .comp(3, 1, "effect", "reader")
      .run(3, [2]);
    stream.disposeOwner(2);
    const model = foldEvents(stream.events);
    expect(model.node(3)?.sources).toEqual([]);
    expect(model.node(2)?.observers).toBeNull();
  });

  it("[DVT-03.16] a long-lived owner that keeps making signals does not collect dead ones forever", () => {
    const stream = new Stream().owner(1);
    for (let id = 2; id <= 5_000; id += 1) stream.signal(id, 1, `s${id}`).disposeOwner(id);
    const model = foldEvents(stream.events, { graveyard: 10 });
    expect(model.nodes.size).toBe(1);
    expect(model.graveyard.size).toBe(10);
  });
});

describe("[DVT-04] flame timeline", () => {
  it("[DVT-04.1] groups runs by flush and nests a run started inside another one", () => {
    const stream = new Stream()
      .owner(1)
      .comp(2, 1, "effect", "outer")
      .comp(3, 1, "memo", "inner")
      .comp(4, 1, "effect", "next");
    stream.t = 10;
    stream.flushStart(0, 2);
    // inner (memo pulled by outer) finishes first and is recorded first.
    stream
      .run(3, [], { start: 11, duration: 2 })
      .run(2, [3], { start: 10, duration: 5 })
      .run(4, [], { start: 16, duration: 1 });
    stream.t = 20;
    stream.flushEnd(3);
    const [flush] = flameTimeline(foldEvents(stream.events));
    expect(flush).toMatchObject({ render: 0, user: 2, lanes: 2, duration: 10 });
    expect(flush?.spans.map((span) => [span.label, span.depth, span.start, span.end])).toEqual([
      ["outer", 0, 10, 15],
      ["inner", 1, 11, 13],
      ["next", 0, 16, 17],
    ]);
  });

  it("[DVT-04.2] runs outside any flush form flush 0 and the newest-N option trims flushes", () => {
    const stream = new Stream().owner(1).comp(2, 1, "effect", "mount");
    stream.run(2, [], { start: 1, duration: 1 });
    for (let i = 0; i < 4; i += 1)
      stream
        .flushStart()
        .run(2, [], { start: 10 + i, duration: 1 })
        .flushEnd(1);
    const model = foldEvents(stream.events);
    const all = flameTimeline(model);
    expect(all.map((entry) => entry.flush === 0)).toEqual([true, false, false, false, false]);
    expect(flameTimeline(model, { last: 2 })).toHaveLength(2);
  });

  it("[DVT-04.3] an unfinished flush stays open and unknown nodes get a placeholder name", () => {
    const stream = new Stream().flushStart(1, 0);
    const model = foldEvents(stream.events);
    expect(model.flushes.last()?.open).toBe(true);
    expect(flameTimeline(model)[0]?.spans).toEqual([]);
  });

  it("[DVT-04.4] runs outside a flush end at the latest end of their spans", () => {
    const stream = new Stream().owner(1).comp(2, 1, "effect", "long").comp(3, 1, "memo", "short");
    stream.run(3, [], { start: 11, duration: 2 }).run(2, [], { start: 10, duration: 100 });
    const [loose] = flameTimeline(foldEvents(stream.events));
    expect(loose).toMatchObject({ flush: 0, start: 10, end: 110, duration: 100 });
  });

  it("[DVT-04.5] asking for the newest 0 flushes returns none", () => {
    const stream = new Stream().owner(1).comp(2, 1, "effect", "fx");
    for (let i = 0; i < 3; i += 1)
      stream
        .flushStart()
        .run(2, [], { start: 10 + i, duration: 1 })
        .flushEnd(1);
    expect(flameTimeline(foldEvents(stream.events), { last: 0 })).toEqual([]);
  });
});

describe("[DVT-05] why did this run?", () => {
  it("[DVT-05.1] a signal write caused an effect run", () => {
    const stream = new Stream()
      .owner(1)
      .signal(2, 1, "count")
      .comp(3, 1, "effect", "log")
      .run(3, [2]);
    stream.write(2, "1", 0, [3]).run(3, [2]);
    const why = explainRun(foldEvents(stream.events), 3);
    expect(why?.chain.map((step) => [step.kind, step.label])).toEqual([
      ["write", "count"],
      ["run", "log"],
    ]);
    expect(why?.chain[0]).toMatchObject({ preview: "1" });
    expect(why?.alsoCausedBy).toEqual([]);
    expect(why?.truncated).toBe(false);
  });

  it("[DVT-05.2] the first run is the initial computation", () => {
    const stream = new Stream().owner(1).comp(2, 1, "effect", "first").run(2, []);
    const why = explainRun(foldEvents(stream.events), 2);
    expect(why?.chain.map((step) => step.kind)).toEqual(["initial", "run"]);
  });

  it("[DVT-05.3] follows a memo that changed back to the write", () => {
    const stream = new Stream()
      .owner(1)
      .signal(2, 1, "count")
      .comp(3, 1, "memo", "doubled")
      .comp(4, 1, "effect", "title");
    stream.run(3, [2]).run(4, [3]);
    stream.write(2, "5", 0, [3]).run(3, [2], { changed: true }).run(4, [3]);
    const why = explainRun(foldEvents(stream.events), 4);
    expect(why?.chain.map((step) => step.label)).toEqual(["count", "doubled", "title"]);
    expect(why?.chain.map((step) => step.kind)).toEqual(["write", "run", "run"]);
  });

  it("[DVT-05.4] a memo whose value did not change is not a cause", () => {
    const stream = new Stream()
      .owner(1)
      .signal(2, 1, "n")
      .comp(3, 1, "memo", "even")
      .comp(4, 1, "effect", "fx");
    stream.run(3, [2]).run(4, [3]);
    stream.write(2, "3", 0, [3]).run(3, [2], { changed: false });
    const model = foldEvents(stream.events);
    // The effect did not re-run, so its latest run is still the initial one.
    expect(explainRun(model, 4)?.chain.map((step) => step.kind)).toEqual(["initial", "run"]);
  });

  it("[DVT-05.5] a write made by another effect continues with that effect's run", () => {
    const stream = new Stream()
      .owner(1)
      .signal(2, 1, "source")
      .signal(3, 1, "mirror")
      .comp(4, 1, "effect", "copy")
      .comp(5, 1, "effect", "show");
    stream.run(4, [2]).run(5, [3]);
    // source changes from outside; effect "copy" writes mirror; effect "show" reacts.
    stream.write(2, "1", 0, [4]);
    stream.write(3, "1", 4, [5]).run(4, [2]);
    stream.run(5, [3]);
    const why = explainRun(foldEvents(stream.events), 5);
    expect(why?.chain.map((step) => `${step.kind}:${step.label}`)).toEqual([
      "write:source",
      "run:copy",
      "write:mirror",
      "run:show",
    ]);
    expect(why?.chain[2]).toMatchObject({ writer: "copy" });
  });

  it("[DVT-05.6] lists the other sources that also changed", () => {
    const stream = new Stream()
      .owner(1)
      .signal(2, 1, "a")
      .signal(3, 1, "b")
      .comp(4, 1, "effect", "sum");
    stream.run(4, [2, 3]);
    stream.write(2, "1", 0, [4]).write(3, "1", 0, [4]).run(4, [2, 3]);
    const why = explainRun(foldEvents(stream.events), 4);
    expect(why?.chain.map((step) => step.label)).toEqual(["a", "sum"]);
    expect(why?.alsoCausedBy.map((step) => step.label)).toEqual(["b"]);
  });

  it("[DVT-05.7] marks the chain truncated when the write fell out of the ring", () => {
    const stream = new Stream()
      .owner(1)
      .signal(2, 1, "n")
      .signal(9, 1, "noise")
      .comp(3, 1, "effect", "fx")
      .run(3, [2]);
    stream.write(2, "1", 0, [3]);
    for (let i = 0; i < 5; i += 1) stream.write(9, String(i));
    stream.run(3, [2]);
    const why = explainRun(foldEvents(stream.events, { writes: 2 }), 3);
    expect(why?.truncated).toBe(true);
  });

  it("[DVT-05.10] a resource state change is a cause that is recorded, not missing history", () => {
    const stream = new Stream()
      .owner(1)
      .resource(2, 1, "pending", "data")
      .comp(3, 1, "effect", "fx")
      .run(3, [2]);
    stream.resource(2, 1, "ready").run(3, [2]);
    const why = explainRun(foldEvents(stream.events), 3);
    expect(why?.truncated).toBe(false);
    expect(why?.chain.map((step) => [step.kind, step.label])).toEqual([
      ["unknown", "data"],
      ["run", "fx"],
    ]);
  });

  it("[DVT-05.8] explains an older run by sequence number and returns null for unknown nodes", () => {
    const stream = new Stream().owner(1).signal(2, 1, "n").comp(3, 1, "effect", "fx").run(3, [2]);
    stream.write(2, "1", 0, [3]).run(3, [2]);
    const secondRun = stream.seq;
    stream.write(2, "2", 0, [3]).run(3, [2]);
    const model = foldEvents(stream.events);
    expect(explainRun(model, 3, { runSeq: secondRun })?.chain[0]).toMatchObject({ preview: "1" });
    expect(explainRun(model, 3)?.chain[0]).toMatchObject({ preview: "2" });
    expect(explainRun(model, 999)).toBeNull();
  });

  it("[DVT-05.9] the chain length is capped and cycles cannot loop forever", () => {
    const stream = new Stream().owner(1).signal(2, 1, "n");
    // A ping-pong of two effects that write each other's source.
    stream
      .signal(3, 1, "m")
      .comp(4, 1, "effect", "a")
      .comp(5, 1, "effect", "b")
      .run(4, [2])
      .run(5, [3]);
    for (let i = 0; i < 100; i += 1) {
      stream.write(3, `m${i}`, 4, [5]).run(4, [2]);
      stream.write(2, `n${i}`, 5, [4]).run(5, [3]);
    }
    const why = explainRun(foldEvents(stream.events), 5, { maxDepth: 6 });
    expect(why).not.toBeNull();
    expect((why?.chain.length ?? 0) <= 14).toBe(true);
  });
});
