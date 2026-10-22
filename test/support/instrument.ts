import {
  type ComputationNode,
  createComputation,
  createOwner,
  createSignalNode,
  currentListener,
  currentOwner,
  disposeOwner,
  flushSync,
  type Owner,
  observersOf,
  readComputation,
  readSignal,
  refresh,
  runInScope,
  type SignalNode,
  writeSignal,
} from "@shadow-js/core/extend";
import { type DevtoolsHook, EVENT } from "../../src/protocol";

/** A signal created through the instrumented runtime. */
export interface TracedSignal<T> {
  node: SignalNode<T>;
  read(): T;
  write(next: T): boolean;
}

/** A memo created through the instrumented runtime. */
export interface TracedMemo<T> {
  node: ComputationNode;
  read(): T;
}

/** The test-only adapter's surface. */
export interface Instrumented {
  /** Creates an owner under `parent` (default: the current owner) and reports it. */
  owner(name: string, parent?: Owner | null): Owner;
  /** Creates an owner, runs `body` inside it and reports the component as mounted with `nodes`. */
  component<T>(name: string, body: () => T, nodes?: unknown): { owner: Owner; result: T };
  signal<T>(initial: T, name?: string): TracedSignal<T>;
  memo<T>(fn: () => T, name?: string, options?: { lazy?: boolean }): TracedMemo<T>;
  effect(fn: () => void, name?: string, options?: { render?: boolean }): ComputationNode;
  dispose(owner: Owner): void;
  /** Runs the queued effects, reporting a flush with the queue sizes. */
  flush(): void;
  /** What `writeSignal` does in the patched runtime: write, and report the write. */
  writeNode(node: SignalNode<unknown>, next: unknown): boolean;
  /** The logical clock used for run start times and durations (one tick per step). */
  clock: { now: number };
}

interface Frame {
  sources: Set<object>;
}

/**
 * A test-only runtime adapter. It builds a REAL reactive graph with the public `@shadow-js/core/extend`
 * API (`createSignalNode`, `createComputation`, `createOwner`, `writeSignal`, `readSignal`, ...) and
 * reports every step to the hook with the same arguments the proposed runtime patch would pass. The
 * graph is real, so tests can compare what the agent reconstructed with the engine's own edges.
 *
 * @param hook The hook to report to.
 */
