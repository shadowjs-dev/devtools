import { describe, expect, it } from "vitest";
import { errorMessage, parseEditableText, preview, toEditableText } from "../src/preview";

describe("[DVT-17] value previews are short and never walk the value", () => {
  it("[DVT-17.1] primitives", () => {
    expect([0, -1.5, true, undefined, null, 10n, "hi"].map((value) => preview(value))).toEqual([
      "0",
      "-1.5",
      "true",
      "undefined",
      "null",
      "10n",
      '"hi"',
    ]);
    expect(preview(Symbol("tag"))).toBe("Symbol(tag)");
    expect(preview(() => 1)).toBe("ƒ()");
  });

  it("[DVT-17.2] collections and objects show kind and size only", () => {
    expect(preview([1, 2, 3])).toBe("Array(3)");
    expect(preview(new Map([[1, 2]]))).toBe("Map(1)");
    expect(preview(new Set([1, 2]))).toBe("Set(2)");
    expect(preview({ a: 1 })).toBe("{…}");
    expect(preview(Object.create(null))).toBe("{…}");
    class Point {
      x = 1;
    }
    expect(preview(new Point())).toBe("Point {…}");
    expect(preview(new Date(0))).toBe("1970-01-01T00:00:00.000Z");
    expect(preview(new Date(Number.NaN))).toBe("Invalid Date");
    expect(preview(new RangeError("bad"))).toBe("RangeError: bad");
  });

  it("[DVT-17.3] a throwing getter or a proxy trap is never touched", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("trap");
        },
        ownKeys() {
          throw new Error("trap");
        },
      },
    );
    expect(() => preview(hostile)).not.toThrow();
    const getter = {
      get boom(): number {
        throw new Error("getter");
      },
    };
    expect(preview(getter)).toBe("{…}");
  });

  it("[DVT-17.4] long text is cut to the limit", () => {
    expect(preview("x".repeat(500), 20)).toHaveLength(20);
    expect(preview("x".repeat(500), 20).endsWith("…")).toBe(true);
    expect(preview("short", 20)).toBe('"short"');
  });

  it("[DVT-17.5] error messages are bounded", () => {
    expect(errorMessage(new TypeError("bad"))).toBe("TypeError: bad");
    expect(errorMessage("plain")).toBe('"plain"');
    expect(errorMessage(new Error("e".repeat(1000)), 50)).toHaveLength(50);
  });
});

describe("[DVT-17] the value editor's text", () => {
  it("[DVT-17.6] round-trips JSON", () => {
    const value = { a: [1, "two", null], b: { c: true } };
    expect(parseEditableText(toEditableText(value))).toEqual({ ok: true, value });
    expect(toEditableText(5)).toBe("5");
    expect(toEditableText("text")).toBe('"text"');
  });

  it("[DVT-17.7] undefined is spelled out and parsed back", () => {
    expect(toEditableText(undefined)).toBe("undefined");
    expect(parseEditableText(" undefined ")).toEqual({ ok: true, value: undefined });
  });

  it("[DVT-17.8] values JSON cannot hold are described, not thrown", () => {
    const loop: Record<string, unknown> = {};
    loop["self"] = loop;
    expect(toEditableText(loop)).toContain("not JSON");
    expect(toEditableText(10n)).toContain("not JSON");
    expect(toEditableText(() => 1)).toBe("ƒ()");
  });

  it("[DVT-17.9] bad input is an error with a message", () => {
    const parsed = parseEditableText("{oops");
    expect(parsed.ok).toBe(false);
    expect(parsed.ok ? "" : parsed.error.length).toBeGreaterThan(0);
  });
});
