import type { InspectionEntry, InspectionSource } from "./inspection";
import {
  type DevtoolsHook,
  HOOK_KEY,
  type HookSink,
  MAX_INSPECTIONS,
  PROTOCOL_VERSION,
} from "./protocol";

/**
 * Options of {@link installHook}. Every field is optional.
 *
 * @since 1.0.0
 */
export interface InstallHookOptions {
  /**
   * The object to install the hook on.
   *
   * @default globalThis
   */
  target?: object;
  /**
   * How many events to keep for a sink that attaches later. The first events reported are kept and
   * later ones are dropped. The buffer is released when the first sink attaches, so a hook that nobody
   * listens to cannot grow without bound.
   *
   * @default 5000
   */
  buffer?: number;
}

/**
 * The hook that {@link installHook} installs: a {@link DevtoolsHook} with the counters of its sinks.
 *
 * @since 1.0.0
 */
export interface InstalledHook extends DevtoolsHook {
  /** Number of times a sink threw while receiving an event. The hook swallows each error so the app keeps running. */
  readonly faults: number;
  /** The last error a sink threw, or `undefined` when none did. */
  readonly lastFault: unknown;
}

type Buffered = readonly [number, unknown, unknown, unknown, unknown, unknown];

function lookup(target: object): unknown {
  return Reflect.get(target, HOOK_KEY);
}

function isHook(value: unknown): value is InstalledHook {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "report") === "function" &&
    typeof Reflect.get(value, "attach") === "function" &&
    typeof Reflect.get(value, "version") === "number"
  );
}

/**
 * Installs the dev hook on `globalThis.__SHADOWJS_DEVTOOLS_HOOK__` (or on `options.target`), once, and
 * returns it. A development tool: in production builds (`__DEV__` false) it installs nothing and returns
 * `undefined`. The runtime looks the global up on each event, so call this before the application code
 * runs: events reported earlier are lost, and those reported before a sink attaches are buffered.
 *
 * When a hook with the same protocol version is already installed, it is returned. When the global holds
 * a hook of another version (or anything that is not a hook), nothing is installed and `undefined` is
 * returned.
 *
 * @param options Target object and replay buffer size. Every field is optional.
 * @returns The installed hook, or `undefined`.
 * @example
 * import { createAgent, installHook } from "@shadow-js/devtools";
 *
 * const hook = installHook();
 * const agent = createAgent();
 * if (hook !== undefined) agent.attach(hook);
 * @since 1.0.0
 */
export function installHook(options: InstallHookOptions = {}): InstalledHook | undefined {
  if (!__DEV__) return undefined;
  const target = options.target ?? globalThis;
  const existing = lookup(target);
  if (existing !== undefined) {
    return isHook(existing) && existing.version === PROTOCOL_VERSION ? existing : undefined;
  }
  const limit = options.buffer ?? 5000;
  const sinks: HookSink[] = [];
  const registry = new Map<string, InspectionSource>();
  let buffer: Buffered[] | null = [];
  let faults = 0;
  let lastFault: unknown;

  const deliver = (
    sink: HookSink,
    kind: number,
    a: unknown,
    b: unknown,
    c: unknown,
    d: unknown,
    e: unknown,
  ): void => {
    try {
      sink.receive(kind, a, b, c, d, e);
    } catch (error) {
      // A broken tool must never break the application: count the fault and keep the error.
      faults += 1;
      lastFault = error;
    }
  };

  const hook: InstalledHook = {
    version: PROTOCOL_VERSION,
    get sinks(): number {
      return sinks.length;
    },
    get faults(): number {
      return faults;
    },
    get lastFault(): unknown {
      return lastFault;
    },
    report(kind, a, b, c, d, e): void {
      if (sinks.length === 0) {
        if (buffer !== null && buffer.length < limit) buffer.push([kind, a, b, c, d, e]);
        return;
      }
      for (let i = 0; i < sinks.length; i += 1) {
        const sink = sinks[i];
        if (sink !== undefined) deliver(sink, kind, a, b, c, d, e);
      }
    },
    inspect(name, source): boolean {
      if (!registry.has(name) && registry.size >= MAX_INSPECTIONS) return false;
      registry.set(name, source);
      return true;
    },
    inspections(): readonly InspectionEntry[] {
      return [...registry].map(([name, source]) => ({ name, source }));
    },
    attach(sink): () => void {
      sinks.push(sink);
      if (buffer !== null) {
        const replay = buffer;
        buffer = null;
        for (const entry of replay)
          deliver(sink, entry[0], entry[1], entry[2], entry[3], entry[4], entry[5]);
      }
      return () => {
        const index = sinks.indexOf(sink);
        if (index !== -1) sinks.splice(index, 1);
      };
    },
  };
  Reflect.set(target, HOOK_KEY, hook);
  return hook;
}

/**
 * The hook that {@link installHook} installed, or `undefined` when none is installed or its protocol
 * version differs. A development tool: production builds never install a hook.
 *
 * @param target Object to look at (default `globalThis`).
 * @returns The installed hook, or `undefined`.
 * @example
 * import { getHook } from "@shadow-js/devtools";
 *
 * const sinks = getHook()?.sinks ?? 0;
 * @since 1.0.0
 */
export function getHook(target: object = globalThis): InstalledHook | undefined {
  const existing = lookup(target);
  return isHook(existing) && existing.version === PROTOCOL_VERSION ? existing : undefined;
}

/**
 * Removes the installed hook, so that a later {@link installHook} installs a new one. For tests and for
 * hot reloading the tools; a development tool, and a no-op in production builds. Sinks stay attached to
 * the old hook object.
 *
 * @param target Object to remove it from (default `globalThis`).
 * @example
 * import { uninstallHook } from "@shadow-js/devtools";
 *
 * uninstallHook();
 * @since 1.0.0
 */
export function uninstallHook(target: object = globalThis): void {
  Reflect.deleteProperty(target, HOOK_KEY);
}
