/**
 * A fixed-capacity ring buffer. `push` is O(1) and never allocates after construction; when full it
 * overwrites the oldest item, so memory stays bounded however many items are recorded. Items are kept
 * oldest first. Do not push `undefined`: `toArray` and the iterator skip such items, while `size` still
 * counts them.
 *
 * @typeParam T The item type.
 * @example
 * import { RingBuffer } from "@shadow-js/devtools";
 *
 * const ring = new RingBuffer<number>(3);
 * ring.push(1);
 * ring.push(2);
 * ring.push(3);
 * ring.push(4);
 * ring.toArray(); // [2, 3, 4]
 * @since 1.0.0
 */
export class RingBuffer<T> {
  /** Maximum number of items kept. Fixed at construction. */
  readonly capacity: number;
  private readonly slots: Array<T | undefined>;
  private head = 0;
  private count = 0;
  private overwritten = 0;

  /**
   * @param capacity Maximum number of items kept (a positive integer).
   * @throws {@link RangeError} When `capacity` is not a positive integer.
   */
  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError("RingBuffer capacity must be a positive integer");
    }
    this.capacity = capacity;
    this.slots = new Array<T | undefined>(capacity).fill(undefined);
  }

  /** Number of items currently held (at most `capacity`). */
  get size(): number {
    return this.count;
  }

  /** How many items were overwritten because the buffer was full. */
  get dropped(): number {
    return this.overwritten;
  }

  /** Adds an item, evicting the oldest when full. Returns the evicted item, if any. */
  push(item: T): T | undefined {
    const index = (this.head + this.count) % this.capacity;
    let evicted: T | undefined;
    if (this.count === this.capacity) {
      evicted = this.slots[this.head];
      this.slots[this.head] = item;
      this.head = (this.head + 1) % this.capacity;
      this.overwritten += 1;
    } else {
      this.slots[index] = item;
      this.count += 1;
    }
    return evicted;
  }

  /** The item `index` positions after the oldest one, or `undefined` out of range. */
  at(index: number): T | undefined {
    if (index < 0 || index >= this.count) return undefined;
    return this.slots[(this.head + index) % this.capacity];
  }

  /** The newest item, or `undefined` when empty. */
  last(): T | undefined {
    return this.count === 0 ? undefined : this.at(this.count - 1);
  }

  /** Items oldest first, as a new array. */
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i += 1) {
      const item = this.slots[(this.head + i) % this.capacity];
      if (item !== undefined) out.push(item);
    }
    return out;
  }

  /** Iterates oldest first without allocating an array. */
  *[Symbol.iterator](): IterableIterator<T> {
    for (let i = 0; i < this.count; i += 1) {
      const item = this.slots[(this.head + i) % this.capacity];
      if (item !== undefined) yield item;
    }
  }

  /** Removes every item (the `dropped` counter is kept). */
  clear(): void {
    this.slots.fill(undefined);
    this.head = 0;
    this.count = 0;
  }
}