export function instrument(hook: DevtoolsHook): Instrumented {
  const frames: Frame[] = [];
  const kinds = new WeakMap<object, "owner" | "memo" | "effect">();
  const renderEffects = new WeakSet<object>();
  /** Effects that a write has made stale since the last flush (found through `observersOf`). */
  const stale = new Set<ComputationNode>();
  const clock = { now: 0 };
  const tick = (): number => {
    clock.now += 1;
    return clock.now;
  };

  /** Marks every effect downstream of `source` stale, following the engine's observer lists. */
  const markStale = (source: SignalNode<unknown> | ComputationNode): void => {
    const stack: Array<SignalNode<unknown> | ComputationNode> = [source];
    const seen = new Set<object>();
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined || seen.has(next)) continue;
      seen.add(next);
      for (const observer of observersOf(next)) {
        if (kinds.get(observer) === "effect") stale.add(observer);
        else stack.push(observer);
      }
    }
  };

  const record = (source: object): void => {
    const frame = frames[frames.length - 1];
    if (frame !== undefined) frame.sources.add(source);
  };

  /** Reports the disposal of `owner` and everything below it, children first (the engine's order). */
  const reportDisposal = (owner: Owner): void => {
    const stack: Owner[] = [owner];
    const order: Owner[] = [];
    while (stack.length > 0) {
      const next = stack.pop();
      if (next === undefined) break;
      order.push(next);
      for (let child = next.lastChild; child !== null; child = child.prevSibling) stack.push(child);
    }
    for (let i = order.length - 1; i >= 0; i -= 1) {
      const node = order[i];
      if (node === undefined) continue;
      const kind = kinds.get(node);
      if (kind === "owner" || kind === undefined) hook.report(EVENT.OWNER_DISPOSED, node);
      else {
        stale.delete(node as ComputationNode);
        hook.report(EVENT.COMPUTATION_DISPOSED, node);
      }
    }
  };

  const computation = (
    kind: "memo" | "effect",
    fn: () => unknown,
    name: string | undefined,
    render: boolean,
    lazy: boolean,
  ): ComputationNode => {
    let announced = false;
    const owner = currentOwner();
    /** The patched runtime reports creation from the constructor, before the first run. */
    const announce = (self: ComputationNode): void => {
      if (announced) return;
      announced = true;
      kinds.set(self, kind);
      if (render) renderEffects.add(self);
      hook.report(EVENT.COMPUTATION_CREATED, self, owner, kind, name, render);
    };
    const node = createComputation({
      kind,
      render,
      equals: Object.is,
      // Memos are created lazily so the creation can be reported before their first run.
      ...(kind === "memo" ? { lazy: true } : {}),
      ...(name === undefined ? {} : { name }),
      fn: () => {
        const self = currentListener();
        if (self !== null) announce(self);
        const frame: Frame = { sources: new Set() };
        frames.push(frame);
        const start = tick();
        let result: unknown;
        try {
          result = fn();
        } finally {
          frames.pop();
        }
        const duration = tick() - start;
        if (self !== null) {
          const changed = kind === "effect" || !Object.is(self.value, result);
          hook.report(EVENT.COMPUTATION_RUN, self, start, duration, changed, [...frame.sources]);
        }
        return result;
      },
    });
    announce(node);
    if (kind === "memo" && !lazy) refresh(node);
    return node;
  };

  const writeNode = (node: SignalNode<unknown>, next: unknown): boolean => {
    const changed = writeSignal(node, next);
    if (changed) {
      markStale(node);
      const observers = node.observers === null ? null : [...node.observers];
      hook.report(EVENT.SIGNAL_WRITTEN, node, next, currentListener(), observers);
    }
    return changed;
  };

  return {
    clock,
    writeNode,
    owner(name, parent) {
      const owner = createOwner(parent);
      kinds.set(owner, "owner");
      hook.report(
        EVENT.OWNER_CREATED,
        owner,
        owner.parent,
        parent === undefined && owner.parent === null ? "root" : "owner",
        name,
      );
      return owner;
    },
    component(name, body, nodes) {
      const owner = createOwner();
      kinds.set(owner, "owner");
      hook.report(EVENT.OWNER_CREATED, owner, owner.parent, "owner", name);
      const result = runInScope({ owner, listener: null }, body);
      hook.report(EVENT.COMPONENT_MOUNTED, owner, name, nodes ?? null);
      return { owner, result };
    },
    signal(initial, name) {
      const node = createSignalNode<typeof initial>(initial, Object.is, name);
      hook.report(EVENT.SIGNAL_CREATED, node, currentOwner(), name, initial);
      return {
        node,
        read: () => {
          record(node);
          return readSignal(node);
        },
        write: (next) => writeNode(node as SignalNode<unknown>, next),
      };
    },
    memo(fn, name, options) {
      const node = computation("memo", fn, name, false, options?.lazy === true);
      return {
        node,
        read: () => {
          record(node);
          return readComputation(node);
        },
      };
    },
    effect(fn, name, options) {
      return computation("effect", fn, name, options?.render === true, false);
    },
    dispose(owner) {
      reportDisposal(owner);
      disposeOwner(owner);
    },
    flush() {
      let render = 0;
      let user = 0;
      for (const effect of stale) {
        if (renderEffects.has(effect)) render += 1;
        else user += 1;
      }
      stale.clear();
      hook.report(EVENT.FLUSH_START, render, user);
      flushSync();
      hook.report(EVENT.FLUSH_END, render + user);
    },
  };
}
