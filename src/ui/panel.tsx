import { For, Match, Show, Switch } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import { IssuesTab } from "./issues";
import { type PanelState, TABS } from "./state";
import { StateTab } from "./state-tab";
import { TimelineTab } from "./timeline";
import { TreeTab } from "./tree";

/**
 * Props of {@link Panel}.
 *
 * @since 1.0.0
 */
export interface PanelProps {
  /**
   * The panel's state, from {@link createPanelState}.
   */
  state: PanelState;
  /**
   * Whether the panel is shown. A closed panel keeps its state and is hidden.
   */
  open: boolean;
  /**
   * Left edge of the panel in pixels.
   */
  x: number;
  /**
   * Top edge of the panel in pixels.
   */
  y: number;
  /**
   * Called while the header is dragged, with the new position in pixels. The panel does not move itself;
   * the owner sets `x` and `y`.
   */
  onMove(x: number, y: number): void;
  /**
   * Called when the close button is pressed.
   */
  onClose(): void;
}

interface DragStart {
  pointer: number;
  x: number;
  y: number;
  left: number;
  top: number;
}

/**
 * The devtools panel: a header with the drag handle and the Pause, Flash, Clear and close controls, the
 * tabs (Components, Timeline, State, Issues), the active view and a footer with counts. It only talks to
 * {@link PanelState}, so it works the same on a local agent and on a remote one.
 *
 * Development tool: `mountDevtools()` renders it in development builds only, and it never ships in
 * production builds.
 *
 * @example
 * import { createAgent, createLocalBackend, createPanelState, Panel } from "@shadow-js/devtools";
 * const backend = createLocalBackend(createAgent());
 * export const Devtools = () => {
 *   const state = createPanelState(backend);
 *   return <Panel state={state} open={true} x={16} y={16} onMove={() => undefined} onClose={() => undefined} />;
 * };
 * @since 1.0.0
 */
export const Panel: Component<PanelProps> = (props) => {
  let drag: DragStart | null = null;

  const begin = (event: PointerEvent & { currentTarget: HTMLElement }): void => {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button, input, label") !== null
    )
      return;
    drag = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: props.x,
      top: props.y,
    };
    event.currentTarget.classList.add("dragging");
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const move = (event: PointerEvent): void => {
    if (drag === null || event.pointerId !== drag.pointer) return;
    props.onMove(drag.left + event.clientX - drag.x, drag.top + event.clientY - drag.y);
  };
  const end = (event: PointerEvent & { currentTarget: HTMLElement }): void => {
    if (drag === null || event.pointerId !== drag.pointer) return;
    drag = null;
    event.currentTarget.classList.remove("dragging");
    if (
      typeof event.currentTarget.releasePointerCapture === "function" &&
      event.currentTarget.hasPointerCapture?.(event.pointerId) === true
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const clear = (): void => {
    void props.state.backend.request({ type: "clear" }).then(() => props.state.refresh());
  };

  return (
    <section
      class="panel"
      role="dialog"
      aria-label="ShadowJS devtools"
      hidden={!props.open}
      style={{ left: `${props.x}px`, top: `${props.y}px` }}
    >
      <header
        class="header"
        on:pointerdown={begin}
        on:pointermove={move}
        on:pointerup={end}
        on:pointercancel={end}
      >
        <span class="title">ShadowJS devtools</span>
        <span class="spacer" />
        <button
          type="button"
          class="btn"
          aria-pressed={props.state.paused()}
          title="Pause or resume recording"
          on:click={() => props.state.setPaused(!props.state.paused())}
        >
          {props.state.paused() ? "Resume" : "Pause"}
        </button>
        <button
          type="button"
          class="btn"
          aria-pressed={props.state.flash()}
          title="Flash components when they update"
          on:click={() => props.state.setFlash(!props.state.flash())}
        >
          Flash
        </button>
        <button type="button" class="btn" title="Forget everything recorded" on:click={clear}>
          Clear
        </button>
        <button type="button" class="btn" aria-label="Close" on:click={() => props.onClose()}>
          ×
        </button>
      </header>
      <div class="tabs" role="tablist">
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              class="tab"
              role="tab"
              aria-selected={props.state.tab() === tab.id}
              data-tab={tab.id}
              on:click={() => props.state.setTab(tab.id)}
            >
              {tab.label}
              <Show
                when={
                  tab.id === "issues" &&
                  props.state.snapshot().counts.errors + props.state.snapshot().counts.hydration > 0
                }
              >
                <span class="badge bad">
                  {props.state.snapshot().counts.errors + props.state.snapshot().counts.hydration}
                </span>
              </Show>
            </button>
          )}
        </For>
      </div>
      <div class="body">
        <Switch>
          <Match when={props.state.tab() === "tree"}>
            <TreeTab state={props.state} />
          </Match>
          <Match when={props.state.tab() === "timeline"}>
            <TimelineTab state={props.state} />
          </Match>
          <Match when={props.state.tab() === "state"}>
            <StateTab state={props.state} />
          </Match>
          <Match when={props.state.tab() === "issues"}>
            <IssuesTab state={props.state} />
          </Match>
        </Switch>
      </div>
      <footer class="footer">
        <span>{props.state.snapshot().counts.components} components</span>
        <span>{props.state.snapshot().counts.signals} signals</span>
        <span>
          {props.state.snapshot().counts.memos + props.state.snapshot().counts.effects} computations
        </span>
        <span>{props.state.snapshot().counts.runs} runs</span>
      </footer>
    </section>
  );
};
