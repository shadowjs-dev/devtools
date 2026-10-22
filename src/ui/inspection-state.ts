import { type Accessor, useSignal } from "@shadow-js/core";
import type { Backend } from "../backend";
import { type InspectionSnapshot, parseInspectResult } from "../inspection";

/**
 * What the inspection views of a remote panel read and write: the registered sources, the one on
 * screen, and the state of the last request. Built by {@link createInspectionState}.
 *
 * @since 1.0.0
 */
export interface InspectionState {
  /** The sources the page answered with at the last refresh (empty before the first one). */
  readonly sources: Accessor<readonly InspectionSnapshot[]>;
  /** The name of the source on screen, or `""` when there is none. */
  readonly active: Accessor<string>;
  /** The reason the last refresh failed, or `""` when it did not. */
  readonly error: Accessor<string>;
  /** True while a refresh is waiting for the page. */
  readonly loading: Accessor<boolean>;
  /** Shows the source registered as `name`. Ignored when no source has that name. */
  select(name: string): void;
  /** Asks the page for its sources now. Resolves when the answer arrived (or failed). */
  refresh(): Promise<void>;
}

/**
 * The state of the inspection views of a panel (the router and query tabs): it asks the agent for the
 * registered sources, keeps the answer, and remembers which source is shown. It talks only to a
 * {@link Backend}, so it works for a local agent and for a remote one. An answer that does not have
 * the expected shape is refused and reported as an error; the previous sources stay.
 *
 * @param backend The backend to ask.
 * @returns The inspection state.
 * @example
 * import { createInspectionState, createLocalBackend, createAgent } from "@shadow-js/devtools";
 *
 * const state = createInspectionState(createLocalBackend(createAgent()));
 * await state.refresh();
 * state.sources(); // the registered sources
 * @since 1.0.0
 */
export function createInspectionState(backend: Backend): InspectionState {
  const [sources, setSources] = useSignal<readonly InspectionSnapshot[]>([]);
  const [active, setActive] = useSignal("");
  const [error, setError] = useSignal("");
  const [loading, setLoading] = useSignal(false);

  const select = (name: string): void => {
    if (sources().some((source) => source.name === name)) setActive(name);
  };

  const refresh = async (): Promise<void> => {
    setLoading(true);
    try {
      const response = await backend.request({ type: "inspect" });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      const parsed = parseInspectResult(response.result);
      if (parsed === null) {
        setError("The page answered the inspect request with an unexpected value.");
        return;
      }
      setSources(parsed);
      setError("");
      if (!parsed.some((source) => source.name === active())) {
        setActive(parsed[0]?.name ?? "");
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The request failed.");
    } finally {
      setLoading(false);
    }
  };

  return { sources, active, error, loading, select, refresh };
}
