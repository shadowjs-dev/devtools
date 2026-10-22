import { getHook } from "./hook";
import { errorMessage, preview } from "./preview";
import { MAX_INSPECTION_ROWS, MAX_INSPECTIONS } from "./protocol";

/** Longest text of one row field, in characters. Longer text is cut with an ellipsis. */
const FIELD_LENGTH = 200;

/**
 * One line of an inspection view. Every field is text, so a row is plain data and can cross a
 * message channel unchanged.
 *
 * @since 1.0.0
 */
export interface InspectionRow {
  /** Stable within the source (a query hash, a route match index, or a fixed name). */
  readonly id: string;
  /** What the row is about: a query key, a route pattern, or a fixed label such as `location`. */
  readonly label: string;
  /** The details, as one line of text. */
  readonly detail: string;
  /** A short state word for the row, such as `success`, `fetching` or `idle`. */
  readonly state: string;
}

/**
 * Something that can describe itself to a devtools panel: a router, a query cache, or any other part of
 * the app. `rows()` is called when the panel asks, so it reports the current state, not a copy taken
 * earlier. It may throw; the agent reports the error to the panel instead of failing the request.
 *
 * @example
 * import { type InspectionSource, registerInspection } from "@shadow-js/devtools";
 *
 * const source: InspectionSource = {
 *   title: "Feature flags",
 *   rows: () => [{ id: "beta", label: "beta", detail: "on", state: "on" }],
 * };
 * registerInspection("flags", source);
 * @since 1.0.0
 */
export interface InspectionSource {
  /** The heading of the view, for example `Router`. */
  readonly title: string;
  /** The rows now. At most {@link MAX_INSPECTION_ROWS} are sent. */
  rows(): readonly InspectionRow[];
  /**
   * Optional. Calls `notify` whenever the rows may have changed, and returns the function that stops the
   * calls. The extension's page side listens to it, so the panel refreshes at the moment of the change
   * instead of on a timer. A source without it is read when the panel asks.
   */
  subscribe?(notify: () => void): () => void;
}

/**
 * A registered source with its name (the key the app registered it under).
 *
 * @since 1.0.0
 */
export interface InspectionEntry {
  /** The name the source was registered under. Unique per hook. */
  readonly name: string;
  /** The source. */
  readonly source: InspectionSource;
}

/**
 * What the agent answers to an `inspect` request: every registered source, read now. A source that
 * threw has no rows and an `error` message instead.
 *
 * @since 1.0.0
 */
export interface InspectionSnapshot {
  /** The registration name. */
  readonly name: string;
  /** The heading of the view. */
  readonly title: string;
  /** The rows (at most {@link MAX_INSPECTION_ROWS}). */
  readonly rows: readonly InspectionRow[];
  /** Why the rows could not be read, or `undefined` when they were. */
  readonly error?: string;
}

/**
 * The part of a router the router inspection reads. A `Router` from `@shadow-js/router` fits this
 * shape; it is structural, so devtools does not depend on the router package.
 *
 * @since 1.0.0
 */
export interface RouterLike {
  /** The router's live state (accessors). */
  readonly state: {
    location():
      | { readonly pathname: string; readonly search: string; readonly hash: string }
      | undefined;
    status(): string;
    pending(): boolean;
    error(): unknown;
    matches(): readonly {
      readonly id: string;
      readonly pattern: string;
      readonly params: Readonly<Record<string, string>>;
    }[];
  };
}

/**
 * One query as the query cache reports it (a `QueryInfo` snapshot of `@shadow-js/query`).
 *
 * @since 1.0.0
 */
export interface QueryInfoLike {
  /** The key of the query (plain data). */
  readonly queryKey: unknown;
  /** The hash of the key, which identifies the cache entry. */
  readonly queryHash: string;
  /** `pending`, `success` or `error`. */
  readonly status: string;
  /** `idle`, `fetching` or `paused`. */
  readonly fetchStatus: string;
  /** Time (ms since epoch) of the last successful fetch or write; `0` when there was none. */
  readonly dataUpdatedAt: number;
  /** True after an invalidation, until the next successful fetch or write. */
  readonly isInvalidated: boolean;
  /** Mounted observers of the query. */
  readonly observers: number;
}

/**
 * The part of a query client the query inspection reads: its cache, as snapshots. A `QueryClient` from
 * `@shadow-js/query` fits this shape.
 *
 * @since 1.0.0
 */
export interface QueryLike {
  /** The query cache, read through its snapshots, and told about its changes. */
  readonly queryCache: {
    /** Every query, as snapshots. Untracked. */
    find(): readonly QueryInfoLike[];
    /** Calls `listener` for every change of the cache; returns the function that stops it. */
    subscribe(listener: () => void): () => void;
  };
}

