import {
  type Agent,
  type AgentRequest,
  type AgentResponse,
  type AgentStats,
  type ComponentStat,
  type componentStats,
  createAgent,
  type DevtoolsHook,
  type EVENT,
  type EventKind,
  type Explanation,
  explainRun,
  type GraphSnapshot,
  type InspectorModel,
  type ownerTree,
  type snapshotOf,
  type TreeNode,
  type ValueResult,
} from "../src";
import type { Equal, Expect } from "./support";

declare const hook: DevtoolsHook;
declare const model: InspectorModel;

export type EventOwnerCreatedCheck = Expect<Equal<(typeof EVENT)["OWNER_CREATED"], 1>>;

export type EventKindCheck = Expect<
  Equal<EventKind, 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 | 16 | 17>
>;

export type AgentResponseResultCheck = Expect<
  Equal<Extract<AgentResponse, { ok: true }>["result"], unknown>
>;

export type AgentResponseErrorCheck = Expect<
  Equal<Extract<AgentResponse, { ok: false }>["error"], string>
>;

export type AgentRequestTypeCheck = Expect<
  Equal<
    AgentRequest["type"],
    | "snapshot"
    | "value"
    | "write"
    | "store"
    | "store-set"
    | "highlight"
    | "pause"
    | "resume"
    | "clear"
    | "stats"
    | "inspect"
  >
>;

export type ValueResultKindCheck = Expect<Equal<ValueResult["kind"], "signal" | "store">>;

export type AgentStatsReceivedCheck = Expect<Equal<AgentStats["received"], number>>;

export type HookVersionCheck = Expect<Equal<DevtoolsHook["version"], number>>;

export type HookReportKindCheck = Expect<Equal<Parameters<DevtoolsHook["report"]>[0], number>>;

export type CreateAgentReturnCheck = Expect<Equal<ReturnType<typeof createAgent>, Agent>>;

export type ExplainRunReturnCheck = Expect<
  Equal<ReturnType<typeof explainRun>, Explanation | null>
>;

export type SnapshotOfReturnCheck = Expect<Equal<ReturnType<typeof snapshotOf>, GraphSnapshot>>;

export type OwnerTreeReturnCheck = Expect<Equal<ReturnType<typeof ownerTree>, TreeNode[]>>;

export type ComponentStatsReturnCheck = Expect<
  Equal<ReturnType<typeof componentStats>, ComponentStat[]>
>;

export const configuredAgent: Agent = createAgent({
  limits: { runs: 50 },
  events: 100,
  previewLength: 40,
  now: () => 0,
});

export const reportedHookVersion: number = hook.version;

export const explained: Explanation | null = explainRun(model, 1, { runSeq: 2, maxDepth: 3 });

// @ts-expect-error 18 is past the last event kind
export const unknownEventKind: EventKind = 18;

// @ts-expect-error the report kind is a number, not a name
export const reportWithName: void = hook.report("OWNER_CREATED");

// @ts-expect-error "explode" is not an agent request type
export const unknownRequest: AgentRequest = { type: "explode" };

// @ts-expect-error events is a count, not a string
export const eventsAsText: Agent = createAgent({ events: "many" });

// @ts-expect-error the run id is a number
export const explainByText: Explanation | null = explainRun(model, "3");

// @ts-expect-error an ok response carries a result, not an error
export const okWithoutResult: AgentResponse = { ok: true };

// @ts-expect-error the value kind is "signal" or "store"
export const computedValue: ValueResult = { id: 1, kind: "computed", text: "", editable: false };
