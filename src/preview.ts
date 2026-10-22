/**
 * Short, side-effect-free text for a value. It never walks an object (a store view or a proxy could
 * run user code or be huge): objects show their kind and size only.
 *
 * @param value Any value.
 * @param limit Maximum length of the result (default 80).
 * @returns Text such as `42`, `"hello"`, `Array(3)`, `Map(2)`, `{…}` or `<div>`. Longer text is cut to
 * `limit` characters and ends with `…`.
 * @example
 * import { preview } from "@shadow-js/devtools";
 *
 * preview([1, 2, 3]); // "Array(3)"
 * @since 1.0.0
 */
export function preview(value: unknown, limit = 80): string {
  const text = describe(value);
  return text.length > limit ? `${text.slice(0, Math.max(limit - 1, 1))}…` : text;
}

function describe(value: unknown): string {
  switch (typeof value) {
    case "string":
      return JSON.stringify(value);
    case "number":
    case "boolean":
    case "undefined":
      return String(value);
    case "bigint":
      return `${value}n`;
    case "symbol":
      return value.toString();
    case "function":
      return "ƒ()";
    default:
      break;
  }
  if (value === null) return "null";
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (value instanceof Map) return `Map(${value.size})`;
  if (value instanceof Set) return `Set(${value.size})`;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof Node !== "undefined" && value instanceof Node) {
    return value instanceof Element ? `<${value.localName}>` : `#${value.nodeName}`;
  }
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype === null || prototype === Object.prototype) return "{…}";
  const ctor: unknown =
    typeof prototype === "object" && prototype !== null
      ? Reflect.get(prototype, "constructor")
      : undefined;
  const name = typeof ctor === "function" ? ctor.name : "";
  return name === "" ? "{…}" : `${name} {…}`;
}

/**
 * A readable, bounded message for anything thrown: `name: message` for an `Error`, otherwise the
 * {@link preview} of the value. Use it to show a caught value to a person.
 *
 * @param error The thrown value.
 * @param limit Maximum length of the result; a longer message is cut and ends with `…` (default 300).
 * @returns The message, cut to `limit` characters when it is longer.
 * @example
 * import { errorMessage } from "@shadow-js/devtools";
 *
 * errorMessage(new TypeError("bad")); // "TypeError: bad"
 * errorMessage("plain"); // "\"plain\""
 * @see preview
 * @since 1.0.0
 */
export function errorMessage(error: unknown, limit = 300): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : preview(error, limit);
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

/**
 * Pretty JSON for the value editor. Values JSON cannot hold (cycles, BigInt) are shown as text
 * instead of throwing.
 *
 * @param value Any value.
 * @returns Indented JSON. `undefined` is spelled `undefined`. A value JSON has no text for (a function
 * or a symbol) gives its {@link preview}. A value that makes `JSON.stringify` throw gives its preview
 * followed by the reason in parentheses, such as `{…} (not JSON: ...)`.
 * @example
 * import { toEditableText } from "@shadow-js/devtools";
 *
 * toEditableText([1, 2]); // "[\n  1,\n  2\n]"
 * @see parseEditableText
 * @since 1.0.0
 */
export function toEditableText(value: unknown): string {
  if (value === undefined) return "undefined";
  try {
    const json = JSON.stringify(value, null, 2);
    return json === undefined ? preview(value, 500) : json;
  } catch (error) {
    // Circular structures and BigInt values cannot be JSON: show what they are instead.
    return `${preview(value, 200)} (not JSON: ${errorMessage(error, 80)})`;
  }
}

/** The result of {@link parseEditableText}. @since 1.0.0 */
export type ParsedValue = { ok: true; value: unknown } | { ok: false; error: string };

/**
 * Parses what a user typed in the value editor: JSON, or the literal `undefined`. Surrounding
 * whitespace is ignored. It never throws: bad input comes back as `{ ok: false }` with a message.
 *
 * @param text The editor text.
 * @returns `{ ok: true, value }` for valid input, or `{ ok: false, error }` where `error` is a message
 * cut to 120 characters.
 * @example
 * import { parseEditableText } from "@shadow-js/devtools";
 *
 * parseEditableText('{"count": 2}'); // { ok: true, value: { count: 2 } }
 * parseEditableText("{oops").ok; // false
 * @see toEditableText
 * @since 1.0.0
 */
export function parseEditableText(text: string): ParsedValue {
  const trimmed = text.trim();
  if (trimmed === "undefined") return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(trimmed) as unknown };
  } catch (error) {
    return { ok: false, error: errorMessage(error, 120) };
  }
}
