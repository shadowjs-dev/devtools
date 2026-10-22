import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import { snapshotOf } from "../src/inspector";
import { EVENT } from "../src/protocol";
import { instrument } from "./support/instrument";

afterEach(() => {
  uninstallHook({ target: {} });
  document.body.innerHTML = "";
});

describe("[DVT-06] the agent and the DOM", () => {
  it("[DVT-06.18] a component the model cannot keep is not remembered, so nothing is highlighted", () => {
    const hook = installHook({ target: {} });
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent({ limits: { maxNodes: 1 } });
    agent.attach(hook);
    const root = {};
    hook.report(EVENT.OWNER_CREATED, root, null, "root", "App");
    // Beyond maxNodes: the agent names it (id 2) but the model ignores it.
    const box = {};
    hook.report(EVENT.OWNER_CREATED, box, root, "owner", "Box");
    const element = document.createElement("div");
    document.body.appendChild(element);
    hook.report(EVENT.COMPONENT_MOUNTED, box, "Box", element);
    expect(agent.model.overflow).toBe(1);
    expect(agent.nodesOf(2)).toEqual([]);
  });

  it("[DVT-06.14] a component keeps weak references to its DOM nodes", () => {
    const hook = installHook({ target: {} });
    if (hook === undefined) throw new Error("no hook");
    const agent = createAgent();
    agent.attach(hook);
    const rt = instrument(hook);
    const element = document.createElement("div");
    document.body.appendChild(element);
    const { owner } = rt.component("Box", () => 1, element);
    const id = agent.snapshot().nodes.find((node) => node.name === "Box")?.id ?? -1;
    expect(agent.nodesOf(id)).toEqual([element]);
    element.remove();
    expect(agent.nodesOf(id)).toEqual([]);
    rt.dispose(owner);
    expect(agent.nodesOf(id)).toEqual([]);
    expect(snapshotOf(agent.model).nodes).toEqual([]);
  });
});
