import { useSignal } from "@shadow-js/core";
import { For, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import type { Backend } from "../../../src/backend";
import type { InspectionState } from "../../../src/ui/inspection-state";
import type { PanelState } from "../../../src/ui/state";
import {
  computationNodes,
  matchesQuery,
  resourceNodes,
  signalNodes,
  storeEdits,
  storeNodes,
} from "./state";

/**
 * What every view reads: the panel's data (`state`), the backend (for store commands), the inspection
 * sources, and the search text.
 *
 * @since 1.0.0
 */
export interface ViewProps {
  /** The panel's data: the graph snapshot, the tree and the selection. */
  readonly state: PanelState;
  /** The backend, for the store commands. */
  readonly backend: Backend;
  /** The inspection sources (router and queries). */
  readonly inspections: InspectionState;
  /** The search text, read when a view renders. */
  readonly query: () => string;
}

/**
 * The text of a `store` answer, or `undefined` when the answer has another shape. The page's answer is
 * data from another process, so it is checked before it is used.
 *
 * @param result The `result` of an ok response.
 * @returns The editable text of the store.
 */
function textOf(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null) return undefined;
  const text: unknown = Reflect.get(result, "text");
  return typeof text === "string" ? text : undefined;
}

/**
 * The Components view: the owner tree as a tree widget (arrow keys, Home, End, Enter), with the selected
 * node's details beside it.
 *
 * @param props The view props.
 * @returns The view.
 * @since 1.0.0
 */
export const ComponentsView: Component<ViewProps> = (props) => {
  const rows = () => props.state.rows();
  const onKey = (event: KeyboardEvent): void => {
    const tree = event.currentTarget;
    const target = event.target;
    if (!(tree instanceof HTMLElement) || !(target instanceof HTMLElement)) return;
    const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const index = items.indexOf(target);
    const move = (to: number): void => {
      event.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, to))]?.focus();
    };
    if (index < 0) {
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) move(0);
      return;
    }
    const id = Number(target.getAttribute("data-id"));
    const row = rows().rows.find((entry) => entry.id === id);
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        return;
      case "ArrowUp":
        move(index - 1);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(items.length - 1);
        return;
      case "ArrowRight":
        if (row?.hasChildren === true && row.collapsed) {
          event.preventDefault();
          props.state.toggleCollapsed(id);
        }
        return;
      case "ArrowLeft":
        if (row?.hasChildren === true && !row.collapsed) {
          event.preventDefault();
          props.state.toggleCollapsed(id);
        }
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        props.state.select(id);
        return;
      default:
        return;
    }
  };
  return (
    <div class="split">
      <div class="tree" role="tree" aria-label="Components" on:keydown={onKey}>
        <Show
          when={rows().rows.length > 0}
          fallback={
            <p class="empty">
              No components yet. Render a ShadowJS app in development to see its tree.
            </p>
          }
        >
          <For each={rows().rows} key={(row) => row.id}>
            {(row) => (
              <div
                role="treeitem"
                class="row"
                data-id={row().id}
                aria-level={row().depth + 1}
                aria-expanded={row().hasChildren ? !row().collapsed : undefined}
                aria-selected={props.state.selected() === row().id}
                tabIndex={props.state.selected() === row().id ? 0 : -1}
                style={{ paddingInlineStart: `${8 + row().depth * 14}px` }}
                on:click={() => props.state.select(row().id)}
              >
                <span class="kind">{row().type}</span>
                <span class="name">{row().label}</span>
                <span class="value">{row().detail}</span>
              </div>
            )}
          </For>
        </Show>
        <Show when={rows().hidden > 0}>
          <button type="button" class="btn more" on:click={() => props.state.showMoreRows()}>
            Show more rows
          </button>
        </Show>
      </div>
      <aside class="details" aria-label="Selected node">
        <Show
          when={props.state.selectedNode() !== undefined}
          fallback={<p class="empty">Select a row to see its details.</p>}
        >
          <dl>
            <dt>Name</dt>
            <dd>{props.state.selectedNode()?.name ?? props.state.selectedNode()?.label}</dd>
            <dt>Kind</dt>
            <dd>{props.state.selectedNode()?.type}</dd>
            <dt>Id</dt>
            <dd>{props.state.selectedNode()?.id}</dd>
            <dt>Value</dt>
            <dd>{props.state.selectedNode()?.preview}</dd>
            <dt>Runs</dt>
            <dd>{props.state.selectedNode()?.runs}</dd>
          </dl>
        </Show>
      </aside>
    </div>
  );
};

