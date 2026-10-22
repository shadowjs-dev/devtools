import { describe, expect, it } from "vitest";
import { inspectedPing, PAGE_PORT, PANEL_PORT } from "../../extension/src/bridge";
import { createRelay, type RelayPort } from "../../extension/src/relay";
import { PROTOCOL_VERSION } from "../../src/protocol";
import { CHANNEL } from "../../src/transport";

const EXTENSION = "abcdefghijklmnopabcdefghijklmnop";
const agentHello = { channel: CHANNEL, v: PROTOCOL_VERSION, from: "agent", type: "hello" };
const panelHello = { channel: CHANNEL, v: PROTOCOL_VERSION, from: "panel", type: "hello" };

/** A port the background receives, with the sender the browser attaches to it. */
function relayPort(
  name: string,
  sender: { id?: string; tab?: { id?: number } } | undefined,
): RelayPort & {
  posts: unknown[];
  disconnected: boolean;
  deliver(m: unknown): void;
  drop(): void;
} {
  const messages = new Set<(message: unknown) => void>();
  const drops = new Set<() => void>();
  return {
    name,
    sender,
    posts: [],
    disconnected: false,
    postMessage(message) {
      this.posts.push(message);
    },
    disconnect() {
      this.disconnected = true;
    },
    onMessage: {
      addListener: (listener) => messages.add(listener),
      removeListener: (listener) => messages.delete(listener),
    },
    onDisconnect: { addListener: (listener) => drops.add(listener) },
    deliver(message) {
      for (const listener of [...messages]) listener(message);
    },
    drop() {
      for (const listener of [...drops]) listener();
    },
  } as RelayPort & {
    posts: unknown[];
    disconnected: boolean;
    deliver(m: unknown): void;
    drop(): void;
  };
}

const pageSender = (tab: number) => ({ id: EXTENSION, tab: { id: tab } });
const panelSender = { id: EXTENSION };

