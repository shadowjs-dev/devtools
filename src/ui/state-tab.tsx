import { For, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import { Details } from "./details";
import type { TabProps } from "./tree";

/**
 * The State tab. Props: `state` is the panel's {@link PanelState}. It lists every signal, store and
 * resource with its current value (and its write count when it is above zero). Selecting a row (click, Enter or Space) shows its
 * details; for signals and stores the details include a value editor, where a change is applied like any
 * other write.
 *
 * Internal to the panel: the package index does not export this component. Used in development builds
 * only.
 *
 * @internal
 */
export const StateTab: Component<TabProps> = (props) => {
  const items = () =>
    props.state
      .snapshot()
      .nodes.filter(
        (node) => node.type === "signal" || node.type === "store" || node.type === "resource",
      );
  return (
    <div class="split">
      <div class="list" role="listbox" aria-label="State">
        <Show
          when={items().length > 0}
          fallback={<div class="empty">No signals or stores yet.</div>}
        >
          <For each={items()} key={(node) => node.id}>
            {(node) => (
              <div
                class="row"
                role="option"
                data-id={node().id}
                tabIndex={0}
                aria-selected={props.state.selected() === node().id}
                on:click={() => props.state.select(node().id)}
                on:keydown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.state.select(node().id);
                  }
                }}
              >
                <span class={`kind ${node().type}`}>{node().type}</span>
                <span class="name">{props.state.nameOf(node().id)}</span>
                <span class="value">
                  {node().type === "resource" ? node().state : node().preview}
                </span>
                <Show when={node().writes > 0}>
                  <span class="updates" title="Writes">
                    ×{node().writes}
                  </span>
                </Show>
              </div>
            )}
          </For>
        </Show>
      </div>
      <Show when={props.state.selectedNode() !== undefined}>
        <Details state={props.state} />
      </Show>
    </div>
  );
};
