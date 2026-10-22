/**
 * The recording file: a versioned JSON document that {@link serializeRecording} writes and
 * {@link parseRecording} reads. The importer treats the file as untrusted input. It checks the size before it
 * parses, rebuilds every object from known fields (so a key such as `__proto__` can neither reach a prototype
 * nor survive), rejects unknown keys, and caps the number of entries, ids and labels.
 *
 * @packageDocumentation
 */
import {
  cleanLabel,
  MAX_CAPACITY,
  MAX_LABEL_LENGTH,
  MAX_LABELS,
  MAX_LINKS,
  type TimelineData,
  type TimelineEntry,
} from "./recorder";

/**
 * The `format` field of a recording.
 *
 * @since 1.0.0
 */
export const RECORDING_FORMAT = "shadowjs-timeline";

/**
 * The schema version this code writes and reads.
 *
 * @since 1.0.0
 */
export const RECORDING_VERSION = 1;

/**
 * Longest recording text the importer reads, in characters (32 MiB). The check comes before `JSON.parse`.
 *
 * @since 1.0.0
 */
export const MAX_IMPORT_CHARS: number = 32 * 1024 * 1024;

/**
 * The answer of {@link parseRecording}: the data, or the reason the file was refused.
 *
 * @since 1.0.0
 */
export type ParseResult =
  | { readonly ok: true; readonly data: TimelineData }
  | { readonly ok: false; readonly error: string };

/**
 * Writes a recording as JSON text. The text is deterministic: the same data gives the same bytes.
 *
 * @param data The recorded data.
 * @returns The JSON text of schema version {@link RECORDING_VERSION}.
 * @example
 * import { parseRecording, serializeRecording } from "./schema";
 *
 * const text = serializeRecording({ entries: [], labels: new Map(), dropped: 0, capacity: 10_000 });
 * parseRecording(text).ok; // true
 * @since 1.0.0
 */
export function serializeRecording(data: TimelineData): string {
  return JSON.stringify({
    format: RECORDING_FORMAT,
    version: RECORDING_VERSION,
    capacity: data.capacity,
    dropped: data.dropped,
    labels: [...data.labels].map(([id, label]) => [id, label]),
    entries: data.entries,
  });
}

class Refused extends Error {}

function refuse(message: string): never {
  throw new Refused(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  where: string,
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) refuse(`${where}: unknown field "${shorten(key)}".`);
  }
  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) refuse(`${where}: missing field "${key}".`);
  }
}

function shorten(text: string): string {
  return text.length > 32 ? `${text.slice(0, 31)}…` : text;
}

function int(value: unknown, min: number, max: number, where: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    refuse(`${where} must be an integer from ${min} to ${max}.`);
  }
  return value;
}

function num(value: unknown, min: number, max: number, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) {
    refuse(`${where} must be a number from ${min} to ${max}.`);
  }
  return value;
}

const MAX_ID = 0x7fffffff;
const MAX_TIME = 1e13;
const MAX_DURATION = 1e9;
const MAX_COUNT = 1e9;

function idList(value: unknown, where: string): number[] {
  if (!Array.isArray(value)) refuse(`${where} must be a list.`);
  if (value.length > MAX_LINKS) refuse(`${where} may hold at most ${MAX_LINKS} ids.`);
  return value.map((id) => int(id, 1, MAX_ID, `${where} id`));
}

function entryOf(value: unknown, index: number): TimelineEntry {
  const where = `entry ${index}`;
  if (!isRecord(value)) refuse(`${where} is not an object.`);
  switch (value["k"]) {
    case "write": {
      exactKeys(value, ["k", "seq", "t", "signal", "writer", "observers"], where);
      return {
        k: "write",
        seq: int(value["seq"], 0, Number.MAX_SAFE_INTEGER, `${where} seq`),
        t: num(value["t"], 0, MAX_TIME, `${where} t`),
        signal: int(value["signal"], 1, MAX_ID, `${where} signal`),
        writer: int(value["writer"], 0, MAX_ID, `${where} writer`),
        observers: idList(value["observers"], `${where} observers`),
      };
    }
    case "run": {
      exactKeys(value, ["k", "seq", "t", "duration", "comp", "changed", "sources"], where);
      if (typeof value["changed"] !== "boolean") refuse(`${where} changed must be true or false.`);
      return {
        k: "run",
        seq: int(value["seq"], 0, Number.MAX_SAFE_INTEGER, `${where} seq`),
        t: num(value["t"], 0, MAX_TIME, `${where} t`),
        duration: num(value["duration"], 0, MAX_DURATION, `${where} duration`),
        comp: int(value["comp"], 1, MAX_ID, `${where} comp`),
        changed: value["changed"],
        sources: idList(value["sources"], `${where} sources`),
      };
    }
    case "flush": {
      exactKeys(value, ["k", "seq", "t", "end", "render", "user", "runs"], where);
      const t = num(value["t"], 0, MAX_TIME, `${where} t`);
      const end = num(value["end"], t, MAX_TIME, `${where} end`);
      return {
        k: "flush",
        seq: int(value["seq"], 0, Number.MAX_SAFE_INTEGER, `${where} seq`),
        t,
        end,
        render: int(value["render"], 0, MAX_COUNT, `${where} render`),
        user: int(value["user"], 0, MAX_COUNT, `${where} user`),
        runs: int(value["runs"], 0, MAX_COUNT, `${where} runs`),
      };
    }
    default:
      return refuse(`${where} has an unknown kind.`);
  }
}

