import { For, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import type { TabProps } from "./tree";

/**
 * The Issues tab. Props: `state` is the panel's {@link PanelState}. It lists the errors the runtime reported,
 * with their diagnostic code when there is one and a link to the node they belong to, then the hydration
 * mismatches: the runtime's message, the expected value (labeled server) and the actual value (labeled
 * client).
 *
 * Internal to the panel: the package index does not export this component. Used in development builds
 * only.
 *
 * @internal
 */
export const IssuesTab: Component<TabProps> = (props) => (
  <section class="list" aria-label="Issues">
    <Show
      when={props.state.errors().length + props.state.hydration().length > 0}
      fallback={<div class="empty">No errors or hydration mismatches.</div>}
    >
      <For each={props.state.errors()} key={(error) => error.seq}>
        {(error) => (
          <div class="issue" data-issue="error">
            <Show when={error().code !== undefined}>
              <code>{error().code}</code>{" "}
            </Show>
            {error().message}
            <Show when={error().id !== 0}>
              {" "}
              <button type="button" class="link" on:click={() => props.state.select(error().id)}>
                {props.state.nameOf(error().id)}
              </button>
            </Show>
          </div>
        )}
      </For>
      <For each={props.state.hydration()} key={(mismatch) => mismatch.seq}>
        {(mismatch) => (
          <div class="issue" data-issue="hydration">
            <strong>Hydration mismatch:</strong> {mismatch().message}
            <div class="status">server: {mismatch().expected}</div>
            <div class="status">client: {mismatch().actual}</div>
          </div>
        )}
      </For>
    </Show>
  </section>
);
