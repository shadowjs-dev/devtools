import { describe, expect, it } from "vitest";
import { createPageBridge, type PageWindow, type RuntimePort } from "../extension/src/bridge";
import { createAgent } from "../src/agent";
import { EVENT } from "../src/protocol";
import {
  type AgentMessage,
  CHANNEL,
  connectRemote,
  createMemoryTransportPair,
  serveAgent,
  type Transport,
} from "../src/transport";

/** A transport pair whose agent side answers every snapshot request with `answer`. */
function refusingAgent(answer: unknown): [Transport, Transport] {
  const [agentSide, panelSide] = createMemoryTransportPair();
  agentSide.listen((raw) => {
    if (typeof raw !== "object" || raw === null) return;
    if (Reflect.get(raw, "type") !== "request") return;
    agentSide.send({
      channel: CHANNEL,
      v: 1,
      from: "agent",
      type: "response",
      id: Reflect.get(raw, "id"),
      response: answer,
    });
  });
  return [agentSide, panelSide];
}

describe("[DEVT-R2-1] a snapshot the panel cannot get is shown as an error", () => {
  it("[DEVT-R2-1.1] a refused snapshot sets the backend's error, notifies, and leaves ready pending", async () => {
    const [, panelSide] = refusingAgent({ ok: false, error: "The page's answer was too large." });
    const backend = connectRemote(panelSide);
    let notified = 0;
    backend.subscribe(() => {
      notified += 1;
    });
    expect(backend.error?.()).toBeUndefined();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.error?.()).toBe("The page's answer was too large.");
    expect(notified).toBe(1);
    backend.dispose();
  });

  it("[DEVT-R2-1.2] a state with the wrong shape is also an error", async () => {
    const [, panelSide] = refusingAgent({ ok: true, result: { nope: true } });
    const backend = connectRemote(panelSide);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.error?.()).toMatch(/state/);
    backend.dispose();
  });

  it("[DEVT-R2-1.3] a later good state clears the error", async () => {
    const agent = createAgent();
    const [agentSide, panelSide] = createMemoryTransportPair();
    let refuse = true;
    const stop = serveAgent(agent, agentSide);
    // Sit between the panel and the served agent: the first snapshot is refused, the second passes.
    const wrapped: Transport = {
      send: (message) => panelSide.send(message),
      close: () => panelSide.close(),
      listen: (handler) =>
        panelSide.listen((raw) => {
          if (
            refuse &&
            typeof raw === "object" &&
            raw !== null &&
            Reflect.get(raw, "type") === "response"
          ) {
            refuse = false;
            handler({ ...raw, response: { ok: false, error: "first try failed" } });
            return;
          }
          handler(raw);
        }),
    };
    const backend = connectRemote(wrapped);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(backend.error?.()).toBe("first try failed");
    // A clear asks for a new snapshot, which succeeds.
    await backend.request({ type: "clear" });
    await backend.ready;
    expect(backend.error?.()).toBeUndefined();
    stop();
    backend.dispose();
  });
});

