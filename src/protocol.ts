/**
 * The dev-hook protocol: how a ShadowJS runtime reports its reactive graph to developer tools.
 *
 * The runtime (core, web and query) calls `hook.report(kind, a, b, c, d, e)` for every event, in
 * development builds only (`if (__DEV__) { ... }`). The arguments are positional and the objects
 * are the runtime's own nodes: the hook never copies them, so reporting allocates nothing. An agent
 * (see {@link createAgent}) turns them into serializable, id-based {@link WireEvent}s.
 *
 * The protocol is versioned by {@link PROTOCOL_VERSION}. A runtime reports only to a hook whose
 * version it knows, and the agent ignores events with an unknown kind, so old runtimes and new
 * tools (and the other way round) degrade instead of breaking.
 *
 * @packageDocumentation
 */

import type { InspectionEntry, InspectionSource } from "./inspection";

/**
 * Protocol version carried by the hook (`hook.version`). Bump it when the meaning of an existing
 * event argument changes; adding event kinds does not require a bump.
 *
 * @example
 * import { getHook, PROTOCOL_VERSION } from "@shadow-js/devtools";
 *
 * const speaks = getHook()?.version === PROTOCOL_VERSION; // true when a matching hook is installed
 * @since 1.0.0
 */
export const PROTOCOL_VERSION = 1;

/**
 * Name of the global the runtime looks up: `globalThis.__SHADOWJS_DEVTOOLS_HOOK__`.
 *
 * @example
 * import { HOOK_KEY } from "@shadow-js/devtools";
 *
 * const installed: unknown = Reflect.get(globalThis, HOOK_KEY);
 * @since 1.0.0
 */
export const HOOK_KEY = "__SHADOWJS_DEVTOOLS_HOOK__";

/**
 * Event kinds of `hook.report(kind, ...)`, with the meaning of the arguments. An argument the table
 * leaves blank is not sent for that kind. `null` means "no node" (for example, a computation outside
 * any owner); `undefined` means "no name".
 *
 * | kind | a | b | c | d | e |
 * | --- | --- | --- | --- | --- | --- |
 * | `OWNER_CREATED` | owner | parent owner, or `null` for a root | `"root"` or `"owner"` | name, when known (the core runtime sends none) | |
 * | `OWNER_DISPOSED` | owner | | | | |
 * | `SIGNAL_CREATED` | signal | owner or `null` | name or `undefined` | initial value (shown as a preview) | |
 * | `SIGNAL_WRITTEN` | signal | next value | writing computation, or `null` | observers (array of computations), or `null` | |
 * | `COMPUTATION_CREATED` | computation | owner or `null` | `"memo"` or `"effect"` | name or `undefined` | render flag |
 * | `COMPUTATION_RUN` | computation | start time (ms) | duration (ms) | value changed | sources (array of the nodes it read) |
 * | `COMPUTATION_DISPOSED` | computation | | | | |
 * | `COMPONENT_MOUNTED` | owner of the component | name or `undefined` | what the component returned: a DOM node, an array of them, or another value | | |
 * | `COMPONENT_UNMOUNTED` | owner of the component | | | | |
 * | `RESOURCE_STATE` | resource handle | state (string) | name or `undefined` | owner or `null` | |
 * | `ERROR` | source owner or `null` | the thrown value | diagnostic code or `undefined` | | |
 * | `HYDRATION_MISMATCH` | message | expected side (text or node; the web runtime sends the element key) | actual side (text or node; the web runtime sends none) | | |
 * | `FLUSH_START` | render queue size | user queue size | | | |
 * | `FLUSH_END` | computations run in the flush | | | | |
 * | `STORE_CREATED` | store handle ({@link StoreHandle}) | owner or `null` | | | |
 * | `TRANSITION_START` | | | | | |
 * | `TRANSITION_END` | transitions resolved (count) | | | | |
 *
 * The agent ignores `TRANSITION_START` and `TRANSITION_END` today, and any other unknown kind.
 *
 * @example
 * import { EVENT } from "@shadow-js/devtools";
 *
 * const kind = EVENT.COMPUTATION_RUN; // 6: a = computation, b = start, c = duration, d = changed, e = sources
 * @since 1.0.0
 */
export const EVENT: {
  readonly OWNER_CREATED: 1;
  readonly OWNER_DISPOSED: 2;
  readonly SIGNAL_CREATED: 3;
  readonly SIGNAL_WRITTEN: 4;
  readonly COMPUTATION_CREATED: 5;
  readonly COMPUTATION_RUN: 6;
  readonly COMPUTATION_DISPOSED: 7;
  readonly COMPONENT_MOUNTED: 8;
  readonly COMPONENT_UNMOUNTED: 9;
  readonly RESOURCE_STATE: 10;
  readonly ERROR: 11;
  readonly HYDRATION_MISMATCH: 12;
  readonly FLUSH_START: 13;
  readonly FLUSH_END: 14;
  readonly STORE_CREATED: 15;
  readonly TRANSITION_START: 16;
  readonly TRANSITION_END: 17;
} = {
  OWNER_CREATED: 1,
  OWNER_DISPOSED: 2,
  SIGNAL_CREATED: 3,
  SIGNAL_WRITTEN: 4,
  COMPUTATION_CREATED: 5,
  COMPUTATION_RUN: 6,
  COMPUTATION_DISPOSED: 7,
  COMPONENT_MOUNTED: 8,
  COMPONENT_UNMOUNTED: 9,
  RESOURCE_STATE: 10,
  ERROR: 11,
  HYDRATION_MISMATCH: 12,
  FLUSH_START: 13,
  FLUSH_END: 14,
  STORE_CREATED: 15,
  TRANSITION_START: 16,
  TRANSITION_END: 17,
};

