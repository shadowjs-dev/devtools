import { onCleanup, useSignal } from "@shadow-js/core";
import { For, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import type { Backend } from "../../../src/backend";
import { nodeLabel } from "../../../src/inspector";
import { createInspectionState } from "../../../src/ui/inspection-state";
import { createPanelState } from "../../../src/ui/state";
import { createTimelineSession } from "../timeline/session";
import type { EventSource } from "../timeline/tap";
import {
  initialPanelState,
  PANEL_TABS,
  type PanelAction,
  type PanelTab,
  type PanelViewState,
  reducePanel,
} from "./state";
import { TimelineView } from "./timeline-view";
import {
  ComponentsView,
  EffectsView,
  InspectionView,
  IssuesView,
  ResourcesView,
  SignalsView,
  StoresView,
  type ViewProps,
} from "./views";

/**
 * Props of {@link PanelApp}.
 *
 * @since 1.0.0
 */
export interface PanelAppProps {
  /** The backend the panel reads from: a remote one in the extension. */
  readonly backend: Backend;
  /**
   * Calls the listener when the page reports that an inspection source changed. Returns the function
   * that stops the calls. The panel asks the page for the sources again on each call.
   */
  readonly inspected: (listener: () => void) => () => void;
  /**
   * Where the Timeline tab gets the event batches it records (see `createEventTap`). Without it the tab
   * explains that recording is not available. Nothing subscribes to it until the user presses Start recording.
   */
  readonly events?: EventSource;
  /**
   * Entries the Timeline tab keeps.
   *
   * @default 10000
   */
  readonly timelineCapacity?: number;
}

/**
 * The keys of the tab list: arrows move between tabs, Home and End go to the ends (the tab pattern).
 *
 * @param key The key pressed.
 * @returns The action, or `undefined` for other keys.
 */
function tabKeyAction(key: string): PanelAction | undefined {
  switch (key) {
    case "ArrowRight":
      return { type: "step", delta: 1 };
    case "ArrowLeft":
      return { type: "step", delta: -1 };
    case "Home":
      return { type: "edge", end: "first" };
    case "End":
      return { type: "edge", end: "last" };
    default:
      return undefined;
  }
}

/**
 * The extension's panel: a tab bar of the views (components, signals, stores, effects, timeline, resources, router, queries) and the issues, a search box shared by every view, the
 * pause and theme controls, and the connection status. The data comes from `createPanelState` (the
 * graph snapshot, the tree and the selection) and `createInspectionState` (the router and the query
 * cache, which the page describes). The view state is a pure value (see `state.ts`) kept in one signal.
 *
 * @param props The backend and the inspection pings.
 * @returns The panel.
 * @since 1.0.0
 */
export const PanelApp: Component<PanelAppProps> = (props) => {
  const [view, setView] = useSignal<PanelViewState>(initialPanelState());
  const [connected, setConnected] = useSignal(false);
  const state = createPanelState(props.backend);
  const inspections = createInspectionState(props.backend);
  const dispatch = (action: PanelAction): void => {
    setView(reducePanel(view(), action));
  };

  // The model's changes are shown once per frame, as the overlay shows them: a burst is one redraw.
  let refreshPending = false;
  const stopModel = props.backend.subscribe(() => {
    if (refreshPending) return;
    refreshPending = true;
    requestAnimationFrame(() => {
      refreshPending = false;
      state.refresh();
    });
  });
  const stopPings = props.inspected(() => {
    void inspections.refresh();
  });
  // The timeline session attaches to the event source only while the user records; building it allocates
  // nothing but a few closures.
  const timeline = createTimelineSession({
    ...(props.events === undefined ? {} : { events: props.events }),
    ...(props.timelineCapacity === undefined ? {} : { capacity: props.timelineCapacity }),
    resolve: (id) => {
      const node = props.backend.model.node(id);
      return node === undefined ? undefined : nodeLabel(node);
    },
  });
  onCleanup(() => {
    stopModel();
    stopPings();
    timeline.dispose();
  });
  void props.backend.ready.then(() => {
    setConnected(true);
    void inspections.refresh();
  });

  const showTab = (tab: PanelTab): void => {
    dispatch({ type: "tab", tab });
    if (tab === "router" || tab === "queries") void inspections.refresh();
  };

  const onTabKey = (event: KeyboardEvent): void => {
    const action = tabKeyAction(event.key);
    if (action === undefined) return;
    event.preventDefault();
    const next = reducePanel(view(), action).tab;
    showTab(next);
    queueMicrotask(() => document.getElementById(`tab-${next}`)?.focus());
  };

  // The state changes when the agent confirms it, so the label never claims a pause that did not happen.
  const togglePause = (): void => {
    const on = !view().paused;
    void props.backend.request({ type: on ? "pause" : "resume" }).then((response) => {
      if (response.ok) dispatch({ type: "paused", on });
    });
  };

  const viewProps: ViewProps = {
    state,
    backend: props.backend,
    inspections,
    query: () => view().query,
  };

  return (
    <div class="shell" data-theme={view().theme}>
      <header class="bar">
        <div class="tabs" role="tablist" aria-label="Views" on:keydown={onTabKey}>
          <For each={PANEL_TABS} key={(tab) => tab.id}>
            {(tab) => (
              <button
                type="button"
                role="tab"
                id={`tab-${tab().id}`}
                class="tab"
                aria-selected={view().tab === tab().id}
                aria-controls="tabpanel"
                tabIndex={view().tab === tab().id ? 0 : -1}
                on:click={() => showTab(tab().id)}
              >
                {tab().label}
              </button>
            )}
          </For>
        </div>
        <label class="search">
          <span class="sr-only">Search the current view</span>
          <input
            type="search"
            placeholder="Search"
            value={view().query}
            on:input={(event) => {
              const text = event.currentTarget.value;
              dispatch({ type: "query", text });
              state.setFilter(text);
            }}
          />
        </label>
        <button
          type="button"
          class="btn"
          aria-pressed={view().paused}
          title="Pause or resume recording in the page"
          on:click={togglePause}
        >
          {view().paused ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          class="btn"
          aria-pressed={view().theme === "light"}
          on:click={() =>
            dispatch({ type: "theme", theme: view().theme === "dark" ? "light" : "dark" })
          }
        >
          {view().theme === "dark" ? "Light theme" : "Dark theme"}
        </button>
        <span class="status" role="status" aria-live="polite">
          {connected() ? (view().paused ? "Connected, paused" : "Connected") : "Connecting…"}
        </span>
      </header>
      <div id="tabpanel" class="view" role="tabpanel" aria-labelledby={`tab-${view().tab}`}>
        <Show when={view().tab === "components"}>
          <ComponentsView {...viewProps} />
        </Show>
        <Show when={view().tab === "signals"}>
          <SignalsView {...viewProps} />
        </Show>
        <Show when={view().tab === "stores"}>
          <StoresView {...viewProps} />
        </Show>
        <Show when={view().tab === "effects"}>
          <EffectsView {...viewProps} />
        </Show>
        <Show when={view().tab === "timeline"}>
          <TimelineView session={timeline} />
        </Show>
        <Show when={view().tab === "resources"}>
          <ResourcesView {...viewProps} />
        </Show>
        <Show when={view().tab === "router"}>
          <InspectionView
            {...viewProps}
            name="router"
            label="Router"
            hint={`No router source yet. Register one with registerInspection("router", routerInspection(router)).`}
          />
        </Show>
        <Show when={view().tab === "queries"}>
          <InspectionView
            {...viewProps}
            name="query"
            label="Queries"
            hint={`No query source yet. Register one with registerInspection("query", queryInspection(client)).`}
          />
        </Show>
        <Show when={view().tab === "issues"}>
          <IssuesView {...viewProps} />
        </Show>
      </div>
    </div>
  );
};
