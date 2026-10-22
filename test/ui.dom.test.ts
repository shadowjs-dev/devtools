import { snapshot, useStore } from "@shadow-js/core/store";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { EVENT } from "../src/protocol";
import { instrument } from "./support/instrument";
import { loadDevtools } from "./support/ui-loader";

type Tools = Awaited<ReturnType<typeof loadDevtools>>;
let tools: Tools;

beforeAll(async () => {
  tools = await loadDevtools();
});

afterEach(() => {
  tools.uninstallHook({ target: {} });
  document.body.innerHTML = "";
});

/** A rectangle stand-in: happy-dom does no layout. */
function layout(
  element: Element,
  rect: { left: number; top: number; width: number; height: number },
): void {
  element.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }) as DOMRect;
}

function start(options: Parameters<Tools["mountDevtools"]>[0] = {}) {
  const hook = tools.installHook({ target: {} });
  if (hook === undefined) throw new Error("no hook");
  const rt = instrument(hook);
  // Edits go through the adapter, which reports the write the way the patched runtime would.
  const agent = tools.createAgent({
    now: () => rt.clock.now,
    writeSignal: (node, value) => rt.writeNode(node as never, value),
  });
  agent.attach(hook);
  const handle = tools.mountDevtools({ hook, agent, ...options });
  return { hook, rt, handle };
}

/** App > Counter (count signal, doubled memo, title effect), rendered into a real element. */
function counterApp(rt: ReturnType<typeof instrument>) {
  const element = document.createElement("section");
  document.body.appendChild(element);
  layout(element, { left: 10, top: 20, width: 100, height: 50 });
  const log: number[] = [];
  const app = rt.component("App", () => {
    return rt.component(
      "Counter",
      () => {
        const count = rt.signal(1, "count");
        const doubled = rt.memo(() => count.read() * 2, "doubled");
        rt.effect(() => {
          log.push(doubled.read());
        }, "title");
        return count;
      },
      element,
    );
  });
  rt.flush();
  return { count: app.result.result, element, log };
}

/** The first match, or a clear failure: tests should not continue with a missing element. */
function query<T extends Element = HTMLElement>(
  root: ParentNode | null | undefined,
  selector: string,
): T {
  const found = root?.querySelector<T>(selector);
  if (found === null || found === undefined) throw new Error(`Not found: ${selector}`);
  return found;
}

const panel = (handle: { root: ShadowRoot | null }) =>
  handle.root?.querySelector(".panel") as HTMLElement;
const rows = (handle: { root: ShadowRoot | null }) =>
  Array.from(
    handle.root?.querySelectorAll('[role="treeitem"]') ?? [],
    (row) => row.querySelector(".name")?.textContent ?? "",
  );
const tab = (handle: { root: ShadowRoot | null }, id: string) =>
  handle.root?.querySelector(`[data-tab="${id}"]`) as HTMLElement;

