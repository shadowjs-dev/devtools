import type { WireEvent } from "../../src/protocol";

/**
 * Builds synthetic wire-event streams with gapless sequence numbers and a controllable clock, so
 * model tests read like the scenario they describe.
 */
export class Stream {
  readonly events: WireEvent[] = [];
  seq = 0;
  t = 0;

  private next(): { seq: number; t: number } {
    this.seq += 1;
    return { seq: this.seq, t: this.t };
  }

  /** Moves the clock forward. */
  tick(ms = 1): this {
    this.t += ms;
    return this;
  }

  owner(id: number, parent = 0, label = "owner", name?: string): this {
    this.events.push({
      k: "owner+",
      ...this.next(),
      id,
      parent,
      label,
      ...(name === undefined ? {} : { name }),
    });
    return this;
  }

  disposeOwner(id: number): this {
    this.events.push({ k: "owner-", ...this.next(), id });
    return this;
  }

  signal(id: number, owner = 0, name?: string, preview = "0"): this {
    this.events.push({
      k: "signal+",
      ...this.next(),
      id,
      owner,
      preview,
      ...(name === undefined ? {} : { name }),
    });
    return this;
  }

  write(id: number, preview: string, writer = 0, observers: number[] = []): this {
    this.events.push({ k: "write", ...this.next(), id, preview, writer, observers });
    return this;
  }

  comp(id: number, owner: number, kind: "memo" | "effect", name?: string, render = false): this {
    this.events.push({
      k: "comp+",
      ...this.next(),
      id,
      owner,
      kind,
      render,
      ...(name === undefined ? {} : { name }),
    });
    return this;
  }

  run(
    id: number,
    sources: number[],
    options: { start?: number; duration?: number; changed?: boolean } = {},
  ): this {
    const start = options.start ?? this.t;
    this.events.push({
      k: "run",
      ...this.next(),
      id,
      start,
      duration: options.duration ?? 1,
      changed: options.changed ?? true,
      sources,
    });
    return this;
  }

  disposeComp(id: number): this {
    this.events.push({ k: "comp-", ...this.next(), id });
    return this;
  }

  mount(id: number, name: string): this {
    this.events.push({ k: "mount", ...this.next(), id, name });
    return this;
  }

  unmount(id: number): this {
    this.events.push({ k: "unmount", ...this.next(), id });
    return this;
  }

  flushStart(render = 0, user = 0): this {
    this.events.push({ k: "flush+", ...this.next(), render, user });
    return this;
  }

  flushEnd(runs = 0): this {
    this.events.push({ k: "flush-", ...this.next(), runs });
    return this;
  }

  error(id: number, message: string, code?: string): this {
    this.events.push({
      k: "error",
      ...this.next(),
      id,
      message,
      ...(code === undefined ? {} : { code }),
    });
    return this;
  }

  hydration(message: string, expected: string, actual: string): this {
    this.events.push({ k: "hydration", ...this.next(), message, expected, actual });
    return this;
  }

  resource(id: number, owner: number, state: string, name?: string): this {
    this.events.push({
      k: "resource",
      ...this.next(),
      id,
      owner,
      state,
      ...(name === undefined ? {} : { name }),
    });
    return this;
  }

  store(id: number, owner: number, name: string): this {
    this.events.push({ k: "store+", ...this.next(), id, owner, name });
    return this;
  }
}
