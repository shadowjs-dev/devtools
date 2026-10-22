/**
 * `@shadow-js/devtools`: developer tooling for the ShadowJS reactive graph.
 *
 * - **Protocol** ({@link EVENT}, {@link DevtoolsHook}): how a runtime reports to tools, through
 *   `globalThis.__SHADOWJS_DEVTOOLS_HOOK__`.
 * - **Agent** ({@link createAgent}): records the events into bounded ring buffers.
 * - **Inspector** ({@link snapshotOf}, {@link explainRun}, {@link flameTimeline}): pure functions over
 *   the recorded model.
 * - **Panel** ({@link mountDevtools}): a floating overlay built with ShadowJS, or a remote panel over
 *   `postMessage` / `BroadcastChannel` ({@link serveAgent}, {@link connectRemote}).
 *
 * In production builds (`__DEV__` false) mounting does nothing and the hook is never installed.
 *
 * @packageDocumentation
 */
export type {
  Agent,
  AgentOptions,
  AgentRequest,
  AgentResponse,
  AgentStats,
  ValueResult,
} from "./agent";
export { createAgent } from "./agent";
export type { Backend, PageHooks } from "./backend";
export { createLocalBackend } from "./backend";
export type { InstalledHook, InstallHookOptions } from "./hook";
export { getHook, installHook, uninstallHook } from "./hook";
export type {
  InspectionEntry,
  InspectionRow,
  InspectionSnapshot,
  InspectionSource,
  QueryInfoLike,
  QueryLike,
  RouterLike,
} from "./inspection";
export {
  parseInspectResult,
  queryInspection,
  readInspections,
  registerInspection,
  routerInspection,
  sanitizeRows,
} from "./inspection";
export type {
  ComponentStat,
  ExplainStep,
  Explanation,
  FlameFlush,
  FlameSpan,
  GraphSnapshot,
  SnapshotCounts,
  SnapshotNode,
  TreeNode,
} from "./inspector";
export {
  componentStats,
  explainRun,
  flameTimeline,
  nodeLabel,
  ownerTree,
  snapshotOf,
} from "./inspector";
export type {
  Cause,
  ErrorRecord,
  FlushRecord,
  HydrationRecord,
  ModelLimits,
  ModelState,
  NodeRecord,
  NodeType,
  RunRecord,
  WriteRecord,
} from "./model";
export { DEFAULT_LIMITS, foldEvents, InspectorModel } from "./model";
export type { DevtoolsHandle, MountOptions } from "./mount";
export { matchesShortcut, mountDevtools, parseShortcut } from "./mount";
export type { Box, Overlay, OverlayOptions } from "./overlay";
export { boxOf, createOverlay } from "./overlay";
export { errorMessage, parseEditableText, preview, toEditableText } from "./preview";
export type {
  DevtoolsHook,
  EventKind,
  HookSink,
  StoreHandle,
  WireEvent,
  WireKind,
} from "./protocol";
export {
  EVENT,
  HOOK_KEY,
  MAX_INSPECTION_ROWS,
  MAX_INSPECTIONS,
  NO_ID,
  PROTOCOL_VERSION,
} from "./protocol";
export { RingBuffer } from "./ring";
export type {
  AgentMessage,
  BroadcastChannelLike,
  MessagePortLike,
  PanelMessage,
  RemoteOptions,
  ServeOptions,
  Transport,
  WindowTransportOptions,
} from "./transport";
export {
  CHANNEL,
  connectRemote,
  createBroadcastChannelTransport,
  createMemoryTransportPair,
  createPortTransport,
  createWindowTransport,
  isAgentMessage,
  isPanelMessage,
  serveAgent,
} from "./transport";
export type { InspectionState } from "./ui/inspection-state";
export { createInspectionState } from "./ui/inspection-state";
export type { PanelProps } from "./ui/panel";
export { Panel } from "./ui/panel";
export type { PanelState, TabId } from "./ui/state";
export { createPanelState, TABS } from "./ui/state";
export { LAUNCHER_CSS, PANEL_CSS } from "./ui/styles";
