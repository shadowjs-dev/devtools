import { onCleanup, useMemo, useSignal } from "@shadow-js/core";
import { For, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import {
  type Bar,
  buildTimeline,
  causesOfRun,
  clampViewport,
  effectsOfWrite,
  extentOf,
  fullViewport,
  isRun,
  isWrite,
  labelOf,
  layoutLane,
  neighbor,
  panViewport,
  revealRange,
  type Timeline,
  type Viewport,
  WRITES_LANE,
  zoomViewport,
} from "../timeline/analysis";
import { MAX_CAPACITY, type TimelineEntry } from "../timeline/recorder";
import { MAX_IMPORT_CHARS, parseRecording, serializeRecording } from "../timeline/schema";
import type { TimelineSession } from "../timeline/session";

/**
 * Saves a text file for the user. The default offers a download; tests pass their own.
 *
 * @since 1.0.0
 */
export interface FileSaver {
  /**
   * @param name The suggested file name.
   * @param text The file's content.
   */
  save(name: string, text: string): void;
}

/**
 * Props of {@link TimelineView}.
 *
 * @since 1.0.0
 */
export interface TimelineViewProps {
  /** The session the view shows and controls. */
  readonly session: TimelineSession;
  /** Saves the exported recording. Defaults to a browser download. */
  readonly files?: FileSaver;
  /**
   * Runs a redraw. Event batches are drawn once per frame, as the rest of the panel does; the default is
   * `requestAnimationFrame`. Tests pass a function that runs it at once.
   */
  readonly schedule?: (run: () => void) => void;
}

/** Width of the plot in drawing units; the SVG scales it to the space the panel has. */
const PLOT_WIDTH = 1000;
/** Height of one lane, in pixels. The lane labels use the same height. */
const LANE_HEIGHT = 24;
/** Lanes shown at first, and added by each press of the "Show more lanes" button. */
const LANE_STEP = 40;
/** Most rows of the list of entries in view. */
const LIST_LIMIT = 100;

/**
 * The default {@link FileSaver}: a download through a temporary link to a blob.
 *
 * @since 1.0.0
 */
export const downloadFiles: FileSaver = {
  save(name, text): void {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },
};

function ms(value: number): string {
  return `${value.toFixed(Math.abs(value) < 10 ? 2 : 1)} ms`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const NONE: readonly number[] = [];

/** What the selected entry is linked to: its causes (writes, runs) or its effects. */
interface Related {
  readonly writes: readonly number[];
  readonly runs: readonly number[];
  readonly effects: readonly number[];
}

/** The CSS class that colors a bar by what it is. */
function barKind(timeline: Timeline, index: number): string {
  const item = timeline.data.entries[index];
  if (item?.k === "write") return "tl-write";
  return item?.k === "run" && !item.changed ? "tl-same" : "tl-run";
}

/** The sentence that names an entry, for the details, the lists and the live region. */
function describe(timeline: Timeline, entry: TimelineEntry): string {
  const { data } = timeline;
  if (entry.k === "write")
    return `Write to ${labelOf(data, entry.signal)} at +${ms(entry.t - timeline.origin)}`;
  if (entry.k === "run") {
    return `Run of ${labelOf(data, entry.comp)} at +${ms(entry.t - timeline.origin)}, ${ms(entry.duration)}`;
  }
  return `Flush at +${ms(entry.t - timeline.origin)}, ${plural(entry.runs, "run", "runs")}`;
}

/**
 * The Timeline tab: records reactive activity over time and shows it as one lane per computation. Start and
 * Stop control the recording; the entries live in a bounded buffer, so memory stays flat however long it
 * runs. The plot zooms and pans (buttons, keys, wheel with Ctrl, drag); selecting a run lists the signal
 * writes that caused it, and selecting a write lists the runs it set off. A recording exports to a JSON file
 * and imports from one (the import is validated: see `parseRecording`).
 *
 * Keyboard: Tab reaches the toolbar, then the plot. In the plot the arrow keys move the selection (left and
 * right along a lane, up and down between lanes), `+` and `-` zoom, Shift with an arrow pans, `0` shows the
 * whole recording, Escape clears the selection. Every selection is also announced in the status line, and
 * the entries in view are listed in a table, so nothing depends on seeing the drawing.
 *
 * @param props The session and the optional file saver and scheduler.
 * @returns The view.
 * @since 1.0.0
 */
export const TimelineView: Component<TimelineViewProps> = (props) => {
  const session = props.session;
  const files = props.files ?? downloadFiles;
  const schedule =
    props.schedule ?? ((run: () => void): void => void requestAnimationFrame(() => run()));

  const [tick, setTick] = useSignal(0);
  const [fitAll, setFit] = useSignal(true);
  const [range, setRange] = useSignal<Viewport>({ start: 0, end: 1 });
  const [selected, setSelected] = useSignal(-1);
  const [follow, setFollow] = useSignal(true);
  const [laneLimit, setLaneLimit] = useSignal(LANE_STEP);
  const [message, setMessage] = useSignal("");
  const [problem, setProblem] = useSignal("");

  // Reading `tick` first makes these follow the session, whose getters are plain values.
  const recording = (): boolean => {
    tick();
    return session.recording;
  };
  const capacity = (): number => {
    tick();
    return session.capacity;
  };

  const timeline = useMemo<Timeline>(() => {
    tick();
    return buildTimeline(session.data());
  });
  const view = useMemo<Viewport>(() => {
    const model = timeline();
    return fitAll() ? fullViewport(model) : clampViewport(range(), model.span);
  });

  let scheduled = false;
  const redraw = (): void => {
    if (scheduled) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      if (session.recording && follow() && !fitAll()) {
        const model = buildTimeline(session.data());
        const length = range().end - range().start;
        setRange(clampViewport({ start: model.span - length, end: model.span }, model.span));
      }
      setTick((current) => current + 1);
    });
  };
  const stop = session.subscribe(redraw);
  onCleanup(stop);

  const lanes = useMemo(() => {
    const model = timeline();
    const window = view();
    const count = Math.min(model.lanes.length, laneLimit() + 1);
    const out = [];
    for (let i = 0; i < count; i += 1) out.push(layoutLane(model, i, window, PLOT_WIDTH));
    return out;
  });
  const bandRects = useMemo(() => {
    const shown = view();
    const scale = PLOT_WIDTH / (shown.end - shown.start);
    const out: Array<{ key: number; x: number; width: number }> = [];
    timeline().flushes.forEach(([start, end], key) => {
      if (end < shown.start || start > shown.end || out.length >= 300) return;
      out.push({
        key,
        x: (start - shown.start) * scale,
        width: Math.max((end - start) * scale, 1),
      });
    });
    return out;
  });

  const entry = useMemo(() => timeline().data.entries[selected()]);
  const run = useMemo(() => {
    const current = entry();
    return isRun(current) ? current : undefined;
  });
  const write = useMemo(() => {
    const current = entry();
    return isWrite(current) ? current : undefined;
  });
  const related = useMemo<Related>(() => {
    const data = timeline().data;
    if (run() !== undefined) {
      const causes = causesOfRun(data, selected());
      return { writes: causes.writes, runs: causes.via, effects: NONE };
    }
    if (write() !== undefined) {
      return { writes: NONE, runs: NONE, effects: effectsOfWrite(data, selected()) };
    }
    return { writes: NONE, runs: NONE, effects: NONE };
  });
  const relatedSet = useMemo(() => {
    const current = related();
    return new Set<number>([...current.writes, ...current.runs, ...current.effects]);
  });
  const inView = useMemo(() => {
    const model = timeline();
    const shown = view();
    const out: number[] = [];
    for (let i = 0; i < model.data.entries.length && out.length < LIST_LIMIT; i += 1) {
      const item = model.data.entries[i];
      if (item === undefined || item.k === "flush") continue;
      const [start, end] = extentOf(model, item);
      if (end >= shown.start && start <= shown.end) out.push(i);
    }
    return out;
  });

  const status = useMemo(() => {
    tick();
    const data = session.data();
    const count = plural(data.entries.length, "entry", "entries");
    const dropped = data.dropped > 0 ? `, ${data.dropped} older overwritten` : "";
    if (session.imported) return `Imported recording: ${count}${dropped}.`;
    if (session.recording) return `Recording: ${count}${dropped}.`;
    return data.entries.length === 0 ? "Not recording." : `Stopped: ${count}${dropped}.`;
  });

  const select = (index: number, reveal: boolean): void => {
    setSelected(index);
    const model = timeline();
    const item = model.data.entries[index];
    if (item === undefined) {
      setMessage("");
      return;
    }
    setMessage(describe(model, item));
    if (reveal && !fitAll()) {
      const [start, end] = extentOf(model, item);
      setRange(revealRange(view(), start, end, model.span));
    }
  };

  const setView = (next: Viewport): void => {
    setFit(false);
    setRange(next);
  };
  const zoom = (factor: number, anchor = 0.5): void => {
    const model = timeline();
    setView(zoomViewport(view(), factor, anchor, model.span));
  };
  const pan = (fraction: number): void => {
    const model = timeline();
    const current = view();
    setView(panViewport(current, (current.end - current.start) * fraction, model.span));
  };

  const sync = (): void => {
    setTick((current) => current + 1);
  };
  const toggleRecording = (): void => {
    if (session.recording) {
      session.stop();
      setMessage("Recording stopped.");
      sync();
    } else if (session.start()) {
      setProblem("");
      setSelected(-1);
      setFit(true);
      setMessage("Recording started.");
      sync();
    }
  };
  const clearAll = (): void => {
    session.clear();
    setSelected(-1);
    setFit(true);
    setProblem("");
    setMessage("Recording cleared.");
    sync();
  };
  const changeCapacity = (event: Event): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    if (session.setCapacity(Number(input.value))) {
      setSelected(-1);
      setProblem("");
      setMessage(`Buffer size set to ${session.capacity} entries; the recording was cleared.`);
      sync();
    } else {
      input.value = String(session.capacity);
      setProblem(`The buffer size must be a whole number from 1 to ${MAX_CAPACITY}.`);
    }
  };
  const exportRecording = (): void => {
    const data = session.data();
    if (data.entries.length === 0) {
      setProblem("There is nothing to export yet.");
      return;
    }
    files.save("shadowjs-timeline.json", serializeRecording(data));
    setProblem("");
    setMessage(`Exported ${plural(data.entries.length, "entry", "entries")}.`);
  };
  const importRecording = (event: Event): void => {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) return;
    const file = input.files?.[0];
    input.value = "";
    if (file === undefined) return;
    if (file.size > MAX_IMPORT_CHARS) {
      setProblem("The file is too large to import.");
      return;
    }
    void file.text().then(
      (text) => {
        const result = parseRecording(text);
        if (!result.ok) {
          setProblem(`Import failed: ${result.error}`);
          return;
        }
        session.load(result.data);
        setProblem("");
        setSelected(-1);
        setFit(true);
        sync();
        setMessage(`Imported ${plural(result.data.entries.length, "entry", "entries")}.`);
      },
      () => setProblem("Import failed: the file could not be read."),
    );
  };

  let dragging: { x: number; window: Viewport; moved: boolean } | null = null;
  const onKey = (event: KeyboardEvent): void => {
    const key = event.key;
    const model = timeline();
    const arrows: Record<string, "left" | "right" | "up" | "down"> = {
      ArrowLeft: "left",
      ArrowRight: "right",
      ArrowUp: "up",
      ArrowDown: "down",
    };
    const direction = arrows[key];
    if (direction !== undefined) {
      event.preventDefault();
      if (event.shiftKey && (direction === "left" || direction === "right")) {
        pan(direction === "left" ? -0.25 : 0.25);
        return;
      }
      select(neighbor(model, selected(), direction), true);
      return;
    }
    if (key === "+" || key === "=") zoom(0.5);
    else if (key === "-" || key === "_") zoom(2);
    else if (key === "0") setFit(true);
    else if (key === "Home") setView(panViewport(view(), -model.span, model.span));
    else if (key === "End") setView(panViewport(view(), model.span, model.span));
    else if (key === "Escape") select(-1, false);
    else return;
    event.preventDefault();
  };
  const onWheel = (event: WheelEvent): void => {
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const box = target instanceof Element ? target.getBoundingClientRect() : undefined;
    const anchor =
      box === undefined || box.width === 0 ? 0.5 : (event.clientX - box.left) / box.width;
    if (event.shiftKey && !event.ctrlKey && !event.metaKey) pan(event.deltaY > 0 ? 0.1 : -0.1);
    else zoom(event.deltaY > 0 ? 1.25 : 0.8, anchor);
  };
  const onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    dragging = { x: event.clientX, window: view(), moved: false };
  };
  const onPointerMove = (event: PointerEvent): void => {
    const drag = dragging;
    const target = event.currentTarget;
    if (drag === null || !(target instanceof Element)) return;
    const width = target.getBoundingClientRect().width;
    if (width === 0) return;
    const shift = event.clientX - drag.x;
    if (Math.abs(shift) > 3) drag.moved = true;
    if (!drag.moved) return;
    const length = drag.window.end - drag.window.start;
    setView(panViewport(drag.window, (-shift / width) * length, timeline().span));
  };
  const onPointerUp = (): void => {
    dragging = null;
  };
  const clickBar = (bar: Bar): void => {
    if (dragging?.moved === true) return;
    select(bar.index, false);
  };

  const describeAt = (index: number): string => {
    const model = timeline();
    const item = model.data.entries[index];
    return item === undefined ? "" : describe(model, item);
  };
  const RelatedList: Component<{ title: string; indexes: readonly number[] }> = (list) => (
    <Show when={list.indexes.length > 0}>
      <h4>{list.title}</h4>
      <ul class="tl-related">
        <For each={list.indexes} key={(index) => index}>
          {(index) => (
            <li>
              <button type="button" class="link" on:click={() => select(index(), true)}>
                {describeAt(index())}
              </button>
            </li>
          )}
        </For>
      </ul>
    </Show>
  );

  return (
    <section class="tl" aria-label="Timeline recording">
      <div class="tl-toolbar" role="toolbar" aria-label="Timeline controls">
        <button
          type="button"
          class="btn"
          aria-pressed={recording()}
          disabled={!session.available}
          on:click={toggleRecording}
        >
          {recording() ? "Stop recording" : "Start recording"}
        </button>
        <button type="button" class="btn" on:click={clearAll}>
          Clear
        </button>
        <label class="tl-field">
          <span>Buffer size</span>
          <input
            type="number"
            min="1"
            max={MAX_CAPACITY}
            step="1"
            value={capacity()}
            disabled={recording()}
            on:change={changeCapacity}
          />
        </label>
        <button type="button" class="btn" on:click={() => zoom(0.5)}>
          Zoom in
        </button>
        <button type="button" class="btn" on:click={() => zoom(2)}>
          Zoom out
        </button>
        <button type="button" class="btn" on:click={() => pan(-0.25)}>
          Earlier
        </button>
        <button type="button" class="btn" on:click={() => pan(0.25)}>
          Later
        </button>
        <button type="button" class="btn" on:click={() => setFit(true)}>
          Show everything
        </button>
        <label class="tl-field">
          <input
            type="checkbox"
            checked={follow()}
            on:change={(event) => setFollow(event.currentTarget.checked)}
          />
          <span>Follow live</span>
        </label>
        <button type="button" class="btn" on:click={exportRecording}>
          Export JSON
        </button>
        <label class="tl-field">
          <span>Import JSON</span>
          <input type="file" accept=".json,application/json" on:change={importRecording} />
        </label>
      </div>
      <p class="tl-status" role="status" aria-live="polite">
        {status()} {message()}
      </p>
      <Show when={problem() !== ""}>
        <p class="error" role="alert">
          {problem()}
        </p>
      </Show>
      <Show
        when={timeline().data.entries.length > 0}
        fallback={
          <p class="empty">
            Nothing recorded. Press Start recording, then use the app: each signal write and each
            computation run appears here with its duration.
          </p>
        }
      >
        <div class="tl-grid">
          <div class="tl-labels" aria-hidden="true">
            <For each={lanes()} key={(lane) => lane.lane}>
              {(lane) => <div class="tl-label">{timeline().lanes[lane().lane]?.label ?? ""}</div>}
            </For>
          </div>
          <div
            class="tl-plot"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the plot is a keyboard widget (arrows select, plus and minus zoom); role="application" hands those keys to it
            tabIndex={0}
            role="application"
            aria-label="Timeline lanes. Arrow keys select, plus and minus zoom, Shift with an arrow pans, 0 shows everything."
            on:keydown={onKey}
            on:wheel={onWheel}
            on:pointerdown={onPointerDown}
            on:pointermove={onPointerMove}
            on:pointerup={onPointerUp}
            on:pointerleave={onPointerUp}
          >
            <svg
              viewBox={`0 0 ${PLOT_WIDTH} ${lanes().length * LANE_HEIGHT}`}
              height={lanes().length * LANE_HEIGHT}
              preserveAspectRatio="none"
              aria-hidden="true"
              class="tl-svg"
            >
              <For each={bandRects()} key={(band) => band.key}>
                {(band) => (
                  <rect
                    class="tl-flush"
                    x={band().x}
                    y="0"
                    width={band().width}
                    height={lanes().length * LANE_HEIGHT}
                  />
                )}
              </For>
              <For each={lanes()} key={(lane) => lane.lane}>
                {(lane) => (
                  <g data-lane={lane().lane}>
                    <rect
                      class="tl-rule"
                      x="0"
                      y={(lane().lane + 1) * LANE_HEIGHT - 1}
                      width={PLOT_WIDTH}
                      height="1"
                    />
                    <For each={lane().bars} key={(bar) => bar.index}>
                      {(bar) => (
                        <rect
                          class={`tl-bar ${barKind(timeline(), bar().index)}${selected() === bar().index ? " tl-selected" : ""}${relatedSet().has(bar().index) ? " tl-related-bar" : ""}`}
                          data-index={bar().index}
                          x={bar().x}
                          y={lane().lane * LANE_HEIGHT + 4}
                          width={
                            lane().lane === WRITES_LANE ? Math.max(bar().width, 2) : bar().width
                          }
                          height={LANE_HEIGHT - 8}
                          on:click={() => clickBar(bar())}
                        />
                      )}
                    </For>
                  </g>
                )}
              </For>
            </svg>
          </div>
        </div>
        <p class="tl-axis">
          Showing +{ms(view().start)} to +{ms(view().end)} of {ms(timeline().span)}.
          <Show when={timeline().hiddenLanes > 0}>
            {" "}
            {plural(timeline().hiddenLanes, "quieter computation has", "quieter computations have")}{" "}
            no lane.
          </Show>
          <Show when={lanes().reduce((sum, lane) => sum + lane.hidden, 0) > 0}>
            {" "}
            Zoom in to see every bar.
          </Show>
        </p>
        <Show when={timeline().lanes.length > laneLimit() + 1}>
          <button type="button" class="btn" on:click={() => setLaneLimit(laneLimit() + LANE_STEP)}>
            Show more lanes
          </button>
        </Show>
        <aside class="tl-details" aria-label="Selection details">
          <Show
            when={entry() !== undefined}
            fallback={<p class="empty">Select a bar to see what caused it.</p>}
          >
            <h3>{describeAt(selected())}</h3>
            <Show when={run()}>
              {(item) => (
                <>
                  <p>
                    {item().changed ? "The value changed." : "The value did not change."} It read{" "}
                    {item().sources.length === 0
                      ? "nothing"
                      : item()
                          .sources.map((id) => labelOf(timeline().data, id))
                          .join(", ")}
                    .
                  </p>
                  <Show
                    when={related().writes.length + related().runs.length > 0}
                    fallback={
                      <p class="note">
                        No cause is in the recording: the write may be older than the buffer.
                      </p>
                    }
                  >
                    <RelatedList title="Caused by these writes" indexes={related().writes} />
                    <RelatedList title="Through these runs" indexes={related().runs} />
                  </Show>
                </>
              )}
            </Show>
            <Show when={write()}>
              {(item) => (
                <>
                  <p>
                    Written by{" "}
                    {item().writer === 0
                      ? "code outside any computation"
                      : labelOf(timeline().data, item().writer)}
                    . Subscribed: {plural(item().observers.length, "computation", "computations")}.
                  </p>
                  <Show
                    when={related().effects.length > 0}
                    fallback={<p class="note">No run followed this write in the recording.</p>}
                  >
                    <RelatedList title="Set off these runs" indexes={related().effects} />
                  </Show>
                </>
              )}
            </Show>
          </Show>
        </aside>
        <details class="tl-list">
          <summary>Entries in view ({inView().length})</summary>
          <table>
            <caption class="sr-only">Recorded entries in the visible window</caption>
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Entry</th>
                <th scope="col">Select</th>
              </tr>
            </thead>
            <tbody>
              <For each={inView()} key={(index) => index}>
                {(index) => (
                  <tr aria-selected={selected() === index()}>
                    <td>+{ms((timeline().data.entries[index()]?.t ?? 0) - timeline().origin)}</td>
                    <td>{describeAt(index())}</td>
                    <td>
                      <button type="button" class="link" on:click={() => select(index(), true)}>
                        Select
                      </button>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </details>
      </Show>
    </section>
  );
};
