import { flushSync, useSignal } from "@shadow-js/core";
import { writeSignal } from "@shadow-js/core/extend";
import { render } from "@shadow-js/web";
import { type Agent, createAgent } from "./agent";
import { type Backend, createLocalBackend } from "./backend";
import { installHook } from "./hook";
import { createOverlay } from "./overlay";
import type { DevtoolsHook } from "./protocol";
import { serveAgent, type Transport } from "./transport";
import { Panel } from "./ui/panel";
import { createPanelState, type PanelState, type TabId } from "./ui/state";
import { LAUNCHER_CSS, PANEL_CSS } from "./ui/styles";

/**
 * Options of {@link mountDevtools}. Every field is optional.
 *
 * @since 1.0.0
 */
export interface MountOptions {
  /**
   * The hook to listen to. When unset, the package uses the hook {@link installHook} returns.
   *
   * @default installHook()
   */
  hook?: DevtoolsHook;
  /**
   * Use this agent instead of creating one. It must already be attached to the hook, or be attached by
   * you: the package attaches only the agent it creates.
   *
   * @default createAgent({ writeSignal })
   */
  agent?: Agent;
  /**
   * Where the overlay host element is appended.
   *
   * @default document.body
   */
  container?: Element;
  /**
   * The document to use.
   *
   * @default globalThis.document
   */
  document?: Document;
  /**
   * Start with the panel open. When false, only the launcher button shows.
   *
   * @default false
   */
  open?: boolean;
  /**
   * Keyboard shortcut that toggles the panel, such as `"Alt+Shift+D"`. Pass `false` to turn the shortcut
   * off.
   *
   * @default "Alt+Shift+D"
   */
  toggleKey?: string | false;
  /**
   * Panel position in pixels from the top-left corner of the window.
   *
   * @default { x: 16, y: 16 }
   */
  position?: { x: number; y: number };
  /**
   * Flash components when they update. The panel's Flash button changes this at runtime.
   *
   * @default true
   */
  flash?: boolean;
  /**
   * The tab shown first.
   *
   * @default "tree"
   */
  tab?: TabId;
  /**
   * Also serve the agent over this transport, for a remote panel in an extension or another tab. See
   * {@link serveAgent}.
   */
  serve?: Transport;
  /**
   * Show the launcher button that opens the panel.
   *
   * @default true
   */
  launcher?: boolean;
}

/**
 * The handle `mountDevtools()` returns. Every member is a no-op in production builds, where `host`,
 * `root`, `agent` and `backend` are `null`.
 *
 * @since 1.0.0
 */
export interface DevtoolsHandle {
  /**
   * The shadow host element the panel is appended to, or `null` when the tools are off.
   */
  readonly host: HTMLElement | null;
  /**
   * The shadow root holding the panel, or `null` when the tools are off.
   */
  readonly root: ShadowRoot | null;
  /**
   * The agent the panel reads from, or `null` when the tools are off.
   */
  readonly agent: Agent | null;
  /**
   * The backend the panel reads from, or `null` when the tools are off.
   */
  readonly backend: Backend | null;
  /**
   * Whether the panel is open. Each read returns the current value.
   */
  readonly isOpen: boolean;
  /**
   * Opens the panel and applies the change now.
   */
  open(): void;
  /**
   * Closes the panel and applies the change now.
   */
  close(): void;
  /**
   * Opens the panel when it is closed, and closes it when it is open. Applies the change now.
   */
  toggle(): void;
  /**
   * Moves the panel to `x` and `y` pixels from the top-left corner. The position is clamped to the
   * window.
   */
  moveTo(x: number, y: number): void;
  /**
   * Shows a tab and applies the change now.
   */
  setTab(tab: TabId): void;
  /**
   * Selects a node in the tree.
   */
  select(id: number): void;
  /**
   * Applies pending model changes to the panel now. The panel normally refreshes once per frame.
   */
  flush(): void;
  /**
   * Removes the panel, the overlay and every listener, and stops serving the agent. When
   * `mountDevtools()` created the agent, it is disposed too. Calling this again does nothing.
   */
  dispose(): void;
}

/** A parsed keyboard shortcut. */
interface Shortcut {
  alt: boolean;
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  key: string;
}

