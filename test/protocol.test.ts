import { readFileSync } from "node:fs";
import { DEVTOOLS_EVENT } from "@shadow-js/core/extend";
import { describe, expect, it } from "vitest";
import { EVENT } from "../src/protocol";

/** The two places that document the protocol: the TSDoc of protocol.ts and the package README. */
const protocolSource = readFileSync(new URL("../src/protocol.ts", import.meta.url), "utf8");
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** Rows of the protocol table in the TSDoc of `EVENT`: ` * | \`NAME\` | a | b | c | d | e |`. */
function tsdocRows(source: string): string[][] {
  const rows: string[][] = [];
  for (const line of source.split("\n")) {
    if (!/^\s*\*\s*\|/.test(line)) continue;
    const cells = line
      .replace(/^\s*\*\s*/, "")
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    rows.push(cells);
  }
  return rows;
}

/** The section of the README that holds the protocol table (up to the next top-level heading). */
function readmeProtocolSection(text: string): string {
  const start = text.indexOf("## The dev-hook protocol");
  const end = text.indexOf("## Development only");
  if (start === -1 || end === -1 || end < start) throw new Error("protocol section not found");
  return text.slice(start, end);
}

/** Rows of a markdown table in a section: `| cell | cell |`, one array of cells per row. */
function markdownRows(section: string): string[][] {
  const rows: string[][] = [];
  for (const line of section.split("\n")) {
    if (!/^\|\s*`/.test(line)) continue;
    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
  }
  return rows;
}

/** The kind name in a row's first cell, e.g. "`OWNER_CREATED`" becomes "OWNER_CREATED". */
function kindOf(cell: string | undefined): string {
  const match = /^`([A-Z_]+)`$/.exec(cell ?? "");
  if (match?.[1] === undefined) throw new Error(`not a kind cell: ${cell ?? "(missing)"}`);
  return match[1];
}

/** Number of argument cells that document something (not blank). */
function filledArguments(cells: readonly string[]): number {
  return cells.slice(1).filter((cell) => cell !== "").length;
}

const kinds = Object.entries(EVENT)
  .sort((left, right) => left[1] - right[1])
  .map(([name]) => name);

describe("[DVT-PROTO] the protocol tables and the runtime's event kinds stay in sync", () => {
  it("[DVT-PROTO.1] the runtime's DEVTOOLS_EVENT and the protocol's EVENT have the same kinds and numbers", () => {
    expect({ ...DEVTOOLS_EVENT }).toEqual({ ...EVENT });
  });

  it("[DVT-PROTO.2] the TSDoc table of protocol.ts lists every kind once, in number order (row n is kind n)", () => {
    const rows = tsdocRows(protocolSource).filter((cells) => cells[0]?.startsWith("`") === true);
    expect(rows.map((cells) => kindOf(cells[0]))).toEqual(kinds);
  });

  it("[DVT-PROTO.3] the README table lists every kind once, in number order (row n is kind n)", () => {
    const rows = markdownRows(readmeProtocolSection(readme));
    expect(rows.map((cells) => kindOf(cells[0]))).toEqual(kinds);
  });

  it("[DVT-PROTO.4] the README runtime table names every kind, kinds 16 and 17 included", () => {
    const section = readme.slice(readme.indexOf("## Runtime integration"));
    const named = new Set<string>();
    for (const cells of markdownRows(section)) {
      for (const part of (cells[0] ?? "").split(",")) {
        const match = /`([A-Z_]+)`/.exec(part);
        if (match?.[1] !== undefined) named.add(match[1]);
      }
    }
    for (const kind of kinds) expect(named.has(kind), kind).toBe(true);
    expect(named.has("TRANSITION_START")).toBe(true);
    expect(named.has("TRANSITION_END")).toBe(true);
  });

  it("[DVT-PROTO.5] both tables document the same number of arguments for every kind", () => {
    const fromTsdoc = new Map(
      tsdocRows(protocolSource)
        .filter((cells) => cells[0]?.startsWith("`") === true)
        .map((cells) => [kindOf(cells[0]), filledArguments(cells)]),
    );
    const fromReadme = new Map(
      markdownRows(readmeProtocolSection(readme)).map((cells) => [
        kindOf(cells[0]),
        filledArguments(cells),
      ]),
    );
    for (const kind of kinds) {
      expect(fromReadme.get(kind), kind).toBe(fromTsdoc.get(kind));
    }
  });

  it("[DVT-PROTO.6] the README gives the resource name from the name option, not the server key", () => {
    const section = readme.slice(readme.indexOf("## Runtime integration"));
    const row = section.split("\n").find((line) => line.startsWith("| `RESOURCE_STATE`"));
    expect(row).toBeDefined();
    expect(row).toContain("options.name");
    expect(row).not.toContain("options.key");
  });
});