describe("[DVT-11] mounting", () => {
  it("[DVT-11.1] puts the panel in a shadow root of one host and starts closed with a launcher", () => {
    const { handle } = start();
    expect(handle.host?.parentElement).toBe(document.body);
    expect(handle.host?.shadowRoot).toBe(handle.root);
    expect(handle.isOpen).toBe(false);
    expect(panel(handle).hidden).toBe(true);
    const launcher = handle.root?.querySelector(".launcher") as HTMLButtonElement;
    expect(launcher.hidden).toBe(false);
    // Page styles cannot reach the panel and the panel's styles do not leak.
    expect(document.querySelector(".panel")).toBeNull();
    expect(handle.root?.querySelector("style")?.textContent).toContain(".panel");
    launcher.click();
    handle.flush();
    expect(handle.isOpen).toBe(true);
    expect(panel(handle).hidden).toBe(false);
    expect(launcher.hidden).toBe(true);
  });

  it("[DVT-11.2] open, close and toggle", () => {
    const { handle } = start({ open: true });
    expect(panel(handle).hidden).toBe(false);
    handle.close();
    expect(panel(handle).hidden).toBe(true);
    handle.toggle();
    expect(panel(handle).hidden).toBe(false);
    query<HTMLElement>(handle.root, '[aria-label="Close"]').click();
    handle.flush();
    expect(panel(handle).hidden).toBe(true);
  });

  it("[DVT-11.3] Alt+Shift+D toggles; other keys and other shortcuts do not; the shortcut can be changed or off", () => {
    const { handle } = start();
    const press = (init: KeyboardEventInit) =>
      document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    press({ key: "D", altKey: true, shiftKey: true });
    expect(handle.isOpen).toBe(true);
    press({ key: "d", altKey: true, shiftKey: true });
    expect(handle.isOpen).toBe(false);
    press({ key: "d" });
    press({ key: "d", altKey: true });
    press({ key: "d", ctrlKey: true, shiftKey: true });
    expect(handle.isOpen).toBe(false);
    handle.dispose();

    const custom = start({ toggleKey: "Ctrl+K" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }));
    expect(custom.handle.isOpen).toBe(true);
    custom.handle.dispose();

    const off = start({ toggleKey: false });
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "d", altKey: true, shiftKey: true }),
    );
    expect(off.handle.isOpen).toBe(false);
  });

  it("[DVT-11.4] shortcut parsing and matching", () => {
    const parsed = tools.parseShortcut("Alt + Shift + D");
    expect(parsed).toEqual({ alt: true, ctrl: false, shift: true, meta: false, key: "d" });
    expect(tools.parseShortcut("")).toBeNull();
    expect(tools.parseShortcut("Cmd+/")).toMatchObject({ meta: true, key: "/" });
    const base = {
      key: "Ð",
      code: "KeyD",
      altKey: true,
      ctrlKey: false,
      shiftKey: true,
      metaKey: false,
    };
    // Alt can change the typed character; the physical key still matches.
    expect(parsed !== null && tools.matchesShortcut(base, parsed)).toBe(true);
    expect(parsed !== null && tools.matchesShortcut({ ...base, code: "KeyE" }, parsed)).toBe(false);
  });

  it("[DVT-11.5] dragging the header moves the panel and clamps it to the window; releasing stops it", () => {
    const { handle } = start({ open: true, position: { x: 100, y: 100 } });
    const header = handle.root?.querySelector(".header") as HTMLElement;
    const fire = (type: string, x: number, y: number) =>
      header.dispatchEvent(
        new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }) as unknown as Event,
      );
    const pointer = (type: string, x: number, y: number) => {
      const event = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
      Object.defineProperty(event, "pointerId", { value: 1 });
      header.dispatchEvent(event);
    };
    void fire;
    expect(panel(handle).style.left).toBe("100px");
    pointer("pointerdown", 120, 110);
    pointer("pointermove", 170, 140);
    handle.flush();
    expect(panel(handle).style.left).toBe("150px");
    expect(panel(handle).style.top).toBe("130px");
    pointer("pointerup", 170, 140);
    pointer("pointermove", 500, 500);
    handle.flush();
    expect(panel(handle).style.left).toBe("150px");
    // Dragging far outside is clamped to the window.
    pointer("pointerdown", 150, 130);
    pointer("pointermove", -4000, -4000);
    handle.flush();
    expect(panel(handle).style.left).toBe("0px");
    expect(panel(handle).style.top).toBe("0px");
    handle.moveTo(99999, 99999);
    expect(Number.parseInt(panel(handle).style.left, 10)).toBeLessThan(2000);
  });

  it("[DVT-11.6] pressing a button in the header does not start a drag", () => {
    const { handle } = start({ open: true, position: { x: 50, y: 50 } });
    const button = handle.root?.querySelector('[aria-label="Close"]') as HTMLElement;
    const down = new MouseEvent("pointerdown", { clientX: 5, clientY: 5, bubbles: true });
    Object.defineProperty(down, "pointerId", { value: 1 });
    button.dispatchEvent(down);
    const move = new MouseEvent("pointermove", { clientX: 200, clientY: 200, bubbles: true });
    Object.defineProperty(move, "pointerId", { value: 1 });
    query<HTMLElement>(handle.root, ".header").dispatchEvent(move);
    handle.flush();
    expect(panel(handle).style.left).toBe("50px");
  });

  it("[DVT-11.7] dispose removes the host, the overlay and the shortcut; it can be called twice", () => {
    const { handle } = start({ open: true });
    const host = handle.host;
    handle.dispose();
    handle.dispose();
    expect(host?.isConnected).toBe(false);
    expect(document.querySelector("[data-shadowjs-devtools-overlay]")).toBeNull();
    expect(document.querySelector("[data-shadowjs-devtools]")).toBeNull();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "d", altKey: true, shiftKey: true }),
    );
    expect(handle.isOpen).toBe(true);
  });
});