describe("[DEVT-R2-2] a panel notices that the agent behind the port is a new one", () => {
  it("[DEVT-R2-2.1] every message of a served agent carries the agent's instance id", async () => {
    const [agentSide, panelSide] = createMemoryTransportPair();
    const seen: AgentMessage[] = [];
    panelSide.listen((raw) => void seen.push(raw as AgentMessage));
    const agent = createAgent();
    serveAgent(agent, agentSide);
    panelSide.send({ channel: CHANNEL, v: 1, from: "panel", type: "hello" });
    agent.receive(EVENT.OWNER_CREATED, {}, null, "root", "x", undefined);
    agent.flush();
    const kinds = seen.map((message) => message.type);
    expect(kinds).toContain("hello");
    expect(kinds).toContain("events");
    const ids = new Set(seen.map((message) => message.instance));
    expect(ids.size).toBe(1);
    const [id] = [...ids];
    expect(typeof id).toBe("string");
    expect(id?.length).toBeGreaterThan(8);
    // A second served agent has another id.
    const [other, otherPanel] = createMemoryTransportPair();
    const otherSeen: AgentMessage[] = [];
    otherPanel.listen((raw) => void otherSeen.push(raw as AgentMessage));
    serveAgent(createAgent(), other);
    otherPanel.send({ channel: CHANNEL, v: 1, from: "panel", type: "hello" });
    expect(otherSeen[0]?.instance).not.toBe(id);
  });

  it("[DEVT-R2-2.2] a new agent whose first batch starts ABOVE the old sequence still replaces the old state", async () => {
    const [agentSide, panelSide] = createMemoryTransportPair();
    const first = createAgent();
    first.receive(EVENT.OWNER_CREATED, {}, null, "root", "old", undefined);
    const stopFirst = serveAgent(first, agentSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    expect(backend.model.lastSeq).toBe(1);

    stopFirst();
    const second = createAgent();
    for (let index = 0; index < 5; index += 1) {
      second.receive(EVENT.OWNER_CREATED, {}, null, "root", `fresh${index}`, undefined);
    }
    serveAgent(second, agentSide);
    second.receive(EVENT.OWNER_CREATED, {}, null, "root", "newest", undefined);
    second.flush();
    await backend.request({ type: "stats" });
    expect([...backend.model.nodes.values()].map((node) => node.name)).toEqual([
      "fresh0",
      "fresh1",
      "fresh2",
      "fresh3",
      "fresh4",
      "newest",
    ]);
    backend.dispose();
  });

  it("[DEVT-R2-2.3] a hello from another instance makes the panel ask for the state again", async () => {
    const [agentSide, panelSide] = createMemoryTransportPair();
    const first = createAgent();
    first.receive(EVENT.OWNER_CREATED, {}, null, "root", "old", undefined);
    const stopFirst = serveAgent(first, agentSide);
    const backend = connectRemote(panelSide);
    await backend.ready;
    stopFirst();
    const second = createAgent();
    second.receive(EVENT.OWNER_CREATED, {}, null, "root", "reloaded", undefined);
    serveAgent(second, agentSide);
    // The bridge asks the new agent to introduce itself after it reconnects.
    agentSide.send({ channel: CHANNEL, v: 1, from: "agent", type: "hello", instance: "other" });
    await backend.request({ type: "stats" });
    expect([...backend.model.nodes.values()].map((node) => node.name)).toEqual(["reloaded"]);
    backend.dispose();
  });
});

describe("[DEVT-R2-2] the bridge asks the agent to introduce itself after a reconnect", () => {
  it("[DEVT-R2-2.4] a reopened port makes the bridge post a panel hello to the page; the first port does not", () => {
    const posted: unknown[] = [];
    const page: PageWindow = {
      postMessage: (message) => void posted.push(message),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    let disconnect: () => void = () => undefined;
    const connect = (): RuntimePort => ({
      postMessage: () => undefined,
      disconnect: () => undefined,
      onMessage: { addListener: () => undefined, removeListener: () => undefined },
      onDisconnect: {
        addListener: (listener) => {
          disconnect = listener;
        },
      },
    });
    const later: Array<() => void> = [];
    createPageBridge({
      page,
      origin: "http://localhost:5173",
      connect,
      schedule: (fn) => void later.push(fn),
    });
    expect(posted).toEqual([]);
    disconnect();
    later.shift()?.();
    expect(posted).toEqual([{ channel: CHANNEL, v: 1, from: "panel", type: "hello" }]);
  });
});

describe("[DEVT-R2-4] the extension version follows the package", () => {
  it("[DEVT-R2-4.1] without an override the build uses the version of package.json; an override wins", async () => {
    const { extensionVersion } = await import("../extension/build.mjs");
    const { readFileSync } = await import("node:fs");
    const pkg: unknown = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    const version =
      typeof pkg === "object" && pkg !== null ? Reflect.get(pkg, "version") : undefined;
    expect(typeof version).toBe("string");
    expect(extensionVersion({})).toBe(version);
    expect(extensionVersion({ SHADOWJS_EXTENSION_VERSION: "" })).toBe(version);
    expect(extensionVersion({ SHADOWJS_EXTENSION_VERSION: "9.8.7" })).toBe("9.8.7");
  });

  it("[DEVT-R2-4.2] neither build script keeps a hard-coded default version", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of ["../extension/build.mjs", "../extension/zip.mjs"]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(text).not.toMatch(/\?\?\s*"\d+\.\d+\.\d+"/);
    }
  });
});
