/**
 * The timeline model: lanes built from recorded entries, the visible window (zoom and pan), the bars to draw
 * for a window, keyboard neighbors, and the causes of a run or the effects of a write. Pure functions over
 * {@link TimelineData}: no DOM, no timers, so the tests need no browser.
 *
 * @packageDocumentation
 */
import type { RunEntry, TimelineData, TimelineEntry, WriteEntry } from "./recorder";

/**
 * Most computation lanes the model keeps. The busiest computations win; the rest are counted in
 * {@link Timeline.hiddenLanes}.
 *
 * @since 1.0.0
 */
export const MAX_LANES = 200;

/**
 * Most bars one lane draws for one window, after merging bars closer than a pixel. The rest are counted.
 *
 * @since 1.0.0
 */
export const MAX_BARS_PER_LANE = 300;

/**
 * Smallest window, in milliseconds. Zooming in stops here.
 *
 * @since 1.0.0
 */
export const MIN_SPAN = 0.05;

/**
 * Most entries scanned to find the effects of one write.
 *
 * @since 1.0.0
 */
export const MAX_SCAN = 5000;

/**
 * Most items in a list of causes or effects.
 *
 * @since 1.0.0
 */
export const MAX_RELATED = 50;

/**
 * The id of the lane that holds the signal writes.
 *
 * @since 1.0.0
 */
export const WRITES_LANE = 0;

/**
 * One lane: the writes, or the runs of one computation.
 *
 * @since 1.0.0
 */
export interface Lane {
  /** `0` ({@link WRITES_LANE}) for the writes lane, otherwise the computation's node id. */
  readonly id: number;
  /** The text shown beside the lane. */
  readonly label: string;
  /** Indexes into `data.entries`, in time order. */
  readonly entries: readonly number[];
}

/**
 * The model of one recording.
 *
 * @since 1.0.0
 */
export interface Timeline {
  /** The recorded data. */
  readonly data: TimelineData;
  /** The first time on the clock of the recording, in ms. Every position below is relative to it. */
  readonly origin: number;
  /** Length of the recording in ms (at least 1). */
  readonly span: number;
  /** The lanes: the writes first, then the computations in order of first appearance. */
  readonly lanes: readonly Lane[];
  /** Computations with runs that did not get a lane. */
  readonly hiddenLanes: number;
  /** Where each entry sits: its lane index, or `-1` for a flush or an entry without a lane. */
  readonly laneOf: readonly number[];
  /** The flushes as `[start, end]` pairs relative to `origin`, in order. */
  readonly flushes: ReadonlyArray<readonly [number, number]>;
}

/**
 * Start and end of a run or a write, relative to the origin of the recording.
 *
 * @param timeline The model.
 * @param entry The entry.
 * @returns `[start, end]` in ms; a write is a point (`end === start`).
 * @since 1.0.0
 */
export function extentOf(timeline: Timeline, entry: TimelineEntry): readonly [number, number] {
  const start = entry.t - timeline.origin;
  if (entry.k === "run") return [start, start + entry.duration];
  if (entry.k === "flush") return [start, entry.end - timeline.origin];
  return [start, start];
}

/**
 * The display name of a node in a recording.
 *
 * @param data The recorded data.
 * @param id A node id.
 * @returns The label, or `#id` when the recording has none.
 * @since 1.0.0
 */
export function labelOf(data: TimelineData, id: number): string {
  return data.labels.get(id) ?? `#${id}`;
}

/**
 * Builds the model: groups the entries into lanes and measures the recording.
 *
 * @param data The recorded data.
 * @returns The model.
 * @example
 * import { buildTimeline } from "./analysis";
 *
 * const timeline = buildTimeline({ entries: [], labels: new Map(), dropped: 0, capacity: 100 });
 * timeline.lanes.length; // 1: the writes lane
 * @since 1.0.0
 */
