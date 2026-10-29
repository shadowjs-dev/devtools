import type { ModelState } from "../model";
import type { WireEvent } from "../protocol";

/**
 * Shape checks for what a panel receives from the inspected page. The page is not trusted by the tools
 * that inspect it: a page script (or a compromised dependency of the app) can post anything on the
 * channel, so the panel's model never sees a value it has not checked. The checks look at the types the
 * model and the views read (numbers where arithmetic happens, arrays where they are iterated); they do
 * not try to prove the content is true.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalText(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function areNumbers(value: unknown): value is number[] {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!isNumber(value[index])) return false;
  }
  return true;
}

function areTexts(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

function areNumbersAt(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => isNumber(value[key]));
}

/**
 * True when `value` has the shape of a {@link WireEvent}: a known kind, a finite `seq` and `t`, and the
 * fields that kind carries with the right types. An unknown kind is refused too: the agent of a newer
 * protocol version sends only the kinds this one knows, or bumps the version.
 *
 * @param value One element of an `events` message.
 * @returns True when the model can apply it without reading a missing field.
 * @since 1.0.0
 */
export function isWireEvent(value: unknown): value is WireEvent {
  if (!isRecord(value) || !isNumber(value["seq"]) || !isNumber(value["t"])) return false;
  switch (value["k"]) {
    case "owner+":
      return (
        areNumbersAt(value, ["id", "parent"]) &&
        typeof value["label"] === "string" &&
        isOptionalText(value["name"])
      );
    case "owner-":
    case "comp-":
    case "unmount":
      return isNumber(value["id"]);
    case "signal+":
      return (
        areNumbersAt(value, ["id", "owner"]) &&
        typeof value["preview"] === "string" &&
        isOptionalText(value["name"])
      );
    case "write":
      return (
        areNumbersAt(value, ["id", "writer"]) &&
        typeof value["preview"] === "string" &&
        areNumbers(value["observers"])
      );
    case "comp+":
      return (
        areNumbersAt(value, ["id", "owner"]) &&
        (value["kind"] === "memo" || value["kind"] === "effect") &&
        typeof value["render"] === "boolean" &&
        isOptionalText(value["name"])
      );
    case "run":
      return (
        areNumbersAt(value, ["id", "start", "duration"]) &&
        typeof value["changed"] === "boolean" &&
        areNumbers(value["sources"])
      );
    case "mount":
      return isNumber(value["id"]) && typeof value["name"] === "string";
    case "resource":
      return (
        areNumbersAt(value, ["id", "owner"]) &&
        typeof value["state"] === "string" &&
        isOptionalText(value["name"])
      );
    case "error":
      return (
        isNumber(value["id"]) &&
        typeof value["message"] === "string" &&
        isOptionalText(value["code"])
      );
    case "hydration":
      return areTexts(value, ["message", "expected", "actual"]);
    case "flush+":
      return areNumbersAt(value, ["render", "user"]);
    case "flush-":
      return isNumber(value["runs"]);
    case "store+":
      return areNumbersAt(value, ["id", "owner"]) && typeof value["name"] === "string";
    default:
      return false;
  }
}

function isNodeState(value: unknown): boolean {
  return (
    isRecord(value) &&
    areNumbersAt(value, ["id", "parent"]) &&
    areTexts(value, ["type", "label", "preview", "state"]) &&
    isOptionalText(value["name"]) &&
    areNumbers(value["sources"]) &&
    areNumbers(value["observers"])
  );
}

function isRunState(value: unknown): boolean {
  if (!isRecord(value) || !areNumbersAt(value, ["seq", "t", "id", "start", "duration", "flush"])) {
    return false;
  }
  const causes = value["causes"];
  return (
    Array.isArray(causes) &&
    causes.every(
      (cause) =>
        isRecord(cause) && typeof cause["kind"] === "string" && areNumbersAt(cause, ["id", "seq"]),
    )
  );
}

function isWriteState(value: unknown): boolean {
  return (
    isRecord(value) &&
    areNumbersAt(value, ["seq", "t", "id", "writer"]) &&
    typeof value["preview"] === "string" &&
    areNumbers(value["observers"])
  );
}

function isFlushState(value: unknown): boolean {
  return (
    isRecord(value) &&
    areNumbersAt(value, ["seq", "startSeq", "start", "end", "render", "user", "runs"]) &&
    typeof value["open"] === "boolean"
  );
}

function isErrorState(value: unknown): boolean {
  return (
    isRecord(value) &&
    areNumbersAt(value, ["seq", "t", "id"]) &&
    typeof value["message"] === "string" &&
    isOptionalText(value["code"])
  );
}

function isHydrationState(value: unknown): boolean {
  return (
    isRecord(value) &&
    areNumbersAt(value, ["seq", "t"]) &&
    areTexts(value, ["message", "expected", "actual"])
  );
}

function every(value: unknown, check: (entry: unknown) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!check(value[index])) return false;
  }
  return true;
}

/**
 * True when `value` has the shape of a {@link ModelState}: the counters are numbers and every list holds
 * records with the fields the model and the views read.
 *
 * @param value The `result` of an ok `snapshot` response.
 * @returns True when {@link InspectorModel.importState} can load it.
 * @since 1.0.0
 */
export function isModelState(value: unknown): value is ModelState {
  return (
    isRecord(value) &&
    areNumbersAt(value, ["lastSeq", "overflow", "unknown"]) &&
    every(value["nodes"], isNodeState) &&
    every(value["graveyard"], isNodeState) &&
    every(value["runs"], isRunState) &&
    every(value["writes"], isWriteState) &&
    every(value["flushes"], isFlushState) &&
    every(value["errors"], isErrorState) &&
    every(value["hydration"], isHydrationState)
  );
}