/**
 * The JSON text of plain data (query keys and route params are plain data), cut to the field length.
 * Falls back to {@link preview} when the value does not serialize (a cycle, a bigint).
 *
 * @param value The value.
 * @returns One line of text.
 */
function jsonText(value: unknown): string {
  try {
    const text = JSON.stringify(value);
    return text === undefined ? preview(value, FIELD_LENGTH) : clip(text);
  } catch {
    return preview(value, FIELD_LENGTH);
  }
}

/**
 * Cuts text to the row field length, with an ellipsis when it was longer.
 *
 * @param text The text.
 * @returns The text, at most {@link FIELD_LENGTH} characters.
 */
function clip(text: string): string {
  return text.length > FIELD_LENGTH ? `${text.slice(0, FIELD_LENGTH - 1)}…` : text;
}

/**
 * Turns a source's rows into plain rows, cut to the row limit. Each field is coerced to text and cut,
 * so a source cannot send an object, a function or an unbounded string to the panel.
 *
 * @param rows The rows a source returned.
 * @returns At most {@link MAX_INSPECTION_ROWS} plain rows, and a last row that says how many were cut.
 * @example
 * import { type InspectionRow, sanitizeRows } from "@shadow-js/devtools";
 *
 * const rows: InspectionRow[] = [{ id: "a", label: "a", detail: "b", state: "c" }];
 * sanitizeRows(rows); // one plain row
 * @since 1.0.0
 */
export function sanitizeRows(rows: readonly InspectionRow[]): InspectionRow[] {
  const out: InspectionRow[] = [];
  const limit = Math.min(rows.length, MAX_INSPECTION_ROWS);
  for (let index = 0; index < limit; index += 1) {
    const row = rows[index];
    if (row === undefined) continue;
    out.push({
      id: clip(String(row.id)),
      label: clip(String(row.label)),
      detail: clip(String(row.detail)),
      state: clip(String(row.state)),
    });
  }
  if (rows.length > MAX_INSPECTION_ROWS) {
    out.push({
      id: "truncated",
      label: "…",
      detail: `${rows.length - MAX_INSPECTION_ROWS} more rows not shown`,
      state: "truncated",
    });
  }
  return out;
}

/**
 * Describes a router: its location, whether a navigation is pending, the error it last reported, and
 * the chain of matched routes. The source reads the router when the panel asks.
 *
 * @param router The router (`createRouter` from `@shadow-js/router`).
 * @param title The heading of the view. Default `Router`.
 * @returns An {@link InspectionSource}.
 * @example
 * import { type RouterLike, registerInspection, routerInspection } from "@shadow-js/devtools";
 *
 * declare const router: RouterLike; // the router from your app's createRouter()
 * registerInspection("router", routerInspection(router));
 * @since 1.0.0
 */
export function routerInspection(router: RouterLike, title = "Router"): InspectionSource {
  return {
    title,
    rows() {
      const rows: InspectionRow[] = [];
      const location = router.state.location();
      const status = router.state.status();
      rows.push({
        id: "location",
        label: "location",
        detail:
          location === undefined
            ? "none"
            : `${location.pathname}${location.search}${location.hash}`,
        state: status,
      });
      rows.push({
        id: "pending",
        label: "pending",
        detail: String(router.state.pending()),
        state: router.state.pending() ? "pending" : "settled",
      });
      const error = router.state.error();
      if (error !== undefined) {
        rows.push({ id: "error", label: "error", detail: errorMessage(error), state: "errored" });
      }
      router.state.matches().forEach((match, index) => {
        rows.push({
          id: `match:${index}`,
          label: match.pattern,
          detail: jsonText(match.params),
          state: match.id,
        });
      });
      return rows;
    },
  };
}

/**
 * Describes a query cache: one row per query, with its key, fetch state, observers and age. The
 * source reads the cache when the panel asks, and it subscribes to the cache so that a change is
 * pushed to a connected panel as soon as it happens. A client without the `inspection` feature of
 * `@shadow-js/query` cannot notify, so the panel then reads the cache only when it asks.
 *
 * @param client The query client (`createQueryClient` from `@shadow-js/query`, created with
 *   `features: [inspection]` for live updates), or anything with the same `queryCache.find()`.
 * @param title The heading of the view. Default `Queries`.
 * @returns An {@link InspectionSource}.
 * @example
 * import { type QueryLike, queryInspection, registerInspection } from "@shadow-js/devtools";
 *
 * declare const client: QueryLike; // the query client of your app
 * registerInspection("query", queryInspection(client));
 * @since 1.0.0
 */