/**
 * One of the numeric event kinds.
 *
 * @since 1.0.0
 */
export type EventKind = (typeof EVENT)[keyof typeof EVENT];

/**
 * What a runtime passes with `STORE_CREATED`, so tools can show and edit a store without knowing its
 * implementation.
 *
 * @since 1.0.0
 */
export interface StoreHandle {
  /** Label shown in the store viewer. */
  readonly name: string;
  /** A plain copy of the current value (what `snapshot(store)` returns). */
  snapshot(): unknown;
  /** Writes `value` at `path` (property names and array indices) in one batched update. */
  set(path: readonly (string | number)[], value: unknown): void;
}

/**
 * The receiver side of the hook: an agent implements it to be told about events.
 *
 * @since 1.0.0
 */
export interface HookSink {
  /**
   * Called synchronously for every reported event, with the arguments of {@link EVENT}. Must be cheap
   * and must not throw; a throw is caught by the hook and counted as a fault.
   */
  receive(kind: number, a: unknown, b: unknown, c: unknown, d: unknown, e: unknown): void;
}

/**
 * Most rows one inspection source may return. The rest are cut and a final row says so, so a panel
 * never receives an unbounded list.
 *
 * @example
 * import { MAX_INSPECTION_ROWS } from "@shadow-js/devtools";
 * const cap: number = MAX_INSPECTION_ROWS; // 500
 * @since 1.0.0
 */
export const MAX_INSPECTION_ROWS = 500;

/**
 * Most sources an app may register with {@link registerInspection}. Registering one more is refused,
 * and the names already registered keep working.
 *
 * @example
 * import { MAX_INSPECTIONS } from "@shadow-js/devtools";
 * const cap: number = MAX_INSPECTIONS; // 16
 * @since 1.0.0
 */
export const MAX_INSPECTIONS = 16;

/**
 * The object installed at `globalThis.__SHADOWJS_DEVTOOLS_HOOK__` by `installHook`. A runtime calls
 * `report` on it; a tool attaches a {@link HookSink} to receive the events.
 *
 * @example
 * import { EVENT, getHook } from "@shadow-js/devtools";
 *
 * const hook = getHook();
 * hook?.report(EVENT.FLUSH_END, 0); // a flush that ran no computations
 * @since 1.0.0
 */
export interface DevtoolsHook {
  /** Protocol version; compare with {@link PROTOCOL_VERSION} before reporting. */
  readonly version: number;
  /** Runtime to tools. Positional arguments, see {@link EVENT}. Never throws. */
  report(kind: number, a?: unknown, b?: unknown, c?: unknown, d?: unknown, e?: unknown): void;
  /**
   * Registers a sink; returns the function that removes it. Events buffered before the first sink
   * attached (up to the buffer size given to `installHook`) are replayed to that first sink only.
   */
  attach(sink: HookSink): () => void;
  /** Number of attached sinks. */
  readonly sinks: number;
  /**
   * Registers an inspection source under `name`; re-registering a name replaces it. Returns false when
   * refused (the limit of {@link MAX_INSPECTIONS} is reached). Hooks of this package provide it; a
   * hook made by hand need not.
   */
  inspect?(name: string, source: InspectionSource): boolean;
  /** The registered inspection sources, in registration order. Hooks of this package provide it. */
  inspections?(): readonly InspectionEntry[];
}

/**
 * Events as they cross a process boundary: plain, JSON-safe objects that refer to nodes by id.
 * `seq` is a gapless counter; `t` is the time in milliseconds on the reporting clock.
 *
 * @since 1.0.0
 */
export type WireEvent =
  | {
      k: "owner+";
      seq: number;
      t: number;
      id: number;
      parent: number;
      label: string;
      name?: string;
    }
  | { k: "owner-"; seq: number; t: number; id: number }
  | {
      k: "signal+";
      seq: number;
      t: number;
      id: number;
      owner: number;
      name?: string;
      preview: string;
    }
  | {
      k: "write";
      seq: number;
      t: number;
      id: number;
      preview: string;
      writer: number;
      observers: number[];
    }
  | {
      k: "comp+";
      seq: number;
      t: number;
      id: number;
      owner: number;
      kind: "memo" | "effect";
      render: boolean;
      name?: string;
    }
  | {
      k: "run";
      seq: number;
      t: number;
      id: number;
      start: number;
      duration: number;
      changed: boolean;
      sources: number[];
    }
  | { k: "comp-"; seq: number; t: number; id: number }
  | { k: "mount"; seq: number; t: number; id: number; name: string }
  | { k: "unmount"; seq: number; t: number; id: number }
  | {
      k: "resource";
      seq: number;
      t: number;
      id: number;
      owner: number;
      state: string;
      name?: string;
    }
  | { k: "error"; seq: number; t: number; id: number; message: string; code?: string }
  | { k: "hydration"; seq: number; t: number; message: string; expected: string; actual: string }
  | { k: "flush+"; seq: number; t: number; render: number; user: number }
  | { k: "flush-"; seq: number; t: number; runs: number }
  | { k: "store+"; seq: number; t: number; id: number; owner: number; name: string };

/**
 * Discriminant of {@link WireEvent}.
 *
 * @since 1.0.0
 */
export type WireKind = WireEvent["k"];

/**
 * The sentinel used where a wire event refers to "no node". The agent assigns node ids from 1, so
 * `NO_ID` never names a node.
 *
 * @example
 * import { NO_ID } from "@shadow-js/devtools";
 *
 * const isRoot = (parent: number): boolean => parent === NO_ID;
 * @since 1.0.0
 */
export const NO_ID = 0;