export function buildTimeline(data: TimelineData): Timeline {
  const { entries } = data;
  let origin = Number.POSITIVE_INFINITY;
  let last = Number.NEGATIVE_INFINITY;
  const writes: number[] = [];
  const byComp = new Map<number, number[]>();
  const flushes: Array<readonly [number, number]> = [];
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    origin = Math.min(origin, entry.t);
    last = Math.max(
      last,
      entry.k === "run" ? entry.t + entry.duration : entry.k === "flush" ? entry.end : entry.t,
    );
    if (entry.k === "write") {
      writes.push(i);
    } else if (entry.k === "run") {
      const list = byComp.get(entry.comp);
      if (list === undefined) byComp.set(entry.comp, [i]);
      else list.push(i);
    }
  }
  if (!Number.isFinite(origin)) {
    origin = 0;
    last = 0;
  }
  for (const entry of entries) {
    if (entry.k === "flush") flushes.push([entry.t - origin, entry.end - origin]);
  }
  // The busiest computations keep their lanes; lanes are then ordered by first appearance.
  const ranked = [...byComp].sort(
    (a, b) => b[1].length - a[1].length || (a[1][0] ?? 0) - (b[1][0] ?? 0),
  );
  const kept = ranked.slice(0, MAX_LANES).sort((a, b) => (a[1][0] ?? 0) - (b[1][0] ?? 0));
  const lanes: Lane[] = [{ id: WRITES_LANE, label: "Signal writes", entries: writes }];
  for (const [id, list] of kept) lanes.push({ id, label: labelOf(data, id), entries: list });
  const laneOf = new Array<number>(entries.length).fill(-1);
  lanes.forEach((lane, index) => {
    for (const entryIndex of lane.entries) laneOf[entryIndex] = index;
  });
  return {
    data,
    origin,
    span: Math.max(last - origin, 1),
    lanes,
    hiddenLanes: Math.max(ranked.length - kept.length, 0),
    laneOf,
    flushes,
  };
}

/**
 * The window on the time axis, in ms relative to the origin of the recording.
 *
 * @since 1.0.0
 */
export interface Viewport {
  readonly start: number;
  readonly end: number;
}

/**
 * The window that shows the whole recording.
 *
 * @param timeline The model.
 * @returns The window.
 * @since 1.0.0
 */
export function fullViewport(timeline: Timeline): Viewport {
  return { start: 0, end: timeline.span };
}

/**
 * Fits a window inside `[0, span]`: its length is kept when it fits (and limited to the span and to
 * {@link MIN_SPAN}), and it is moved inside the bounds.
 *
 * @param viewport The wanted window.
 * @param span Length of the recording in ms.
 * @returns A window inside the bounds.
 * @since 1.0.0
 */
export function clampViewport(viewport: Viewport, span: number): Viewport {
  const total = Math.max(Number.isFinite(span) ? span : 0, MIN_SPAN);
  const from = Number.isFinite(viewport.start) ? viewport.start : 0;
  const to = Number.isFinite(viewport.end) ? viewport.end : from + total;
  const length = Math.min(Math.max(to - from, MIN_SPAN), total);
  const start = Math.min(Math.max(from, 0), total - length);
  return { start, end: start + length };
}

/**
 * Zooms around a point of the window. A factor below 1 zooms in, above 1 zooms out. The point keeps its
 * place on screen.
 *
 * @param viewport The current window.
 * @param factor The new length divided by the old one.
 * @param anchor A fraction from 0 (start) to 1 (end) of the window that stays put.
 * @param span Length of the recording in ms.
 * @returns The new window, inside the bounds.
 * @example
 * import { zoomViewport } from "./analysis";
 *
 * zoomViewport({ start: 0, end: 100 }, 0.5, 0.5, 100); // { start: 25, end: 75 }
 * @since 1.0.0
 */
export function zoomViewport(
  viewport: Viewport,
  factor: number,
  anchor: number,
  span: number,
): Viewport {
  const length = viewport.end - viewport.start;
  const at = viewport.start + length * Math.min(Math.max(anchor, 0), 1);
  const next = length * (Number.isFinite(factor) && factor > 0 ? factor : 1);
  const t = Math.min(Math.max(anchor, 0), 1);
  return clampViewport({ start: at - next * t, end: at + next * (1 - t) }, span);
}

/**
 * Moves the window by `delta` ms (negative is earlier), stopping at the ends of the recording.
 *
 * @param viewport The current window.
 * @param delta How far to move, in ms.
 * @param span Length of the recording in ms.
 * @returns The new window.
 * @since 1.0.0
 */
export function panViewport(viewport: Viewport, delta: number, span: number): Viewport {
  const shift = Number.isFinite(delta) ? delta : 0;
  return clampViewport({ start: viewport.start + shift, end: viewport.end + shift }, span);
}

/**
 * Moves the window the least it takes to show `[start, end]`; zooms out when the range is longer than the
 * window.
 *
 * @param viewport The current window.
 * @param start Start of the range, in ms.
 * @param end End of the range, in ms.
 * @param span Length of the recording in ms.
 * @returns The window.
 * @since 1.0.0
 */