function labelsOf(value: unknown): Map<number, string> {
  if (!Array.isArray(value)) refuse("labels must be a list.");
  if (value.length > MAX_LABELS) refuse(`labels may hold at most ${MAX_LABELS} items.`);
  const labels = new Map<number, string>();
  for (const pair of value as unknown[]) {
    if (!Array.isArray(pair) || pair.length !== 2) refuse("A label must be an [id, text] pair.");
    const id = int(pair[0], 1, MAX_ID, "A label id");
    const text: unknown = pair[1];
    if (typeof text !== "string" || text.length > MAX_LABEL_LENGTH) {
      refuse(`A label must be text of at most ${MAX_LABEL_LENGTH} characters.`);
    }
    labels.set(id, cleanLabel(text));
  }
  return labels;
}

/**
 * Reads a recording. Never throws: a file that is too large, not JSON, of another version or not shaped like
 * a recording comes back as `{ ok: false, error }` with a sentence for the user.
 *
 * What is checked: the text is at most {@link MAX_IMPORT_CHARS} characters; the document is a plain object
 * with exactly the fields of the schema; `version` is {@link RECORDING_VERSION}; there are at most
 * {@link MAX_CAPACITY} entries, each with exactly the fields of its kind and numbers in range; ids are
 * integers; lists hold at most {@link MAX_LINKS} ids; sequence numbers do not go down; labels are text of at
 * most {@link MAX_LABEL_LENGTH} characters (control and bidirectional-override characters become spaces).
 * Every object in the result is built here from those fields.
 *
 * @param text The file's text.
 * @returns The data, or the reason the file was refused.
 * @example
 * import { parseRecording } from "./schema";
 *
 * parseRecording("{}").ok; // false
 * parseRecording('{"__proto__":{"polluted":true}}').ok; // false
 * @since 1.0.0
 */
export function parseRecording(text: unknown): ParseResult {
  try {
    if (typeof text !== "string") refuse("The recording is not text.");
    if (text.length > MAX_IMPORT_CHARS) {
      refuse(`The recording is larger than ${MAX_IMPORT_CHARS / (1024 * 1024)} MiB.`);
    }
    let document: unknown;
    try {
      document = JSON.parse(text);
    } catch {
      refuse("The recording is not valid JSON.");
    }
    if (!isRecord(document)) refuse("The recording is not an object.");
    if (document["format"] !== RECORDING_FORMAT)
      refuse("This is not a ShadowJS timeline recording.");
    if (typeof document["version"] === "number" && document["version"] > RECORDING_VERSION) {
      refuse(
        `The recording is version ${document["version"]}; this panel reads version ${RECORDING_VERSION}.`,
      );
    }
    if (document["version"] !== RECORDING_VERSION) refuse("The recording has an unknown version.");
    exactKeys(
      document,
      ["format", "version", "capacity", "dropped", "labels", "entries"],
      "recording",
    );
    const capacity = int(document["capacity"], 1, MAX_CAPACITY, "capacity");
    const dropped = int(document["dropped"], 0, Number.MAX_SAFE_INTEGER, "dropped");
    const list = document["entries"];
    if (!Array.isArray(list)) refuse("entries must be a list.");
    if (list.length > MAX_CAPACITY) refuse(`A recording may hold at most ${MAX_CAPACITY} entries.`);
    const entries: TimelineEntry[] = [];
    let last = 0;
    for (let i = 0; i < list.length; i += 1) {
      const entry = entryOf(list[i], i);
      if (entry.seq < last) refuse(`entry ${i}: sequence numbers must not go down.`);
      last = entry.seq;
      entries.push(entry);
    }
    return { ok: true, data: { entries, labels: labelsOf(document["labels"]), dropped, capacity } };
  } catch (error) {
    if (error instanceof Refused) return { ok: false, error: error.message };
    return { ok: false, error: "The recording could not be read." };
  }
}
