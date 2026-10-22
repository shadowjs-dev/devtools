import { describe, expect, it } from "vitest";
import { RingBuffer } from "../src/ring";

describe("[DVT-01] RingBuffer is bounded and O(1)", () => {
  it("[DVT-01.1] keeps the newest items and reports how many were overwritten", () => {
    const ring = new RingBuffer<number>(3);
    for (let i = 1; i <= 5; i += 1) ring.push(i);
    expect(ring.toArray()).toEqual([3, 4, 5]);
    expect(ring.size).toBe(3);
    expect(ring.dropped).toBe(2);
    expect(ring.last()).toBe(5);
  });

  it("[DVT-01.2] push returns the evicted item once full", () => {
    const ring = new RingBuffer<string>(2);
    expect(ring.push("a")).toBeUndefined();
    expect(ring.push("b")).toBeUndefined();
    expect(ring.push("c")).toBe("a");
  });

  it("[DVT-01.3] at() indexes from the oldest and rejects out of range", () => {
    const ring = new RingBuffer<number>(3);
    ring.push(1);
    ring.push(2);
    expect([ring.at(0), ring.at(1), ring.at(2), ring.at(-1)]).toEqual([1, 2, undefined, undefined]);
  });

  it("[DVT-01.4] iterates oldest first and clear empties it", () => {
    const ring = new RingBuffer<number>(2);
    for (const n of [1, 2, 3]) ring.push(n);
    expect([...ring]).toEqual([2, 3]);
    ring.clear();
    expect(ring.size).toBe(0);
    expect(ring.toArray()).toEqual([]);
    expect(ring.dropped).toBe(1);
    ring.push(9);
    expect(ring.toArray()).toEqual([9]);
  });

  it("[DVT-01.5] rejects invalid capacities", () => {
    expect(() => new RingBuffer(0)).toThrow(RangeError);
    expect(() => new RingBuffer(1.5)).toThrow(RangeError);
  });

  it("[DVT-01.6] memory stays bounded for a million pushes", () => {
    const ring = new RingBuffer<number>(100);
    for (let i = 0; i < 1_000_000; i += 1) ring.push(i);
    expect(ring.size).toBe(100);
    expect(ring.at(0)).toBe(999_900);
    expect(ring.dropped).toBe(999_900);
  });
});