/**
 * The Signals view: every signal with its current value and write count. The values update as the page
 * writes them, because the snapshot is recomputed when the model changes.
 *
 * @param props The view props.
 * @returns The view.
 * @since 1.0.0
 */
export const SignalsView: Component<ViewProps> = (props) => {
  const rows = () => signalNodes(props.state.snapshot().nodes, props.query());
  return (
    <section aria-label="Signals">
      <Show when={rows().length > 0} fallback={<p class="empty">No signals match.</p>}>
        <table>
          <caption class="sr-only">Signals and their current values</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Value</th>
              <th scope="col">Writes</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()} key={(node) => node.id}>
              {(node) => (
                <tr>
                  <th scope="row">{node().name ?? node().label}</th>
                  <td>{node().preview}</td>
                  <td>{node().writes}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
};

/**
 * The Stores view: the stores on the left; the selected store's JSON on the right, editable. Apply writes
 * each changed top-level key with a `store-set` request. A draft that cannot be applied says why.
 *
 * @param props The view props.
 * @returns The view.
 * @since 1.0.0
 */
export const StoresView: Component<ViewProps> = (props) => {
  const [selected, setSelected] = useSignal(0);
  const [draft, setDraft] = useSignal("");
  const [current, setCurrent] = useSignal<unknown>(undefined);
  const [message, setMessage] = useSignal<{ kind: "idle" | "ok" | "error"; text: string }>({
    kind: "idle",
    text: "",
  });
  const rows = () => storeNodes(props.state.snapshot().nodes, props.query());

  const load = async (id: number): Promise<void> => {
    const response = await props.backend.request({ type: "store", id });
    if (!response.ok) {
      setMessage({ kind: "error", text: response.error });
      return;
    }
    const text = textOf(response.result);
    if (text === undefined) {
      setMessage({ kind: "error", text: "The page sent an unexpected answer for this store." });
      return;
    }
    setDraft(text);
    try {
      setCurrent(JSON.parse(text));
    } catch {
      // The store holds a value JSON cannot show (a Date, a Map): it is shown, but cannot be edited.
      setCurrent(undefined);
      setMessage({ kind: "error", text: "This store holds values that are not plain JSON." });
    }
  };

  const choose = (id: number): void => {
    setSelected(id);
    setMessage({ kind: "idle", text: "" });
    void load(id);
  };

  const apply = async (): Promise<void> => {
    const id = selected();
    const plan = storeEdits(current(), draft());
    if (!plan.ok) {
      setMessage({ kind: "error", text: plan.error });
      return;
    }
    if (plan.edits.length === 0) {
      setMessage({ kind: "idle", text: "Nothing changed." });
      return;
    }
    for (const edit of plan.edits) {
      const response = await props.backend.request({
        type: "store-set",
        id,
        path: [...edit.path],
        text: edit.text,
      });
      if (!response.ok) {
        setMessage({ kind: "error", text: response.error });
        await load(id);
        return;
      }
    }
    await load(id);
    setMessage({ kind: "ok", text: `Applied ${plan.edits.length} change(s).` });
  };

  return (
    <div class="split">
      <div class="list" role="listbox" aria-label="Stores">
        <Show when={rows().length > 0} fallback={<p class="empty">No stores match.</p>}>
          <For each={rows()} key={(node) => node.id}>
            {(node) => (
              <div
                role="option"
                class="row"
                tabIndex={0}
                aria-selected={selected() === node().id}
                on:click={() => choose(node().id)}
                on:keydown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    choose(node().id);
                  }
                }}
              >
                <span class="name">{node().name ?? node().label}</span>
                <span class="value">{node().preview}</span>
              </div>
            )}
          </For>
        </Show>
      </div>
      <div class="details editor">
        <Show
          when={selected() !== 0}
          fallback={<p class="empty">Select a store to read and edit its JSON.</p>}
        >
          <label>
            <span class="sr-only">Store value as JSON</span>
            <textarea
              class="textarea"
              spellcheck={false}
              value={draft()}
              on:input={(event) => setDraft(event.currentTarget.value)}
            />
          </label>
          <div>
            <button type="button" class="btn" on:click={() => void apply()}>
              Apply
            </button>{" "}
            <button type="button" class="btn" on:click={() => void load(selected())}>
              Reload
            </button>
          </div>
        </Show>
        <p
          class={message().kind === "error" ? "error" : "note"}
          role={message().kind === "error" ? "alert" : "status"}
        >
          {message().text}
        </p>
      </div>
    </div>
  );
};