describe("[DVT-EXT-RL] the background pairs a tab's page with its panel and forwards checked messages", () => {
  it("[DVT-EXT-RL.1] ports from another extension, or without a name, are closed", () => {
    const relay = createRelay({ extensionId: EXTENSION });
    const foreign = relayPort(PAGE_PORT, { id: "someone-else", tab: { id: 1 } });
    relay.connect(foreign);
    expect(foreign.disconnected).toBe(true);
    const unnamed = relayPort("unknown", panelSender);
    relay.connect(unnamed);
    expect(unnamed.disconnected).toBe(true);
    expect(relay.pages()).toBe(0);
  });

  it("[DVT-EXT-RL.2] a page port must come from a tab; a panel port must attach with an integer tab id first", () => {
    const relay = createRelay({ extensionId: EXTENSION });
    const tabless = relayPort(PAGE_PORT, { id: EXTENSION });
    relay.connect(tabless);
    expect(tabless.disconnected).toBe(true);
    const panel = relayPort(PANEL_PORT, panelSender);
    relay.connect(panel);
    panel.deliver(panelHello);
    expect(panel.disconnected).toBe(true);
    expect(relay.panels()).toBe(0);
  });

  it("[DVT-EXT-RL.3] an agent message reaches the panel of its own tab only", () => {
    const relay = createRelay({ extensionId: EXTENSION });
    const pageOne = relayPort(PAGE_PORT, pageSender(1));
    const pageTwo = relayPort(PAGE_PORT, pageSender(2));
    relay.connect(pageOne);
    relay.connect(pageTwo);
    const panelOne = relayPort(PANEL_PORT, panelSender);
    relay.connect(panelOne);
    panelOne.deliver({ type: "attach", tabId: 1 });
    pageOne.deliver(agentHello);
    pageTwo.deliver(agentHello);
    expect(panelOne.posts).toEqual([agentHello]);
    expect(relay.pages()).toBe(2);
    expect(relay.panels()).toBe(1);
  });

  it("[DVT-EXT-RL.4] a panel request reaches the page of its tab only when it is a panel message", () => {
    const relay = createRelay({ extensionId: EXTENSION });
    const page = relayPort(PAGE_PORT, pageSender(7));
    relay.connect(page);
    const panel = relayPort(PANEL_PORT, panelSender);
    relay.connect(panel);
    panel.deliver({ type: "attach", tabId: 7 });
    panel.deliver(panelHello);
    panel.deliver({ type: "exec", code: "alert(1)" });
    panel.deliver({ channel: CHANNEL, from: "agent", type: "hello" });
    expect(page.posts).toEqual([panelHello]);
  });

  it("[DVT-EXT-RL.5] a new port for a tab replaces the old one, and a dropped port is forgotten", () => {
    const relay = createRelay({ extensionId: EXTENSION });
    const oldPage = relayPort(PAGE_PORT, pageSender(3));
    relay.connect(oldPage);
    const newPage = relayPort(PAGE_PORT, pageSender(3));
    relay.connect(newPage);
    expect(oldPage.disconnected).toBe(true);
    expect(relay.pages()).toBe(1);
    newPage.drop();
    expect(relay.pages()).toBe(0);
    const panel = relayPort(PANEL_PORT, panelSender);
    relay.connect(panel);
    panel.deliver({ type: "attach", tabId: 3 });
    expect(relay.panels()).toBe(1);
    panel.drop();
    expect(relay.panels()).toBe(0);
  });

  it("[DVT-EXT-RL.6] a replaced panel is disconnected and its late drop does not remove the new one", () => {
    const relay = createRelay({ extensionId: EXTENSION });
    const first = relayPort(PANEL_PORT, panelSender);
    relay.connect(first);
    first.deliver({ type: "attach", tabId: 4 });
    const second = relayPort(PANEL_PORT, panelSender);
    relay.connect(second);
    second.deliver({ type: "attach", tabId: 4 });
    expect(first.disconnected).toBe(true);
    first.drop();
    expect(relay.panels()).toBe(1);
  });
});

describe("[DVT-EXT-RL2] the relay answers a page list and forwards inspection pings", () => {
  it("[DVT-EXT-RL2.1] a panel that asks for the pages gets the sorted tab ids, and stays connected to attach afterward", () => {
    const relay = createRelay({ extensionId: EXTENSION });
    relay.connect(relayPort(PAGE_PORT, pageSender(5)));
    relay.connect(relayPort(PAGE_PORT, pageSender(2)));
    const panel = relayPort(PANEL_PORT, panelSender);
    relay.connect(panel);
    panel.deliver({ type: "pages" });
    expect(panel.posts).toEqual([{ type: "pages", tabIds: [2, 5] }]);
    expect(panel.disconnected).toBe(false);
    const page = relayPort(PAGE_PORT, pageSender(2));
    relay.connect(page);
    panel.deliver({ type: "attach", tabId: 2 });
    page.deliver(inspectedPing());
    expect(panel.posts).toHaveLength(2);
  });

  it("[DVT-EXT-RL2.2] an inspected ping reaches the panel of its own tab only, and a malformed ping is dropped", () => {
    const relay = createRelay({ extensionId: EXTENSION });
    const pageOne = relayPort(PAGE_PORT, pageSender(1));
    const pageTwo = relayPort(PAGE_PORT, pageSender(2));
    relay.connect(pageOne);
    relay.connect(pageTwo);
    const panelOne = relayPort(PANEL_PORT, panelSender);
    relay.connect(panelOne);
    panelOne.deliver({ type: "attach", tabId: 1 });
    pageOne.deliver(inspectedPing());
    pageTwo.deliver(inspectedPing());
    pageOne.deliver({ ...inspectedPing(), type: "inspected-but-not" });
    expect(panelOne.posts).toEqual([inspectedPing()]);
  });
});
