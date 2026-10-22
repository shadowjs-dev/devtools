import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { installHook, uninstallHook } from "../src/hook";
import { foldEvents } from "../src/model";
import { boxOf, createOverlay } from "../src/overlay";
import { instrument } from "./support/instrument";
import { Stream } from "./support/stream";

afterEach(() => {
  uninstallHook({ target: {} });
  document.body.innerHTML = "";
});

function sized(element: Element, left: number, top: number, width: number, height: number): void {
  element.getBoundingClientRect = () =>
    ({
      left,
      top,
      width,
      height,
      right: left + width,
      bottom: top + height,
      x: left,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

function setup(options: Parameters<typeof createOverlay>[1] = {}) {
  const hook = installHook({ target: {} });
  if (hook === undefined) throw new Error("no hook");
  const rt = instrument(hook);
  const agent = createAgent({ now: () => rt.clock.now });
  agent.attach(hook);
  const element = document.createElement("div");
  document.body.appendChild(element);
  sized(element, 5, 6, 70, 80);
  const signal = rt.signal(0, "n");
  const component = rt.component(
    "Box",
    () => {
      rt.effect(() => void signal.read(), "fx");
    },
    element,
  );
  rt.flush();
  const overlay = createOverlay(agent, options);
  const id = agent.snapshot().nodes.find((node) => node.name === "Box")?.id ?? -1;
  return { rt, agent, overlay, signal, element, component, id };
}

describe("[DVT-18] the in-page overlay", () => {
  it("[DVT-18.1] boxOf unions the boxes of laid-out nodes and ignores the rest", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const empty = document.createElement("div");
    sized(a, 0, 0, 10, 10);
    sized(b, 20, 30, 10, 10);
    sized(empty, 0, 0, 0, 0);
    expect(boxOf([a, b, empty, document.createTextNode("x")], document)).toEqual({
      left: 0,
      top: 0,
      width: 30,
      height: 40,
    });
    expect(boxOf([empty], document)).toBeNull();
    expect(boxOf([], document)).toBeNull();
  });

  it("[DVT-18.2] highlight draws a labeled box in a shadow root and removes it again", () => {
    const { overlay, id } = setup();
    const layer = overlay.host.shadowRoot;
    overlay.highlight(id);
    const box = layer?.querySelector(".highlight") as HTMLElement;
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual([
      "5px",
      "6px",
      "70px",
      "80px",
    ]);
    expect(box.querySelector(".label")?.textContent).toBe("<Box>");
    overlay.highlight(id);
    expect(layer?.querySelectorAll(".highlight")).toHaveLength(1);
    overlay.highlight(null);
    expect(layer?.querySelector(".highlight")).toBeNull();
    overlay.highlight(987_654);
    expect(layer?.querySelector(".highlight")).toBeNull();
  });

  it("[DVT-18.3] the layer lives in a shadow root, never takes pointer events and is removed on dispose", () => {
    const { overlay } = setup();
    expect(document.body.contains(overlay.host)).toBe(true);
    expect(overlay.host.shadowRoot?.querySelector("style")?.textContent).toContain(
      "pointer-events: none",
    );
    overlay.dispose();
    expect(document.body.contains(overlay.host)).toBe(false);
  });

  it("[DVT-18.4] flashes are bounded: older ones are removed first", () => {
    const { overlay, id, signal, rt, agent } = setup({ maxFlashes: 3 });
    for (let value = 1; value <= 10; value += 1) {
      signal.write(value);
      rt.flush();
      agent.flush();
    }
    expect(overlay.flashes).toBe(3);
    overlay.clearFlashes();
    expect(overlay.flashes).toBe(0);
    overlay.flash(id);
    expect(overlay.flashes).toBe(1);
  });

  it("[DVT-18.5] flashing can be switched off and a component that was removed from the page does not flash", () => {
    const { overlay, element, signal, rt, agent } = setup({ flash: false });
    signal.write(1);
    rt.flush();
    agent.flush();
    expect(overlay.flashes).toBe(0);
    overlay.setFlash(true);
    element.remove();
    signal.write(2);
    rt.flush();
    agent.flush();
    expect(overlay.flashes).toBe(0);
  });

  it("[DVT-18.6] a computation outside any component flashes nothing", () => {
    const hook = installHook({ target: {} });
    if (hook === undefined) throw new Error("no hook");
    const rt = instrument(hook);
    const agent = createAgent();
    agent.attach(hook);
    const overlay = createOverlay(agent);
    const signal = rt.signal(0, "loose");
    rt.effect(() => void signal.read(), "loose-effect");
    rt.flush();
    signal.write(1);
    rt.flush();
    agent.flush();
    expect(overlay.flashes).toBe(0);
  });
});

describe("[DVT-03] the component lookup cache is bounded", () => {
  it("[DVT-03.17] queries about disposed nodes cannot grow the cache past maxNodes", () => {
    const stream = new Stream();
    for (let id = 1; id <= 200; id += 1) stream.owner(id).disposeOwner(id);
    const model = foldEvents(stream.events, { maxNodes: 8, graveyard: 1000 });
    for (let id = 1; id <= 200; id += 1) model.componentOf(id);
    expect(model.graveyard.size).toBe(200);
    expect(model.componentCacheSize).toBeLessThanOrEqual(8);
  });
});