export function revealRange(
  viewport: Viewport,
  start: number,
  end: number,
  span: number,
): Viewport {
  const length = viewport.end - viewport.start;
  const pad = length * 0.05;
  if (end - start + 2 * pad > length) {
    return clampViewport({ start: start - pad, end: end + pad }, span);
  }
  if (start - pad < viewport.start)
    return clampViewport({ start: start - pad, end: start - pad + length }, span);
  if (end + pad > viewport.end)
    return clampViewport({ start: end + pad - length, end: end + pad }, span);
  return viewport;
}

/**
 * One bar (or one tick, for a write) to draw.
 *
 * @since 1.0.0
 */
export interface Bar {
  /** Index of the entry into `data.entries`. A merged bar names its first entry. */
  readonly index: number;
  /** Left edge in pixels from the start of the plot. */
  readonly x: number;
  /** Width in pixels (at least 1). */
  readonly width: number;
  /** How many entries the bar stands for (more than 1 when close entries were merged). */
  readonly count: number;
}

/**
 * The bars of one lane for a window.
 *
 * @since 1.0.0
 */
export interface LaneBars {
  /** The lane's index in `timeline.lanes`. */
  readonly lane: number;
  readonly bars: readonly Bar[];
  /** Bars left out because the lane drew {@link MAX_BARS_PER_LANE}. Zoom in to see them. */
  readonly hidden: number;
}

