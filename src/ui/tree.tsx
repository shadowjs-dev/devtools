import { For, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import { Details } from "./details";
import { kindLetter, type TreeRow } from "./rows";
import type { PanelState } from "./state";

interface RowProps {
  state: PanelState;
  row: TreeRow;
}

/** One line of the tree: twisty, kind, name, value and the re-run count. */
const TreeRowView: Component<RowProps> = (props) => (
  <div
    class="row"
    role="treeitem"
    aria-level={props.row.depth + 1}
    aria-selected={props.state.selected() === props.row.id}
    aria-expanded={props.row.hasChildren ? !props.row.collapsed : undefined}
    data-id={props.row.id}
    tabIndex={props.state.selected() === props.row.id ? 0 : -1}
    style={{ paddingLeft: `${8 + props.row.depth * 14}px` }}
    on:click={() => props.state.select(props.row.id)}
    on:pointerenter={() => props.state.highlight(props.row.id)}
    on:pointerleave={() => props.state.highlight(null)}
  >
    <button
      type="button"
      class="twisty"
      tabIndex={-1}
      aria-label="Toggle children"
      hidden={!props.row.hasChildren}
      on:click={(event) => {
        event.stopPropagation();
        props.state.toggleCollapsed(props.row.id);
      }}
    >
      {props.row.collapsed ? "▸" : "▾"}
    </button>
    <Show when={!props.row.hasChildren}>
      <span class="twisty" />
    </Show>
    <span class={`kind ${props.row.isComponent ? "component" : props.row.type}`}>
      {kindLetter(props.row)}
    </span>
    <span class={props.row.isComponent ? "name component" : "name"}>{props.row.label}</span>
    <span class="value">{props.row.detail}</span>
    <Show when={props.row.updates > 0}>
      <span class="updates" title="Re-runs of effects and memos below this node">
        ×{props.row.updates}
      </span>
    </Show>
  </div>
);

/**
 * Keyboard navigation of the tree: arrows move the selection, left and right collapse and expand,
 * Home and End jump to the ends. Focus follows the selected row (roving tabindex).
 */
function navigate(state: PanelState, event: KeyboardEvent): void {
  const rows = state.rows().rows;
  const index = rows.findIndex((row) => row.id === state.selected());
  const select = (next: number): void => {
    const row = rows[next];
    if (row === undefined) return;
    event.preventDefault();
    state.select(row.id);
    state.highlight(row.id);
    const list = event.currentTarget;
    if (list instanceof HTMLElement) {
      queueMicrotask(() => list.querySelector<HTMLElement>(`[data-id="${row.id}"]`)?.focus());
    }
  };
  const current = rows[index];
  switch (event.key) {
    case "ArrowDown":
      select(Math.min(index + 1, rows.length - 1));
      break;
    case "ArrowUp":
      select(Math.max(index - 1, 0));
      break;
    case "Home":
      select(0);
      break;
    case "End":
      select(rows.length - 1);
      break;
    case "ArrowRight":
      if (current?.hasChildren === true && current.collapsed) {
        event.preventDefault();
        state.toggleCollapsed(current.id);
      }
      break;
    case "ArrowLeft":
      if (current?.hasChildren === true && !current.collapsed) {
        event.preventDefault();
        state.toggleCollapsed(current.id);
      }
      break;
    default:
      break;
  }
}

/**
 * Props of the tab views: the panel's {@link PanelState}.
 *
 * @since 1.0.0
 */
export interface TabProps {
  /**
   * The panel's state.
   */
  state: PanelState;
}

/**
 * The Components tab, rendered by the panel from a {@link TabProps} `state`. It shows a filter box, a
 * components-only switch, the owners tree (every reactive node: components, owners, memos, effects,
 * signals, resources and stores) with each row's kind letter, value and re-run count, and the details of
 * the selected node below it. Hovering a row highlights its component on the page.
 *
 * Internal to the panel: the package index does not export this component. Used in development builds
 * only.
 *
 * @internal
 */
export const TreeTab: Component<TabProps> = (props) => (
  <div class="split">
    <div class="toolbar">
      <input
        class="input"
        type="search"
        placeholder="Filter by name, kind or value"
        aria-label="Filter"
        value={props.state.filter()}
        on:input={(event) => props.state.setFilter(event.currentTarget.value)}
      />
      <label>
        <input
          type="checkbox"
          checked={props.state.componentsOnly()}
          on:change={(event) => props.state.setComponentsOnly(event.currentTarget.checked)}
        />{" "}
        components only
      </label>
    </div>
    <div
      class="list"
      role="tree"
      aria-label="Reactive nodes"
      on:keydown={(event) => navigate(props.state, event)}
    >
      <Show
        when={props.state.rows().rows.length > 0}
        fallback={<div class="empty">Nothing recorded yet. Interact with the app.</div>}
      >
        <For each={props.state.rows().rows} key={(row) => row.id}>
          {(row) => <TreeRowView state={props.state} row={row()} />}
        </For>
      </Show>
      <Show when={props.state.rows().hidden > 0}>
        <div class="more">
          <button type="button" class="btn" on:click={() => props.state.showMoreRows()}>
            Show more ({props.state.rows().hidden} hidden)
          </button>
        </div>
      </Show>
    </div>
    <Show when={props.state.selectedNode() !== undefined}>
      <Details state={props.state} />
    </Show>
  </div>
);