export function queryInspection(client: QueryLike, title = "Queries"): InspectionSource {
  return {
    title,
    subscribe(notify) {
      try {
        return client.queryCache.subscribe(() => notify());
      } catch (error) {
        // Only the missing `inspection` feature is expected here (a TypeError); anything else is a bug.
        if (error instanceof TypeError) return () => undefined;
        throw error;
      }
    },
    rows() {
      return client.queryCache.find().map((query) => {
        const flags: string[] = [query.fetchStatus, `${query.observers} observers`];
        if (query.isInvalidated) flags.push("invalidated");
        flags.push(
          query.dataUpdatedAt > 0
            ? `updated ${new Date(query.dataUpdatedAt).toISOString()}`
            : "never updated",
        );
        return {
          id: query.queryHash,
          label: jsonText(query.queryKey),
          detail: flags.join(", "),
          state: query.status,
        };
      });
    },
  };
}

/**
 * Registers an inspection source on the installed devtools hook, under `name`, so a panel can show it
 * (see the `inspect` request of {@link createAgent}). Re-registering a name replaces its source. Returns
 * `false` when nothing was registered: no hook is installed (no development build, or the hook of
 * another protocol version), the name is empty, or {@link MAX_INSPECTIONS} sources are already
 * registered under other names. A development tool; production builds register nothing.
 *
 * @param name The name to show the source under. Not empty.
 * @param source The source.
 * @returns True when the source is registered.
 * @example
 * import { type RouterLike, registerInspection, routerInspection } from "@shadow-js/devtools";
 *
 * declare const router: RouterLike; // the router from your app's createRouter()
 * registerInspection("router", routerInspection(router));
 * @since 1.0.0
 */
export function registerInspection(name: string, source: InspectionSource): boolean {
  if (!__DEV__) return false;
  if (name === "") return false;
  const hook = getHook();
  if (hook === undefined || hook.inspect === undefined) return false;
  return hook.inspect(name, source);
}

/**
 * Reads every registered source, now, as plain snapshots. A source that throws is reported with its
 * `error` and no rows. Used by the agent for the `inspect` request.
 *
 * @param entries The registered entries (the hook's `inspections()`).
 * @returns One snapshot per entry, in registration order.
 * @example
 * import { readInspections } from "@shadow-js/devtools";
 *
 * const snapshots = readInspections([]); // []
 * @since 1.0.0
 */
export function readInspections(entries: readonly InspectionEntry[]): InspectionSnapshot[] {
  return entries.map((entry) => {
    try {
      return {
        name: entry.name,
        title: clip(String(entry.source.title)),
        rows: sanitizeRows(entry.source.rows()),
      };
    } catch (error) {
      return {
        name: entry.name,
        title: clip(String(entry.source.title)),
        rows: [],
        error: errorMessage(error),
      };
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRow(value: unknown): value is InspectionRow {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["label"] === "string" &&
    typeof value["detail"] === "string" &&
    typeof value["state"] === "string"
  );
}

/**
 * Reads the answer of an `inspect` request. The panel gets it from the page, so it checks the shape
 * and the bounds before it trusts anything: every field is text, there are at most
 * {@link MAX_INSPECTIONS} sources and at most {@link MAX_INSPECTION_ROWS} + 1 rows each.
 *
 * @param value The `result` of an ok `inspect` response.
 * @returns The snapshots, or `null` when the value is not an answer to `inspect`.
 * @example
 * import { parseInspectResult } from "@shadow-js/devtools";
 *
 * parseInspectResult({ sources: [] }); // []
 * parseInspectResult({ nope: true }); // null
 * @since 1.0.0
 */
export function parseInspectResult(value: unknown): InspectionSnapshot[] | null {
  if (!isRecord(value) || !Array.isArray(value["sources"])) return null;
  const sources: unknown[] = value["sources"];
  if (sources.length > MAX_INSPECTIONS) return null;
  const out: InspectionSnapshot[] = [];
  for (const entry of sources) {
    if (!isRecord(entry)) return null;
    const name = entry["name"];
    const title = entry["title"];
    const rows = entry["rows"];
    const error = entry["error"];
    if (typeof name !== "string" || typeof title !== "string" || !Array.isArray(rows)) return null;
    if (rows.length > MAX_INSPECTION_ROWS + 1 || !rows.every(isRow)) return null;
    if (error !== undefined && typeof error !== "string") return null;
    out.push(error === undefined ? { name, title, rows } : { name, title, rows, error });
  }
  return out;
}
