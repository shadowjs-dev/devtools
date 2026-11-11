import { describe, expect, it, vi } from "vitest";
import { errorMessage, preview } from "../src/preview";

describe("[DVT-AUD-1] a preview costs what its limit costs, whatever the value", () => {
  it("[DVT-AUD-1.1] a huge string is cut before it is quoted, not after", () => {
    const real = JSON.stringify;
    const seen: number[] = [];
    const spy = vi.spyOn(JSON, "stringify").mockImplementation(((
      ...args: Parameters<typeof real>
    ) => {
      if (typeof args[0] === "string") seen.push(args[0].length);
      return real(...args);
    }) as typeof JSON.stringify);
    try {
      const text = preview("é".repeat(5_000_000), 80);
      expect(text.length).toBe(80);
      expect(text.startsWith('"éé')).toBe(true);
      expect(text.endsWith("…")).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(seen.length).toBeGreaterThan(0);
    expect(Math.max(...seen)).toBeLessThanOrEqual(1000);
  });

  it("[DVT-AUD-1.2] a short string keeps its exact quoting, escapes included", () => {
    expect(preview('a"b\nc', 80)).toBe(JSON.stringify('a"b\nc'));
    expect(preview("x".repeat(100), 10)).toBe(`${JSON.stringify("x".repeat(100)).slice(0, 9)}…`);
  });

  it("[DVT-AUD-1.3] a revoked proxy is described, not thrown at the application", () => {
    const { proxy, revoke } = Proxy.revocable({}, {});
    revoke();
    expect(() => preview(proxy)).not.toThrow();
    expect(() => errorMessage(proxy)).not.toThrow();
    expect(preview(proxy)).toBe("(unreadable)");
  });
});
