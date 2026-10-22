import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import {
  type InspectionRow,
  type InspectionSource,
  type QueryLike,
  queryInspection,
  type RouterLike,
  readInspections,
  registerInspection,
  routerInspection,
  sanitizeRows,
} from "../src/inspection";
import { MAX_INSPECTION_ROWS, MAX_INSPECTIONS } from "../src/protocol";

afterEach(() => uninstallHook());

/** A router whose state the test sets; it reads like `Router.state` (accessors). */
function fakeRouter(state: {
  location?: { pathname: string; search: string; hash: string } | undefined;
  status?: string;
  pending?: boolean;
  error?: unknown;
  matches?: { id: string; pattern: string; params: Record<string, string> }[];
}): RouterLike {
  return {
    state: {
      location: () => state.location,
      status: () => state.status ?? "idle",
      pending: () => state.pending ?? false,
      error: () => state.error,
      matches: () => state.matches ?? [],
    },
  };
}

/** A query client whose cache lists the given snapshots, as `QueryCacheView.find` does. */
function fakeQueries(
  queries: {
    queryKey: unknown;
    queryHash: string;
    status: string;
    fetchStatus: string;
    dataUpdatedAt: number;
    isInvalidated: boolean;
    observers: number;
  }[],
): QueryLike & { subscribers(): number; emit(): void } {
  const listeners = new Set<() => void>();
  return {
    queryCache: {
      find: () => queries,
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    subscribers: () => listeners.size,
    emit: () => {
      for (const listener of [...listeners]) listener();
    },
  };
}

describe("[DVT-INSP] inspection sources describe the router and the query cache", () => {
  it("[DVT-INSP.1] the router source lists the location, the pending flag and the matched routes", () => {
    const source = routerInspection(
      fakeRouter({
        location: { pathname: "/users/7", search: "?tab=posts", hash: "#top" },
        status: "loading",
        pending: true,
        matches: [{ id: "users", pattern: "/users/:id", params: { id: "7" } }],
      }),
    );
    expect(source.title).toBe("Router");
    expect(source.rows()).toEqual([
      { id: "location", label: "location", detail: "/users/7?tab=posts#top", state: "loading" },
      { id: "pending", label: "pending", detail: "true", state: "pending" },
      { id: "match:0", label: "/users/:id", detail: '{"id":"7"}', state: "users" },
    ]);
  });

  it("[DVT-INSP.2] the router source shows the error only when there is one, and no location before the first navigation", () => {
    const quiet = routerInspection(fakeRouter({})).rows();
    expect(quiet.map((row) => row.id)).toEqual(["location", "pending"]);
    expect(quiet[0]?.detail).toBe("none");
    const failed = routerInspection(fakeRouter({ error: new Error("404 at /x") })).rows();
    expect(failed.find((row) => row.id === "error")).toEqual({
      id: "error",
      label: "error",
      detail: "Error: 404 at /x",
      state: "errored",
    });
  });

  it("[DVT-INSP.3] the query source has one row per query: key, fetch state, observers, age and invalidation", () => {
    const source = queryInspection(
      fakeQueries([
        {
          queryKey: ["todos", 1],
          queryHash: '["todos",1]',
          status: "success",
          fetchStatus: "idle",
          dataUpdatedAt: Date.UTC(2026, 0, 2),
          isInvalidated: false,
          observers: 2,
        },
        {
          queryKey: ["users"],
          queryHash: '["users"]',
          status: "pending",
          fetchStatus: "fetching",
          dataUpdatedAt: 0,
          isInvalidated: true,
          observers: 0,
        },
      ]),
    );
    expect(source.title).toBe("Queries");
    expect(source.rows()).toEqual([
      {
        id: '["todos",1]',
        label: '["todos",1]',
        detail: "idle, 2 observers, updated 2026-01-02T00:00:00.000Z",
        state: "success",
      },
      {
        id: '["users"]',
        label: '["users"]',
        detail: "fetching, 0 observers, invalidated, never updated",
        state: "pending",
      },
    ]);
  });

  it("[DVT-INSP.4] sources read the router and the cache when asked, not when they were registered", () => {
    let pathname = "/a";
    const router = fakeRouter({});
    (
      router.state as { location: () => { pathname: string; search: string; hash: string } }
    ).location = () => ({ pathname, search: "", hash: "" });
    const source = routerInspection(router);
    expect(source.rows()[0]?.detail).toBe("/a");
    pathname = "/b";
    expect(source.rows()[0]?.detail).toBe("/b");
  });
});

describe("[DVT-INSP-Q] a query client without the inspection feature", () => {
  it("[DVT-INSP.5] reads the cache, and its subscribe is a no-op that stops cleanly, since the client cannot notify", () => {
    const client: QueryLike = {
      queryCache: {
        find: () => [],
        subscribe() {
          throw new TypeError(
            '[shadow-query] queryCache.subscribe needs the inspection feature: import { inspection } from "@shadow-js/query/inspection".',
          );
        },
      },
    };
    const source = queryInspection(client);
    const stop = source.subscribe?.(() => undefined);
    expect(typeof stop).toBe("function");
    expect(() => stop?.()).not.toThrow();
    expect(source.rows()).toEqual([]);
  });

  it("[DVT-INSP.6] any other error from subscribe still reaches the caller", () => {
    const broken: QueryLike = {
      queryCache: {
        find: () => [],
        subscribe() {
          throw new Error("subscribe broke");
        },
      },
    };
    expect(() => queryInspection(broken).subscribe?.(() => undefined)).toThrow("subscribe broke");
  });
});

describe("[DVT-INSP-B] the inspection rows are bounded and plain", () => {
  it("[DVT-INSP-B.1] at most MAX_INSPECTION_ROWS rows are sent, and the last one says how many were cut", () => {
    const rows: InspectionRow[] = Array.from({ length: MAX_INSPECTION_ROWS + 25 }, (_, index) => ({
      id: `r${index}`,
      label: "x",
      detail: "y",
      state: "z",
    }));
    const out = sanitizeRows(rows);
    expect(out).toHaveLength(MAX_INSPECTION_ROWS + 1);
    expect(out[MAX_INSPECTION_ROWS]).toEqual({
      id: "truncated",
      label: "…",
      detail: "25 more rows not shown",
      state: "truncated",
    });
  });

  it("[DVT-INSP-B.2] every field is text of at most 200 characters, so no object or long string crosses to the panel", () => {
    const out = sanitizeRows([
      {
        id: 42 as unknown as string,
        label: "l".repeat(500),
        detail: { secret: 1 } as unknown as string,
        state: "s",
      },
    ]);
    expect(out[0]?.id).toBe("42");
    expect(out[0]?.label).toHaveLength(200);
    expect(out[0]?.label.endsWith("…")).toBe(true);
    expect(out[0]?.detail).toBe("[object Object]");
  });

  it("[DVT-INSP-B.3] a source that throws is reported with its error and no rows", () => {
    const broken: InspectionSource = {
      title: "Broken",
      rows: () => {
        throw new Error("cache is locked");
      },
    };
    const [snapshot] = readInspections([{ name: "broken", source: broken }]);
    expect(snapshot).toEqual({
      name: "broken",
      title: "Broken",
      rows: [],
      error: "Error: cache is locked",
    });
  });
});

describe("[DVT-INSP-R] apps register sources on the hook, and the agent answers the panel", () => {
  it("[DVT-INSP-R.1] without an installed hook nothing is registered", () => {
    expect(registerInspection("router", routerInspection(fakeRouter({})))).toBe(false);
  });

  it("[DVT-INSP-R.2] a registered source is answered to an inspect request, with its rows read then", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const agent = createAgent();
    agent.attach(hook);
    let pathname = "/one";
    const router = fakeRouter({});
    (
      router.state as { location: () => { pathname: string; search: string; hash: string } }
    ).location = () => ({ pathname, search: "", hash: "" });
    expect(registerInspection("router", routerInspection(router))).toBe(true);
    pathname = "/two";
    const response = agent.handle({ type: "inspect" });
    expect(response.ok).toBe(true);
    const sources = response.ok
      ? (response.result as { sources: { name: string; rows: InspectionRow[] }[] }).sources
      : [];
    expect(sources.map((source) => source.name)).toEqual(["router"]);
    expect(sources[0]?.rows[0]?.detail).toBe("/two");
  });

  it("[DVT-INSP-R.3] re-registering a name replaces its source; new names beyond MAX_INSPECTIONS are refused", () => {
    const hook = installHook();
    if (hook === undefined) throw new Error("hook not installed");
    const agent = createAgent();
    agent.attach(hook);
    const source = (title: string): InspectionSource => ({ title, rows: () => [] });
    for (let index = 0; index < MAX_INSPECTIONS; index += 1) {
      expect(registerInspection(`s${index}`, source(`S${index}`))).toBe(true);
    }
    expect(registerInspection("extra", source("Extra"))).toBe(false);
    expect(registerInspection("s0", source("Replaced"))).toBe(true);
    expect(registerInspection("", source("Empty"))).toBe(false);
    const response = agent.handle({ type: "inspect" });
    const sources = response.ok
      ? (response.result as { sources: { name: string; title: string }[] }).sources
      : [];
    expect(sources).toHaveLength(MAX_INSPECTIONS);
    expect(sources[0]).toEqual({ name: "s0", title: "Replaced", rows: [] });
  });

  it("[DVT-INSP-R.4] without a registry (a hook that is not this package's) the agent answers an empty list", () => {
    const agent = createAgent();
    const response = agent.handle({ type: "inspect" });
    expect(response).toEqual({ ok: true, result: { sources: [] } });
  });
  it("[DVT-INSP.4] the query source subscribes to the cache: every change calls the listener, and the stop function removes it", () => {
    const client = fakeQueries([]);
    const source = queryInspection(client);
    const subscribe = source.subscribe;
    if (subscribe === undefined) throw new Error("the query source cannot subscribe");
    let changes = 0;
    const stop = subscribe(() => {
      changes += 1;
    });
    expect(client.subscribers()).toBe(1);
    client.emit();
    client.emit();
    expect(changes).toBe(2);
    stop();
    stop();
    expect(client.subscribers()).toBe(0);
    client.emit();
    expect(changes).toBe(2);
  });
});
