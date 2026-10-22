import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { createLocalBackend } from "../src/backend";
import { installHook, uninstallHook } from "../src/hook";
import { EVENT } from "../src/protocol";

afterEach(() => uninstallHook());

function setup() {
  const hook = installHook();
  if (hook === undefined) throw new Error("no hook");
  const agent = createAgent();
  agent.attach(hook);
  return { hook, agent };
}

describe("[DVT-19] the local backend", () => {
  it("[DVT-19.1] shares the agent's model, is ready at once and notifies after events", async () => {
    const { hook, agent } = setup();
    const backend = createLocalBackend(agent);
    expect(backend.model).toBe(agent.model);
    await backend.ready;
    let notified = 0;
    backend.subscribe(() => {
      notified += 1;
    });
    hook.report(EVENT.OWNER_CREATED, {}, null, "root", "App");
    expect(notified).toBe(0);
    await Promise.resolve();
    expect(notified).toBe(1);
    expect(backend.model.nodes.size).toBe(1);
  });

  it("[DVT-19.2] requests go to the agent; highlight goes to the page hooks instead", async () => {
    const { agent } = setup();
    const highlighted: Array<number | null> = [];
    const backend = createLocalBackend(agent, { highlight: (id) => highlighted.push(id) });
    expect(await backend.request({ type: "stats" })).toMatchObject({ ok: true });
    expect(await backend.request({ type: "highlight", id: 3 })).toEqual({ ok: true, result: null });
    expect(highlighted).toEqual([3]);
    const bare = createLocalBackend(agent);
    expect(await bare.request({ type: "highlight", id: null })).toEqual({ ok: true, result: null });
  });

  it("[DVT-19.3] unsubscribe and dispose stop notifications; requests then reject", async () => {
    const { hook, agent } = setup();
    const backend = createLocalBackend(agent);
    let notified = 0;
    const off = backend.subscribe(() => {
      notified += 1;
    });
    backend.subscribe(() => {
      notified += 10;
    });
    off();
    hook.report(EVENT.OWNER_CREATED, {}, null, "root", "A");
    await Promise.resolve();
    expect(notified).toBe(10);
    backend.dispose();
    hook.report(EVENT.OWNER_CREATED, {}, null, "root", "B");
    await Promise.resolve();
    expect(notified).toBe(10);
    await expect(backend.request({ type: "stats" })).rejects.toThrow("disposed");
  });
});
