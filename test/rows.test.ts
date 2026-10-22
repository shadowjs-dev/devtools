import { describe, expect, it } from "vitest";
import { snapshotOf } from "../src/inspector";
import { foldEvents } from "../src/model";
import { buildRows } from "../src/ui/rows";
import { Stream } from "./support/stream";

function app() {
  return new Stream()
    .owner(1, 0, "root", "App")
    .mount(1, "App")
    .owner(2, 1, "owner")
    .mount(2, "List")
    .signal(3, 2, "items", "Array(2)")
    .comp(4, 2, "effect", "render")
    .run(4, [3])
    .run(4, [3])
    .owner(5, 1, "owner")
    .mount(5, "Footer")
    .signal(6, 5, "year", "2026");
}

const snapshot = () => snapshotOf(foldEvents(app().events));
const all = { filter: "", componentsOnly: false, collapsed: new Set<number>() };

describe("[DVT-10] tree rows", () => {
  it("[DVT-10.1] flattens depth first in creation order with labels and details", () => {
    const { rows, hidden } = buildRows(snapshot(), all);
    expect(hidden).toBe(0);
    expect(rows.map((row) => `${"  ".repeat(row.depth)}${row.label}`)).toEqual([
      "<App>",
      "  <List>",
      "    items",
      "    render",
      "  <Footer>",
      "    year",
    ]);
    expect(rows.find((row) => row.label === "items")?.detail).toBe("Array(2)");
    expect(rows.find((row) => row.label === "render")?.detail).toBe("2 runs");
  });

  it("[DVT-10.2] rolls re-runs up to every owning component", () => {
    const { rows } = buildRows(snapshot(), all);
    const updates = Object.fromEntries(rows.map((row) => [row.label, row.updates]));
    expect(updates).toMatchObject({ "<App>": 1, "<List>": 1, render: 1, "<Footer>": 0 });
  });

  it("[DVT-10.3] collapsed nodes hide their subtree but still say they have children", () => {
    const { rows } = buildRows(snapshot(), { ...all, collapsed: new Set([2]) });
    expect(rows.map((row) => row.label)).toEqual(["<App>", "<List>", "<Footer>", "year"]);
    expect(rows[1]).toMatchObject({ hasChildren: true, collapsed: true });
  });

  it("[DVT-10.4] the filter shows matches with their ancestors and ignores collapse state", () => {
    const { rows } = buildRows(snapshot(), { ...all, filter: "YEAR", collapsed: new Set([1]) });
    expect(rows.map((row) => row.label)).toEqual(["<App>", "<Footer>", "year"]);
    expect(
      buildRows(snapshot(), { ...all, filter: "2026" }).rows.map((row) => row.label),
    ).toContain("year");
    expect(buildRows(snapshot(), { ...all, filter: "nothing" }).rows).toEqual([]);
  });

  it("[DVT-10.5] components-only attaches children to the nearest shown ancestor", () => {
    const { rows } = buildRows(snapshot(), { ...all, componentsOnly: true });
    expect(rows.map((row) => [row.label, row.depth])).toEqual([
      ["<App>", 0],
      ["<List>", 1],
      ["<Footer>", 1],
    ]);
  });

  it("[DVT-10.6] the row limit cuts the list and counts what was hidden", () => {
    const { rows, hidden } = buildRows(snapshot(), { ...all, limit: 4 });
    expect(rows).toHaveLength(4);
    expect(hidden).toBe(2);
  });

  it("[DVT-10.7] a 50 000 node tree is flattened without recursion", () => {
    const stream = new Stream();
    for (let id = 1; id <= 50_000; id += 1) stream.owner(id, id - 1);
    const { rows, hidden } = buildRows(snapshotOf(foldEvents(stream.events)), {
      ...all,
      limit: 100_000,
    });
    expect(rows).toHaveLength(50_000);
    expect(hidden).toBe(0);
    expect(rows[49_999]?.depth).toBe(49_999);
  });
});