function firstEndingAfter(timeline: Timeline, lane: Lane, time: number): number {
  let low = 0;
  let high = lane.entries.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const entry = timeline.data.entries[lane.entries[middle] ?? 0];
    const end = entry === undefined ? Number.NEGATIVE_INFINITY : extentOf(timeline, entry)[1];
    if (end < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * Lays one lane out for a window and a width: only the entries that touch the window, each at least one
 * pixel wide, entries closer than a pixel merged into one bar, and at most {@link MAX_BARS_PER_LANE} bars.
 * The first entry of the window is found by binary search, so a long recording costs only what is on screen.
 *
 * @param timeline The model.
 * @param laneIndex The lane's index.
 * @param viewport The window.
 * @param width Width of the plot in pixels.
 * @returns The bars.
 * @since 1.0.0
 */
export function layoutLane(
  timeline: Timeline,
  laneIndex: number,
  viewport: Viewport,
  width: number,
): LaneBars {
  const lane = timeline.lanes[laneIndex];
  if (lane === undefined || width <= 0 || viewport.end <= viewport.start) {
    return { lane: laneIndex, bars: [], hidden: 0 };
  }
  const scale = width / (viewport.end - viewport.start);
  const bars: Bar[] = [];
  let hidden = 0;
  let previous: { index: number; x: number; end: number; count: number } | null = null;
  const flush = (): void => {
    if (previous === null) return;
    if (bars.length >= MAX_BARS_PER_LANE) {
      hidden += 1;
    } else {
      bars.push({
        index: previous.index,
        x: previous.x,
        width: Math.max(previous.end - previous.x, 1),
        count: previous.count,
      });
    }
    previous = null;
  };
  for (
    let at = firstEndingAfter(timeline, lane, viewport.start);
    at < lane.entries.length;
    at += 1
  ) {
    const index = lane.entries[at] ?? 0;
    const entry = timeline.data.entries[index];
    if (entry === undefined) continue;
    const [start, end] = extentOf(timeline, entry);
    if (start > viewport.end) break;
    const x = (start - viewport.start) * scale;
    const right = Math.max((end - viewport.start) * scale, x + 1);
    if (previous !== null && x - previous.end < 1) {
      previous.end = Math.max(previous.end, right);
      previous.count += 1;
    } else {
      flush();
      previous = { index, x, end: right, count: 1 };
    }
  }
  flush();
  return { lane: laneIndex, bars, hidden };
}

/**
 * The entry to select after an arrow key. Left and right move along the lane; up and down move to the
 * entry of the next lane that starts nearest in time.
 *
 * @param timeline The model.
 * @param index The selected entry's index (or `-1` for none).
 * @param direction The arrow.
 * @returns The new entry index, or `index` when there is nowhere to go (the first entry of the first lane
 *   when nothing was selected).
 * @since 1.0.0
 */
export function neighbor(
  timeline: Timeline,
  index: number,
  direction: "left" | "right" | "up" | "down",
): number {
  const entry = timeline.data.entries[index];
  const laneIndex = timeline.laneOf[index] ?? -1;
  const lane = timeline.lanes[laneIndex];
  if (entry === undefined || lane === undefined) {
    for (const candidate of timeline.lanes) {
      const first = candidate.entries[0];
      if (first !== undefined) return first;
    }
    return index;
  }
  if (direction === "left" || direction === "right") {
    const at = lane.entries.indexOf(index);
    const next = lane.entries[at + (direction === "left" ? -1 : 1)];
    return next ?? index;
  }
  const targetLane = timeline.lanes[laneIndex + (direction === "up" ? -1 : 1)];
  if (targetLane === undefined || targetLane.entries.length === 0) return index;
  let best = targetLane.entries[0] ?? index;
  let distance = Number.POSITIVE_INFINITY;
  for (const candidate of targetLane.entries) {
    const other = timeline.data.entries[candidate];
    if (other === undefined) continue;
    const gap = Math.abs(other.t - entry.t);
    if (gap < distance) {
      distance = gap;
      best = candidate;
    } else if (other.t > entry.t) {
      break;
    }
  }
  return best;
}

/**
 * Why a run happened, as far as the recording shows.
 *
 * @since 1.0.0
 */
export interface RunCauses {
  /** Writes since the computation last ran by a computation it was subscribed to: indexes of entries. */
  readonly writes: readonly number[];
  /** Runs of the nodes it read since it last ran, each of which changed: indexes of entries. */
  readonly via: readonly number[];
}

function previousRun(entries: readonly TimelineEntry[], index: number, comp: number): number {
  for (let i = index - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry?.k === "run" && entry.comp === comp) return i;
  }
  return -1;
}

/**
 * Finds what caused a run: the signal writes that named the computation as an observer since its previous run,
 * and the changed runs of the nodes it read in that time (a memo that recomputed). The attribution follows the
 * recorded order and the observer lists; it does not guess across a gap, so a cause that was overwritten out
 * of the buffer is not shown.
 *
 * @param data The recorded data.
 * @param index Index of a run entry.
 * @returns The causes, at most {@link MAX_RELATED} of each kind, nearest first.
 * @since 1.0.0
 */
export function causesOfRun(data: TimelineData, index: number): RunCauses {
  const run = data.entries[index];
  if (run?.k !== "run") return { writes: [], via: [] };
  const floor = previousRun(data.entries, index, run.comp);
  const writes: number[] = [];
  const via: number[] = [];
  const reads = new Set(run.sources);
  for (let i = index - 1; i > floor; i -= 1) {
    const entry = data.entries[i];
    if (entry === undefined) continue;
    if (entry.k === "write" && entry.observers.includes(run.comp) && writes.length < MAX_RELATED) {
      writes.push(i);
    } else if (
      entry.k === "run" &&
      entry.changed &&
      reads.has(entry.comp) &&
      via.length < MAX_RELATED
    ) {
      via.push(i);
    }
  }
  return { writes, via };
}

/**
 * Finds the runs a write set off: the first run of each subscribed computation after the write, and the runs
 * of computations that read one of those, up to the end of the flush that ran them (the next flush entry), or
 * {@link MAX_SCAN} entries.
 *
 * @param data The recorded data.
 * @param index Index of a write entry.
 * @returns Indexes of run entries, in time order, at most {@link MAX_RELATED}.
 * @since 1.0.0
 */
export function effectsOfWrite(data: TimelineData, index: number): readonly number[] {
  const write: TimelineEntry | undefined = data.entries[index];
  if (write?.k !== "write") return [];
  const pending = new Set(write.observers);
  const reached = new Set<number>();
  const out: number[] = [];
  const stop = Math.min(data.entries.length, index + 1 + MAX_SCAN);
  for (let i = index + 1; i < stop && out.length < MAX_RELATED; i += 1) {
    const entry = data.entries[i];
    if (entry === undefined || entry.k === "flush") break;
    if (entry.k !== "run") continue;
    const direct = pending.has(entry.comp);
    const downstream = !direct && entry.sources.some((source) => reached.has(source));
    if (direct || downstream) {
      pending.delete(entry.comp);
      reached.add(entry.comp);
      out.push(i);
    }
  }
  return out;
}

/**
 * Whether an entry is a run (a narrowing helper for callers).
 *
 * @param entry An entry.
 * @returns True for a run.
 * @since 1.0.0
 */
export function isRun(entry: TimelineEntry | undefined): entry is RunEntry {
  return entry?.k === "run";
}

/**
 * Whether an entry is a write (a narrowing helper for callers).
 *
 * @param entry An entry.
 * @returns True for a write.
 * @since 1.0.0
 */
export function isWrite(entry: TimelineEntry | undefined): entry is WriteEntry {
  return entry?.k === "write";
}