describe("[DVT-12] the tree view", () => {
  it("[DVT-12.1] shows the owners tree of a live graph and never inspects itself", () => {
    const { rt, handle } = start({ open: true });
    counterApp(rt);
    handle.flush();
    expect(rows(handle)).toEqual(["<App>", "<Counter>", "count", "doubled", "title"]);
    const nodeNames = handle.agent?.snapshot().nodes.map((node) => node.name);
    expect(nodeNames).toEqual(["App", "Counter", "count", "doubled", "title"]);
    expect(handle.agent?.stats.unknown).toBe(0);
    expect(handle.root?.querySelector(".footer")?.textContent).toContain("2 components");
  });

  it("[DVT-12.2] shows how many times effects and memos re-ran, rolled up to components", () => {
    const { rt, handle } = start({ open: true });
    const { count } = counterApp(rt);
    count.write(2);
    rt.flush();
    count.write(3);
    rt.flush();
    handle.flush();
    const badge = (name: string) =>
      Array.from(handle.root?.querySelectorAll('[role="treeitem"]') ?? [])
        .find((row) => row.querySelector(".name")?.textContent === name)
        ?.querySelector(".updates")?.textContent;
    expect(badge("<Counter>")).toBe("×4");
    expect(badge("<App>")).toBe("×4");
    expect(badge("title")).toBe("×2");
  });

  it("[DVT-12.3] collapsing a node hides its subtree; the filter and components-only narrow the list", () => {
    const { rt, handle } = start({ open: true });
    counterApp(rt);
    handle.flush();
    const counterRow = Array.from(handle.root?.querySelectorAll('[role="treeitem"]') ?? []).find(
      (row) => row.querySelector(".name")?.textContent === "<Counter>",
    );
    query<HTMLElement>(counterRow, ".twisty").click();
    handle.flush();
    expect(rows(handle)).toEqual(["<App>", "<Counter>"]);
    query<HTMLElement>(counterRow, ".twisty").click();
    handle.flush();
    const filter = handle.root?.querySelector('input[type="search"]') as HTMLInputElement;
    filter.value = "doub";
    filter.dispatchEvent(new Event("input"));
    handle.flush();
    expect(rows(handle)).toEqual(["<App>", "<Counter>", "doubled"]);
    filter.value = "";
    filter.dispatchEvent(new Event("input"));
    const only = handle.root?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    only.checked = true;
    only.dispatchEvent(new Event("change"));
    handle.flush();
    expect(rows(handle)).toEqual(["<App>", "<Counter>"]);
  });

  it("[DVT-12.4] selecting a node shows what it reads, who reads it and why it ran", () => {
    const { rt, handle } = start({ open: true });
    const { count } = counterApp(rt);
    count.write(5);
    rt.flush();
    handle.flush();
    const row = (name: string) =>
      Array.from(handle.root?.querySelectorAll('[role="treeitem"]') ?? []).find(
        (r) => r.querySelector(".name")?.textContent === name,
      ) as HTMLElement;
    row("title").click();
    handle.flush();
    const detail = handle.root?.querySelector(".detail") as HTMLElement;
    expect(detail.textContent).toContain("title");
    expect(detail.textContent).toContain("Reads");
    expect(detail.querySelector(".link")?.textContent).toBe("doubled");
    const chain = Array.from(detail.querySelectorAll(".chain li"), (li) =>
      li.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(chain).toEqual(["write count = 5", "ran doubled", "ran title"]);
    // Following a link selects that node.
    (detail.querySelector(".link") as HTMLElement).click();
    handle.flush();
    expect(handle.root?.querySelector(".detail")?.textContent).toContain("doubled");
    expect(row("doubled").getAttribute("aria-selected")).toBe("true");
  });

  it("[DVT-12.5] hovering a row highlights the component's box on the page", () => {
    const { rt, handle } = start({ open: true });
    const { element } = counterApp(rt);
    handle.flush();
    const overlayRoot = document.querySelector("[data-shadowjs-devtools-overlay]")?.shadowRoot;
    const row = Array.from(handle.root?.querySelectorAll('[role="treeitem"]') ?? []).find(
      (r) => r.querySelector(".name")?.textContent === "<Counter>",
    ) as HTMLElement;
    row.dispatchEvent(new Event("pointerenter"));
    const box = overlayRoot?.querySelector(".highlight") as HTMLElement;
    expect(box).not.toBeNull();
    expect(box.style.left).toBe("10px");
    expect(box.style.top).toBe("20px");
    expect(box.style.width).toBe("100px");
    expect(box.style.height).toBe("50px");
    expect(box.querySelector(".label")?.textContent).toBe("<Counter>");
    // Hovering one of its effects highlights the owning component.
    row.dispatchEvent(new Event("pointerleave"));
    expect(overlayRoot?.querySelector(".highlight")).toBeNull();
    const effectRow = Array.from(handle.root?.querySelectorAll('[role="treeitem"]') ?? []).find(
      (r) => r.querySelector(".name")?.textContent === "title",
    ) as HTMLElement;
    effectRow.dispatchEvent(new Event("pointerenter"));
    expect(overlayRoot?.querySelector(".highlight .label")?.textContent).toBe("<Counter>");
    effectRow.dispatchEvent(new Event("pointerleave"));
    expect(element.isConnected).toBe(true);
  });

  it("[DVT-12.6] a component flashes when its effects or memos re-run, and the flash cleans itself up", () => {
    const { rt, handle } = start({ open: true });
    const { count } = counterApp(rt);
    handle.flush();
    const overlayRoot = document.querySelector("[data-shadowjs-devtools-overlay]")?.shadowRoot;
    expect(overlayRoot?.querySelectorAll(".flash")).toHaveLength(0);
    count.write(2);
    rt.flush();
    handle.flush();
    const flashes = overlayRoot?.querySelectorAll(".flash") ?? [];
    expect(flashes).toHaveLength(1);
    expect((flashes[0] as HTMLElement).style.width).toBe("100px");
    flashes[0]?.dispatchEvent(new Event("animationend"));
    expect(overlayRoot?.querySelectorAll(".flash")).toHaveLength(0);
  });

  it("[DVT-12.7] the Flash button switches flashing off and on", () => {
    const { rt, handle } = start({ open: true });
    const { count } = counterApp(rt);
    const flashButton = Array.from(handle.root?.querySelectorAll(".header .btn") ?? []).find(
      (b) => b.textContent === "Flash",
    ) as HTMLElement;
    expect(flashButton.getAttribute("aria-pressed")).toBe("true");
    flashButton.click();
    handle.flush();
    expect(flashButton.getAttribute("aria-pressed")).toBe("false");
    const overlayRoot = document.querySelector("[data-shadowjs-devtools-overlay]")?.shadowRoot;
    count.write(2);
    rt.flush();
    handle.flush();
    expect(overlayRoot?.querySelectorAll(".flash")).toHaveLength(0);
    flashButton.click();
    handle.flush();
    count.write(3);
    rt.flush();
    handle.flush();
    expect(overlayRoot?.querySelectorAll(".flash")).toHaveLength(1);
  });
});

describe("[DVT-13] timeline, state, issues", () => {
  it("[DVT-13.1] the timeline lists flushes with queue sizes, nested lanes and the hottest components", () => {
    const { rt, handle } = start({ open: true });
    const { count } = counterApp(rt);
    const late = rt.signal(1, "late-source");
    const lazy = rt.memo(() => late.read() + 1, "late", { lazy: true });
    rt.effect(() => void lazy.read(), "reader");
    rt.flush();
    count.write(2);
    rt.flush();
    handle.setTab("timeline");
    handle.flush();
    const flushes = Array.from(handle.root?.querySelectorAll("[data-flush]") ?? []);
    expect(flushes.length).toBeGreaterThanOrEqual(2);
    const newest = flushes[0] as HTMLElement;
    expect(newest.textContent).toContain("queue: 0 render / 1 user");
    const bars = Array.from(newest.querySelectorAll(".bar"), (bar) => bar.textContent);
    expect(bars.sort()).toEqual(["doubled", "title"]);
    // The flush that first read the lazy memo nests it one lane under its reader.
    const nested = flushes.find((flush) =>
      Array.from(flush.querySelectorAll(".bar")).some((bar) => bar.textContent === "late"),
    ) as HTMLElement;
    const top = (label: string) =>
      Array.from(nested.querySelectorAll<HTMLElement>(".bar")).find(
        (bar) => bar.textContent === label,
      )?.style.top;
    expect(top("reader")).toBe("0px");
    expect(top("late")).toBe("16px");
    expect(
      handle.root?.querySelector('[aria-label="Component update counts"] td button')?.textContent,
    ).toBe("Counter");
    // Clicking a bar selects its node.
    (newest.querySelector(".bar") as HTMLElement).click();
    handle.setTab("tree");
    handle.flush();
    expect(handle.root?.querySelector(".detail")).not.toBeNull();
  });

  it("[DVT-13.2] the state tab lists signals; editing one writes the real signal and the app reacts", async () => {
    const { rt, handle } = start({ open: true, tab: "state" });
    const { count, log } = counterApp(rt);
    handle.flush();
    const option = handle.root?.querySelector('[role="option"]') as HTMLElement;
    expect(option.textContent).toContain("count");
    expect(option.querySelector(".value")?.textContent).toBe("1");
    option.click();
    handle.flush();
    await Promise.resolve();
    handle.flush();
    const area = handle.root?.querySelector("textarea") as HTMLTextAreaElement;
    expect(area.value).toBe("1");
    area.value = "21";
    area.dispatchEvent(new Event("input"));
    handle.flush();
    const apply = Array.from(handle.root?.querySelectorAll(".detail .btn") ?? []).find(
      (b) => b.textContent === "Apply",
    ) as HTMLButtonElement;
    expect(apply.disabled).toBe(false);
    apply.click();
    await Promise.resolve();
    await Promise.resolve();
    rt.flush();
    handle.flush();
    expect(count.node.value).toBe(21);
    expect(log.at(-1)).toBe(42);
    expect(handle.root?.querySelector('[role="status"]')?.textContent).toBe("Applied.");
    expect(handle.root?.querySelector('[role="option"] .value')?.textContent).toBe("21");
  });

  it("[DVT-13.3] invalid input is reported in the editor and nothing is written", async () => {
    const { rt, handle } = start({ open: true, tab: "state" });
    const { count } = counterApp(rt);
    handle.flush();
    query<HTMLElement>(handle.root, '[role="option"]').click();
    handle.flush();
    await Promise.resolve();
    handle.flush();
    const area = handle.root?.querySelector("textarea") as HTMLTextAreaElement;
    area.value = "{oops";
    area.dispatchEvent(new Event("input"));
    handle.flush();
    (
      Array.from(handle.root?.querySelectorAll(".detail .btn") ?? []).find(
        (b) => b.textContent === "Apply",
      ) as HTMLElement
    ).click();
    await Promise.resolve();
    await Promise.resolve();
    handle.flush();
    expect(handle.root?.querySelector(".status.bad")?.textContent?.length).toBeGreaterThan(0);
    expect(count.node.value).toBe(1);
    // Revert restores the live value.
    (
      Array.from(handle.root?.querySelectorAll(".detail .btn") ?? []).find(
        (b) => b.textContent === "Revert",
      ) as HTMLElement
    ).click();
    await Promise.resolve();
    handle.flush();
    expect(query<HTMLTextAreaElement>(handle.root, "textarea").value).toBe("1");
  });

  it("[DVT-13.4] a real store is shown as JSON and edited in place", async () => {
    const { hook, rt, handle } = start({ open: true, tab: "state" });
    const owner = rt.owner("root");
    const [todos, setTodos] = useStore({ items: [{ id: 1, done: false }], title: "Todos" });
    hook.report(
      EVENT.STORE_CREATED,
      {
        name: "todos",
        snapshot: () => snapshot(todos),
        set: (path: readonly (string | number)[], value: unknown) => {
          if (path.length === 0) setTodos(value as never);
          else (setTodos as (...args: unknown[]) => void)(...path, value);
        },
      },
      owner,
    );
    handle.flush();
    const option = handle.root?.querySelector('[role="option"]') as HTMLElement;
    expect(option.textContent).toContain("todos");
    option.click();
    handle.flush();
    await Promise.resolve();
    handle.flush();
    const area = handle.root?.querySelector("textarea") as HTMLTextAreaElement;
    expect(JSON.parse(area.value)).toEqual({ items: [{ id: 1, done: false }], title: "Todos" });
    area.value = JSON.stringify({ title: "Edited" });
    area.dispatchEvent(new Event("input"));
    handle.flush();
    (
      Array.from(handle.root?.querySelectorAll(".detail .btn") ?? []).find(
        (b) => b.textContent === "Apply",
      ) as HTMLElement
    ).click();
    await Promise.resolve();
    await Promise.resolve();
    expect(todos.title).toBe("Edited");
    expect(todos.items).toHaveLength(1);
  });

  it("[DVT-13.5] the issues tab lists errors with their code and hydration mismatches, and badges the tab", () => {
    const { hook, rt, handle } = start({ open: true });
    const owner = rt.owner("root");
    hook.report(EVENT.ERROR, owner, new TypeError("write in memo"), "WRITE_IN_MEMO");
    hook.report(EVENT.HYDRATION_MISMATCH, "text differs", "<b>server</b>", "<b>client</b>");
    handle.flush();
    expect(tab(handle, "issues").querySelector(".badge")?.textContent).toBe("2");
    handle.setTab("issues");
    handle.flush();
    const issues = Array.from(handle.root?.querySelectorAll(".issue") ?? [], (issue) =>
      issue.textContent?.replace(/\s+/g, " ").trim(),
    );
    expect(issues[0]).toContain("WRITE_IN_MEMO");
    expect(issues[0]).toContain("TypeError: write in memo");
    expect(issues[1]).toContain("Hydration mismatch");
    expect(issues[1]).toContain("server: <b>server</b>");
    expect(issues[1]).toContain("client: <b>client</b>");
  });

  it("[DVT-13.6] empty states say what is missing", () => {
    const { handle } = start({ open: true });
    expect(handle.root?.querySelector(".empty")?.textContent).toContain("Nothing recorded");
    handle.setTab("timeline");
    expect(handle.root?.querySelector(".empty")?.textContent).toContain("No flushes");
    handle.setTab("state");
    expect(handle.root?.querySelector(".empty")?.textContent).toContain("No signals");
    handle.setTab("issues");
    expect(handle.root?.querySelector(".empty")?.textContent).toContain("No errors");
  });

  it("[DVT-13.7] pause stops recording, resume continues, clear forgets", () => {
    const { rt, handle } = start({ open: true });
    const { count } = counterApp(rt);
    const buttons = Array.from(handle.root?.querySelectorAll(".header .btn") ?? []);
    const named = (text: string) => buttons.find((b) => b.textContent === text) as HTMLElement;
    named("Pause").click();
    handle.flush();
    expect(handle.agent?.paused).toBe(true);
    const before = handle.agent?.model.lastSeq;
    count.write(2);
    rt.flush();
    expect(handle.agent?.model.lastSeq).toBe(before);
    const resume = Array.from(handle.root?.querySelectorAll(".header .btn") ?? []).find(
      (b) => b.textContent === "Resume",
    ) as HTMLElement;
    resume.click();
    handle.flush();
    expect(handle.agent?.paused).toBe(false);
    count.write(3);
    rt.flush();
    expect((handle.agent?.model.lastSeq ?? 0) > (before ?? 0)).toBe(true);
    named("Clear").click();
    return Promise.resolve().then(() => {
      handle.flush();
      expect(rows(handle)).toEqual([]);
    });
  });

  it("[DVT-13.8] the tree limits its rows and 'Show more' raises the limit", () => {
    const { hook, handle } = start({ open: true });
    const root = {};
    hook.report(EVENT.OWNER_CREATED, root, null, "root", "Big");
    for (let i = 0; i < 700; i += 1) hook.report(EVENT.OWNER_CREATED, {}, root, "owner", `n${i}`);
    handle.flush();
    expect(rows(handle)).toHaveLength(300);
    const more = Array.from(handle.root?.querySelectorAll(".more .btn") ?? [])[0] as HTMLElement;
    expect(more.textContent).toContain("401 hidden");
    more.click();
    handle.flush();
    expect(rows(handle)).toHaveLength(600);
  });
});

describe("[DVT-14] the same panel over a remote backend", () => {
  it("[DVT-14.1] the exported Panel renders from a backend that sits behind a transport", async () => {
    const hook = tools.installHook({ target: {} });
    if (hook === undefined) throw new Error("no hook");
    const rt = instrument(hook);
    const agent = tools.createAgent({ now: () => rt.clock.now });
    agent.attach(hook);
    counterApp(rt);
    const [pageSide, panelSide] = tools.createMemoryTransportPair();
    tools.serveAgent(agent, pageSide);
    const backend = tools.connectRemote(panelSide);
    await backend.ready;

    const { render } = await import("@shadow-js/web");
    const { flushSync } = await import("@shadow-js/core");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => {
      const state = tools.createPanelState(backend);
      return tools.Panel({
        state,
        open: true,
        x: 0,
        y: 0,
        onMove: () => undefined,
        onClose: () => undefined,
      });
    }, container);
    flushSync();
    expect(
      Array.from(container.querySelectorAll('[role="treeitem"] .name'), (n) => n.textContent),
    ).toEqual(["<App>", "<Counter>", "count", "doubled", "title"]);
    dispose();
    backend.dispose();
  });

  it("[DVT-14.2] Pause and Resume from a remote panel pause and resume the agent it talks to", async () => {
    const hook = tools.installHook({ target: {} });
    if (hook === undefined) throw new Error("no hook");
    const rt = instrument(hook);
    const agent = tools.createAgent({ now: () => rt.clock.now });
    agent.attach(hook);
    counterApp(rt);
    const [pageSide, panelSide] = tools.createMemoryTransportPair();
    tools.serveAgent(agent, pageSide);
    const backend = tools.connectRemote(panelSide);
    await backend.ready;

    const { render } = await import("@shadow-js/web");
    const { flushSync } = await import("@shadow-js/core");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const dispose = render(() => {
      const state = tools.createPanelState(backend);
      return tools.Panel({
        state,
        open: true,
        x: 0,
        y: 0,
        onMove: () => undefined,
        onClose: () => undefined,
      });
    }, container);
    flushSync();
    const button = (text: string) =>
      Array.from(container.querySelectorAll<HTMLButtonElement>(".header .btn")).find(
        (b) => b.textContent === text,
      ) as HTMLButtonElement;
    button("Pause").click();
    expect(agent.paused).toBe(true);
    button("Resume").click();
    expect(agent.paused).toBe(false);
    dispose();
    backend.dispose();
  });
});