/**
 * Parses `"Alt+Shift+D"` style shortcuts. Modifier names are case-insensitive: `alt` or `option`,
 * `ctrl` or `control`, `shift`, and `meta`, `cmd` or `command`. The last part is the key, compared
 * case-insensitively with `event.key`.
 *
 * @param spec The shortcut text.
 * @returns The parsed shortcut, or `null` when it has no key.
 * @example
 * import { parseShortcut } from "@shadow-js/devtools";
 * const shortcut = parseShortcut("Ctrl+Shift+K"); // { ctrl: true, shift: true, alt: false, meta: false, key: "k" }
 * @since 1.0.0
 */
export function parseShortcut(spec: string): Shortcut | null {
  const parts = spec
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "");
  const key = parts.pop();
  if (key === undefined) return null;
  const has = (...names: string[]): boolean => parts.some((part) => names.includes(part));
  return {
    alt: has("alt", "option"),
    ctrl: has("ctrl", "control"),
    shift: has("shift"),
    meta: has("meta", "cmd", "command"),
    key,
  };
}

/**
 * True when a keyboard event is the shortcut. The modifiers must match exactly. The key matches
 * `event.key`, or, for a single letter, `event.code` (such as `KeyD`), because Alt and Shift change the
 * character on some keyboard layouts.
 *
 * @param event The event.
 * @param shortcut From {@link parseShortcut}.
 * @returns True when the event is the shortcut.
 * @example
 * import { matchesShortcut, parseShortcut } from "@shadow-js/devtools";
 * const toggle = parseShortcut("Alt+Shift+D");
 * document.addEventListener("keydown", (event) => {
 *   if (toggle !== null && matchesShortcut(event, toggle)) console.log("toggle the panel");
 * });
 * @since 1.0.0
 */
export function matchesShortcut(
  event: Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "shiftKey" | "metaKey">,
  shortcut: Shortcut,
): boolean {
  if (
    event.altKey !== shortcut.alt ||
    event.ctrlKey !== shortcut.ctrl ||
    event.shiftKey !== shortcut.shift ||
    event.metaKey !== shortcut.meta
  ) {
    return false;
  }
  const key = event.key.toLowerCase();
  if (key === shortcut.key) return true;
  return shortcut.key.length === 1 && event.code.toLowerCase() === `key${shortcut.key}`;
}

function noop(): void {
  // Production and server builds: the tools do nothing.
}

const OFF: DevtoolsHandle = {
  host: null,
  root: null,
  agent: null,
  backend: null,
  isOpen: false,
  open: noop,
  close: noop,
  toggle: noop,
  moveTo: noop,
  setTab: noop,
  select: noop,
  flush: noop,
  dispose: noop,
};

/**
 * Shows the devtools: a floating, draggable panel in a shadow root (so page styles cannot touch it)
 * with the component tree, a flame timeline of flushes, a state viewer with live editing, and an
 * issues list. Hovering a row highlights the component on the page; components flash when they
 * update. Toggle with `Alt+Shift+D`, or with the `toggleKey` option.
 *
 * This is a development tool: the panel is for development builds and never ships. In production
 * builds (`__DEV__` false), on the server, or when another protocol version owns the hook, this does
 * nothing and returns a handle of no-ops. Call it before your application renders so no event is
 * missed.
 *
 * @param options See {@link MountOptions}.
 * @returns A handle to control or remove the panel.
 * @example
 * import { mountDevtools } from "@shadow-js/devtools";
 * // Development builds only: production builds ignore this call.
 * const devtools = mountDevtools({ open: true });
 * devtools.toggle();
 * @since 1.0.0
 */
