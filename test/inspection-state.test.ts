import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { type Backend, createLocalBackend } from "../src/backend";
import { installHook, uninstallHook } from "../src/hook";
import {
  type InspectionSource,
  parseInspectResult,
  registerInspection,
  routerInspection,
} from "../src/inspection";
import { MAX_INSPECTION_ROWS, MAX_INSPECTIONS } from "../src/protocol";
import { createInspectionState } from "../src/ui/inspection-state";

afterEach(() => uninstallHook());

/** A source with one row, named after its title. */
function source(title: string): InspectionSource {
  return { title, rows: () => [{ id: title, label: title, detail: "", state: "ok" }] };
}

/** A real local backend with two registered sources. */
function backendWithSources(): Backend {
  const hook = installHook();
  if (hook === undefined) throw new Error("hook not installed");
  const agent = createAgent();
  agent.attach(hook);
  registerInspection("alpha", source("Alpha"));
  registerInspection("beta", source("Beta"));
  return createLocalBackend(agent);
}

describe("[DVT-INSP-S] the inspection views of a panel ask the page and keep its answer", () => {
  it("[DVT-INSP-S.1] refresh loads every registered source, shows the first one and select switches", async () => {
    const backend = backendWithSources();
    const state = createInspectionState(backend);
    expect(state.sources()).toEqual([]);
    await state.refresh();
    expect(state.sources().map((entry) => entry.name)).toEqual(["alpha", "beta"]);
    expect(state.active()).toBe("alpha");
    expect(state.error()).toBe("");
    expect(state.loading()).toBe(false);
    state.select("beta");
    expect(state.active()).toBe("beta");
    state.select("missing");
    expect(state.active()).toBe("beta");
  });

  it("[DVT-INSP-S.2] a refresh keeps the shown source when it is still registered", async () => {
    const backend = backendWithSources();
    const state = createInspectionState(backend);
    await state.refresh();
    state.select("beta");
    await state.refresh();
    expect(state.active()).toBe("beta");
  });

  it("[DVT-INSP-S.3] an answer of the wrong shape is refused: the error is set and the sources stay", async () => {
    const backend = backendWithSources();
    const state = createInspectionState(backend);
    await state.refresh();
    const forged: Backend = {
      ...backend,
      request: () => Promise.resolve({ ok: true, result: { sources: [{ name: 1 }] } }),
    };
    const refused = createInspectionState(forged);
    await refused.refresh();
    expect(refused.sources()).toEqual([]);
    expect(refused.error()).toBe("The page answered the inspect request with an unexpected value.");
    expect(refused.loading()).toBe(false);
  });

  it("[DVT-INSP-S.4] a failed response and a rejected request both set the error and clear loading", async () => {
    const backend = backendWithSources();
    const failed = createInspectionState({
      ...backend,
      request: () => Promise.resolve({ ok: false, error: "Editing is not enabled." }),
    });
    await failed.refresh();
    expect(failed.error()).toBe("Editing is not enabled.");
    expect(failed.loading()).toBe(false);

    const gone = createInspectionState({
      ...backend,
      request: () => Promise.reject(new Error("The devtools backend was disposed.")),
    });
    await gone.refresh();
    expect(gone.error()).toBe("The devtools backend was disposed.");
    expect(gone.loading()).toBe(false);
  });

  it("[DVT-INSP-S.5] the router view reads the router of the page: a refresh shows the new location", async () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const agent = createAgent();
    agent.attach(hook);
    let pathname = "/home";
    registerInspection(
      "router",
      routerInspection({
        state: {
          location: () => ({ pathname, search: "", hash: "" }),
          status: () => "idle",
          pending: () => false,
          error: () => undefined,
          matches: () => [],
        },
      }),
    );
    const state = createInspectionState(createLocalBackend(agent));
    await state.refresh();
    expect(state.sources()[0]?.rows[0]?.detail).toBe("/home");
    pathname = "/about";
    await state.refresh();
    expect(state.sources()[0]?.rows[0]?.detail).toBe("/about");
  });
});

describe("[DVT-INSP-P] the answer of an inspect request is validated before the panel uses it", () => {
  it("[DVT-INSP-P.1] a well-formed answer is parsed; anything else is null", () => {
    expect(parseInspectResult({ sources: [] })).toEqual([]);
    expect(parseInspectResult({ sources: [{ name: "a", title: "A", rows: [] }] })).toEqual([
      { name: "a", title: "A", rows: [] },
    ]);
    expect(parseInspectResult(null)).toBeNull();
    expect(parseInspectResult({ sources: "nope" })).toBeNull();
    expect(
      parseInspectResult({ sources: [{ name: "a", title: "A", rows: [{ id: 1 }] }] }),
    ).toBeNull();
    expect(
      parseInspectResult({ sources: [{ name: "a", title: "A", rows: [], error: 3 }] }),
    ).toBeNull();
  });

  it("[DVT-INSP-P.2] the bounds hold: at most MAX_INSPECTIONS sources and MAX_INSPECTION_ROWS + 1 rows", () => {
    const sources = Array.from({ length: MAX_INSPECTIONS + 1 }, (_, index) => ({
      name: `s${index}`,
      title: "S",
      rows: [],
    }));
    expect(parseInspectResult({ sources })).toBeNull();
    const row = { id: "r", label: "l", detail: "d", state: "s" };
    const rows = Array.from({ length: MAX_INSPECTION_ROWS + 2 }, () => row);
    expect(parseInspectResult({ sources: [{ name: "a", title: "A", rows }] })).toBeNull();
  });
});