/**
 * The Effects view: every effect and memo, with how often it ran and how long its last run took.
 *
 * @param props The view props.
 * @returns The view.
 * @since 1.0.0
 */
export const EffectsView: Component<ViewProps> = (props) => {
  const rows = () => computationNodes(props.state.snapshot().nodes, props.query());
  return (
    <section aria-label="Effects">
      <Show when={rows().length > 0} fallback={<p class="empty">No effects match.</p>}>
        <table>
          <caption class="sr-only">Effects and memos, their runs and durations</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Kind</th>
              <th scope="col">Runs</th>
              <th scope="col">Updates</th>
              <th scope="col">Last run (ms)</th>
              <th scope="col">Total (ms)</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()} key={(node) => node.id}>
              {(node) => (
                <tr>
                  <th scope="row">{node().name ?? node().label}</th>
                  <td>{node().type}</td>
                  <td>{node().runs}</td>
                  <td>{node().updates}</td>
                  <td>{node().lastDuration.toFixed(2)}</td>
                  <td>{node().totalDuration.toFixed(2)}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
};

/**
 * The Resources view: every resource with its last reported state.
 *
 * @param props The view props.
 * @returns The view.
 * @since 1.0.0
 */
export const ResourcesView: Component<ViewProps> = (props) => {
  const rows = () => resourceNodes(props.state.snapshot().nodes, props.query());
  return (
    <section aria-label="Resources">
      <Show when={rows().length > 0} fallback={<p class="empty">No resources match.</p>}>
        <table>
          <caption class="sr-only">Resources and their states</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()} key={(node) => node.id}>
              {(node) => (
                <tr>
                  <th scope="row">{node().name ?? node().label}</th>
                  <td>{node().state}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
};

/**
 * One inspection source as a table (the router or the query cache). The rows are text the page sent, so
 * they are shown as text. A source the app did not register says how to register it.
 *
 * @param props The source name, its hint and the view props.
 * @returns The view.
 * @since 1.0.0
 */
export const InspectionView: Component<
  ViewProps & { name: string; hint: string; label: string }
> = (props) => {
  const source = () => props.inspections.sources().find((entry) => entry.name === props.name);
  const rows = () =>
    (source()?.rows ?? []).filter((row) =>
      matchesQuery(`${row.label} ${row.detail} ${row.state}`, props.query()),
    );
  return (
    <section aria-label={props.label}>
      <Show when={source() !== undefined} fallback={<p class="empty">{props.hint}</p>}>
        <Show when={source()?.error !== undefined}>
          <p class="error" role="alert">
            {source()?.error}
          </p>
        </Show>
        <table>
          <caption class="sr-only">{source()?.title ?? props.label}</caption>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Details</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            <For each={rows()} key={(row) => row.id}>
              {(row) => (
                <tr>
                  <th scope="row">{row().label}</th>
                  <td>{row().detail}</td>
                  <td>{row().state}</td>
                </tr>
              )}
            </For>
          </tbody>
        </table>
      </Show>
    </section>
  );
};

/**
 * The Issues view: the errors the runtime reported and the hydration mismatches, newest first.
 *
 * @param props The view props.
 * @returns The view.
 * @since 1.0.0
 */
export const IssuesView: Component<ViewProps> = (props) => (
  <section aria-label="Issues">
    <Show
      when={props.state.errors().length + props.state.hydration().length > 0}
      fallback={<p class="empty">No errors or hydration mismatches.</p>}
    >
      <For each={props.state.errors()} key={(error) => error.seq}>
        {(error) => (
          <p class="error">
            {error().code === undefined ? "" : `${error().code}: `}
            {error().message}
          </p>
        )}
      </For>
      <For each={props.state.hydration()} key={(mismatch) => mismatch.seq}>
        {(mismatch) => (
          <p>
            <strong>Hydration:</strong> {mismatch().message} (expected {mismatch().expected}, actual{" "}
            {mismatch().actual})
          </p>
        )}
      </For>
    </Show>
  </section>
);
