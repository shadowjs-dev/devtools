import { untrack, useEffect, useSignal } from "@shadow-js/core";
import { For, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import type { AgentRequest } from "../agent";
import type { SnapshotNode } from "../inspector";
import type { PanelState } from "./state";

interface NodeProps {
  state: PanelState;
  node: SnapshotNode;
}

/**
 * Shows the value of a signal or store as indented JSON, and edits it. Props: `state` is the panel's
 * {@link PanelState} and `node` is the selected node. Apply writes the text back through the agent, and a
 * successful write re-renders the app like any other write. Revert discards the edit. While the text is
 * being edited, the view does not overwrite it. A resource or a memo has no editor here.
 *
 * Internal to the panel: the package index does not export this component. Used in development builds
 * only.
 *
 * @internal
 */
export const ValueEditor: Component<NodeProps> = (props) => {
  const [text, setText] = useSignal("");
  const [dirty, setDirty] = useSignal(false);
  const [editable, setEditable] = useSignal(false);
  const [status, setStatus] = useSignal({ kind: "idle", text: "" });

  useEffect(() => {
    // Follow the value while it changes, unless the user is typing.
    props.state.version();
    const id = props.node.id;
    const store = props.node.type === "store";
    if (dirty()) return;
    // The request reads the value through the agent; the reads above are the only dependencies.
    const request = untrack(() =>
      props.state.backend.request(store ? { type: "store", id } : { type: "value", id }),
    );
    void request.then((response) => {
      if (!response.ok) {
        setStatus({ kind: "bad", text: response.error });
        return;
      }
      const result = response.result as { text: string; editable: boolean };
      setText(result.text);
      setEditable(result.editable);
    });
  });

  const apply = (): void => {
    const id = props.node.id;
    const request: AgentRequest =
      props.node.type === "store"
        ? { type: "store-set", id, path: [], text: text() }
        : { type: "write", id, text: text() };
    void props.state.backend.request(request).then((response) => {
      if (response.ok) {
        setDirty(false);
        setStatus({ kind: "good", text: "Applied." });
        props.state.refresh();
      } else {
        setStatus({ kind: "bad", text: response.error });
      }
    });
  };

  return (
    <div class="section" data-editor={props.node.type}>
      <h4>Value</h4>
      <textarea
        class="textarea"
        aria-label="Value"
        spellcheck={false}
        readOnly={!editable()}
        value={text()}
        on:input={(event) => {
          setText(event.currentTarget.value);
          setDirty(true);
          setStatus({ kind: "idle", text: "" });
        }}
      />
      <div>
        <Show when={editable()}>
          <button type="button" class="btn" disabled={!dirty()} on:click={apply}>
            Apply
          </button>{" "}
        </Show>
        <Show when={dirty()}>
          <button
            type="button"
            class="btn"
            on:click={() => {
              setDirty(false);
              props.state.refresh();
            }}
          >
            Revert
          </button>{" "}
        </Show>
        <span class={`status ${status().kind}`} role="status">
          {status().text}
        </span>
      </div>
    </div>
  );
};

/** Props of {@link Details}. */
interface DetailsProps {
  state: PanelState;
}

/**
 * The selected node: its name and kind, its counters (runs, updates and durations for memos and effects),
 * what it reads, who reads it, why it last ran (memos and effects), and a {@link ValueEditor} for signals
 * and stores. Props: `state` is the panel's {@link PanelState}. It renders nothing when no node is
 * selected.
 *
 * Internal to the panel: the package index does not export this component. Used in development builds
 * only.
 *
 * @internal
 */
export const Details: Component<DetailsProps> = (props) => (
  <Show when={props.state.selectedNode()}>
    {(node) => (
      <section class="detail" aria-label="Details">
        <div class="section">
          <strong>{props.state.nameOf(node().id)}</strong>{" "}
          <span class="status">
            {node().type} #{node().id}
          </span>
          <Show when={node().type === "memo" || node().type === "effect"}>
            <div class="status">
              {node().runs} runs · {node().updates} updates · last {node().lastDuration.toFixed(2)}{" "}
              ms · total {node().totalDuration.toFixed(2)} ms
            </div>
          </Show>
        </div>
        <Show when={node().sources.length > 0}>
          <div class="section">
            <h4>Reads</h4>
            <For each={node().sources}>
              {(id) => (
                <span>
                  <button type="button" class="link" on:click={() => props.state.select(id)}>
                    {props.state.nameOf(id)}
                  </button>{" "}
                </span>
              )}
            </For>
          </div>
        </Show>
        <Show when={node().observers.length > 0}>
          <div class="section">
            <h4>Read by</h4>
            <For each={node().observers}>
              {(id) => (
                <span>
                  <button type="button" class="link" on:click={() => props.state.select(id)}>
                    {props.state.nameOf(id)}
                  </button>{" "}
                </span>
              )}
            </For>
          </div>
        </Show>
        <Show when={props.state.explanation()}>
          {(why) => (
            <div class="section" data-why>
              <h4>Why did it run?</h4>
              <ol class="chain">
                <For each={why().chain}>
                  {(step) => (
                    <li>
                      {step.kind === "write" ? "write " : step.kind === "run" ? "ran " : ""}
                      <strong>{step.label}</strong>
                      <Show when={step.preview !== undefined}> = {step.preview}</Show>
                      <Show when={step.writer !== undefined}> (written by {step.writer})</Show>
                    </li>
                  )}
                </For>
              </ol>
              <Show when={why().alsoCausedBy.length > 0}>
                <div class="status">
                  Also changed:{" "}
                  {why()
                    .alsoCausedBy.map((step) => step.label)
                    .join(", ")}
                </div>
              </Show>
              <Show when={why().truncated}>
                <div class="status">Older history was dropped.</div>
              </Show>
            </div>
          )}
        </Show>
        <Show when={node().type === "signal" || node().type === "store"}>
          <ValueEditor state={props.state} node={node()} />
        </Show>
      </section>
    )}
  </Show>
);
