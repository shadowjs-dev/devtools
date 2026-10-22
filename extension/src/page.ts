import { createAgent } from "../../src/agent";
import { installHook } from "../../src/hook";
import type { InspectionSource } from "../../src/inspection";
import type { DevtoolsHook } from "../../src/protocol";
import {
  createWindowTransport,
  serveAgent,
  type WindowEvents,
  type WindowLike,
} from "../../src/transport";
import { inspectedPing } from "./bridge";

/**
 * A window the page hook can post to and listen on. The page's `window` fits this shape.
 *
 * @since 1.0.0
 */
export type PageHookWindow = WindowLike & WindowEvents;

/**
 * Calls `notify` when a registered inspection source reports a change, and keeps doing so for sources
 * registered later. The subscriptions are made on the hook's own registry, so a source that does not
 * subscribe is simply not watched. Stopping restores the hook's `inspect` and drops every subscription.
 *
 * @param hook The hook to watch (the one `installHook` returned).
 * @param notify Called for every change. It may be called several times for one change.
 * @returns The function that stops the watch.
 * @example
 * import { installHook } from "../../src/hook";
 * import { watchInspections } from "./page";
 *
 * const hook = installHook();
 * if (hook !== undefined) watchInspections(hook, () => console.info("sources changed"));
 * @since 1.0.0
 */
export function watchInspections(hook: DevtoolsHook, notify: () => void): () => void {
  const stops = new Map<string, () => void>();
  const original = hook.inspect;
  const attach = (name: string, source: InspectionSource): void => {
    stops.get(name)?.();
    stops.delete(name);
    const subscribe = source.subscribe;
    if (subscribe !== undefined) stops.set(name, subscribe.call(source, notify));
  };
  for (const entry of hook.inspections?.() ?? []) attach(entry.name, entry.source);
  hook.inspect = (name, source): boolean => {
    const registered = original?.call(hook, name, source) ?? false;
    if (registered) attach(name, source);
    return registered;
  };
  return () => {
    Reflect.set(hook, "inspect", original);
    for (const stop of stops.values()) stop();
    stops.clear();
  };
}

/**
 * The page side of the extension, run in the page's own (`MAIN`) world at `document_start`. It installs
 * the devtools hook, attaches an agent, and serves the agent over `window.postMessage` to the content
 * script, which relays it to the panel. Nothing else is exported to the page.
 *
 * Signal edits are not offered from the extension: writing a signal needs the app's own copy of the
 * runtime, and the extension cannot reach it safely. Store edits work, because a store handle is part of
 * the hook's event.
 *
 * @param options The window to serve and its origin.
 * @returns A function that stops serving, or `undefined` when no hook could be installed (a production
 *   build, or a hook of another protocol version).
 * @example
 * import { startPageAgent } from "./page";
 *
 * const stop = startPageAgent({ window, origin: location.origin });
 * @since 1.0.0
 */
export function startPageAgent(options: {
  /** The window to serve: the page's own window. */
  readonly window: PageHookWindow;
  /** The origin of that window. */
  readonly origin: string;
}): (() => void) | undefined {
  const hook = installHook();
  if (hook === undefined) return undefined;
  const agent = createAgent();
  agent.attach(hook);
  const transport = createWindowTransport({
    target: options.window,
    origin: options.origin,
    receiver: options.window,
  });
  const stopServing = serveAgent(agent, transport);
  // A burst of source changes becomes one ping, sent after the current task: the panel asks once.
  let scheduled = false;
  let stopped = false;
  const ping = (): void => {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!stopped) options.window.postMessage(inspectedPing(), options.origin);
    });
  };
  const stopWatching = watchInspections(hook, ping);
  return () => {
    stopped = true;
    stopWatching();
    stopServing();
  };
}