export function mountDevtools(options: MountOptions = {}): DevtoolsHandle {
  if (!__DEV__) return OFF;
  const doc = options.document ?? (typeof document === "undefined" ? undefined : document);
  if (doc === undefined) return OFF;
  const hook = options.hook ?? installHook();
  if (hook === undefined) return OFF;

  const ownsAgent = options.agent === undefined;
  const agent = options.agent ?? createAgent({ writeSignal });
  const detach = ownsAgent ? agent.attach(hook) : noop;
  const overlay = createOverlay(agent, { document: doc, flash: options.flash !== false });
  const backend = createLocalBackend(agent, { highlight: (id) => overlay.highlight(id) });
  const stopServing =
    options.serve === undefined
      ? noop
      : serveAgent(agent, options.serve, { highlight: (id) => overlay.highlight(id) });

  const host = doc.createElement("div");
  host.setAttribute("data-shadowjs-devtools", "");
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = `${PANEL_CSS}${LAUNCHER_CSS}`;
  root.appendChild(style);
  (options.container ?? doc.body).appendChild(host);

  let state: PanelState | undefined;
  let setOpen: (value: boolean) => void = noop;
  let setPosition: (x: number, y: number) => void = noop;
  let isOpen = options.open === true;
  const start = options.position ?? { x: 16, y: 16 };

  // Everything the panel creates is invisible to the agent: it must not inspect itself.
  const unmount = agent.quiet(() =>
    render(() => {
      const [open, setOpenSignal] = useSignal(isOpen);
      const [position, setPositionSignal] = useSignal({ x: start.x, y: start.y });
      setOpen = (value) => {
        isOpen = value;
        setOpenSignal(value);
      };
      setPosition = (x, y) => {
        const maxX = Math.max((doc.defaultView?.innerWidth ?? 1024) - 80, 0);
        const maxY = Math.max((doc.defaultView?.innerHeight ?? 768) - 40, 0);
        setPositionSignal({ x: Math.min(Math.max(x, 0), maxX), y: Math.min(Math.max(y, 0), maxY) });
      };
      state = createPanelState(backend, {
        ...(options.tab === undefined ? {} : { tab: options.tab }),
        flash: options.flash !== false,
        onFlash: (on) => overlay.setFlash(on),
        onPause: (paused) => {
          if (paused) agent.pause();
          else agent.resume();
        },
      });
      return (
        <>
          <Panel
            state={state}
            open={open()}
            x={position().x}
            y={position().y}
            onMove={(x, y) => setPosition(x, y)}
            onClose={() => setOpen(false)}
          />
          <button
            type="button"
            class="launcher"
            aria-label="Open ShadowJS devtools"
            hidden={open() || options.launcher === false}
            on:click={() => setOpen(true)}
          >
            S
          </button>
        </>
      );
    }, root),
  );

  // The model changes far more often than anyone can read it: refresh the views once per frame.
  let refreshPending = false;
  let frame: number | undefined;
  const refresh = (): void => {
    refreshPending = false;
    frame = undefined;
    state?.refresh();
  };
  const stopSubscription = backend.subscribe(() => {
    if (refreshPending) return;
    refreshPending = true;
    if (typeof doc.defaultView?.requestAnimationFrame === "function") {
      frame = doc.defaultView.requestAnimationFrame(refresh);
    } else {
      queueMicrotask(refresh);
    }
  });

  const shortcut =
    options.toggleKey === false ? null : parseShortcut(options.toggleKey ?? "Alt+Shift+D");
  const onKey = (event: KeyboardEvent): void => {
    if (shortcut === null || !matchesShortcut(event, shortcut)) return;
    event.preventDefault();
    setOpen(!isOpen);
    flushSync();
  };
  doc.addEventListener("keydown", onKey, true);

  const flush = (): void => {
    // Deliver the agent's pending events first: they are what schedules the refresh.
    agent.flush();
    if (refreshPending) {
      if (frame !== undefined) doc.defaultView?.cancelAnimationFrame(frame);
      refresh();
    }
    flushSync();
  };

  let disposed = false;
  return {
    host,
    root,
    agent,
    backend,
    get isOpen(): boolean {
      return isOpen;
    },
    open(): void {
      setOpen(true);
      flushSync();
    },
    close(): void {
      setOpen(false);
      flushSync();
    },
    toggle(): void {
      setOpen(!isOpen);
      flushSync();
    },
    moveTo(x, y): void {
      setPosition(x, y);
      flushSync();
    },
    setTab(tab): void {
      state?.setTab(tab);
      flushSync();
    },
    select(id): void {
      state?.select(id);
      flushSync();
    },
    flush,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      doc.removeEventListener("keydown", onKey, true);
      stopSubscription();
      if (frame !== undefined) doc.defaultView?.cancelAnimationFrame(frame);
      stopServing();
      unmount();
      overlay.dispose();
      backend.dispose();
      host.remove();
      detach();
      if (ownsAgent) agent.dispose();
    },
  };
}
