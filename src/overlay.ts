import type { Agent } from "./agent";
import { nodeLabel } from "./inspector";
import { NO_ID } from "./protocol";

/**
 * A rectangle in viewport coordinates, from {@link boxOf}.
 *
 * @since 1.0.0
 */
export interface Box {
  /** Distance from the left edge of the viewport, in pixels. */
  left: number;
  /** Distance from the top edge of the viewport, in pixels. */
  top: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
}

/**
 * Options of {@link createOverlay}.
 *
 * @since 1.0.0
 */
export interface OverlayOptions {
  /** The document to draw in. @default globalThis.document */
  document?: Document;
  /** Flash a component's box each time one of its effects or memos re-runs after its first run. @default true */
  flash?: boolean;
  /** Most flash boxes alive at once; older ones are removed first. @default 40 */
  maxFlashes?: number;
}

/**
 * The in-page layer: the hover highlight and the update flashes. Created by {@link createOverlay}.
 *
 * @since 1.0.0
 */
export interface Overlay {
  /** The shadow host element that holds the layer. It is appended to `document.body`. */
  readonly host: HTMLElement;
  /**
   * Draws a labeled box around the component of this node (the node itself when it is a component),
   * replacing the previous highlight. `null` removes the highlight; a node with nothing laid out draws
   * nothing.
   */
  highlight(id: number | null): void;
  /**
   * Flashes the rendered DOM of the component with this id once. Does nothing while flashing is off or
   * when none of its DOM is laid out.
   */
  flash(id: number): void;
  /** Number of flash boxes currently in the page. */
  readonly flashes: number;
  /** Removes all flash boxes now (they also remove themselves when their animation ends). */
  clearFlashes(): void;
  /**
   * Turns the update flashes on or off. Turning them off does not remove the boxes already shown; use
   * {@link Overlay.clearFlashes} for that.
   */
  setFlash(on: boolean): void;
  /**
   * Stops listening to the agent and removes the layer, the flash boxes and the highlight. Do not use
   * the overlay afterward.
   */
  dispose(): void;
}

const STYLE = `
:host { all: initial; }
.layer { position: fixed; left: 0; top: 0; width: 0; height: 0; z-index: 2147483646; pointer-events: none; }
.box { position: fixed; box-sizing: border-box; pointer-events: none; }
.highlight { background: rgba(86, 156, 214, 0.25); outline: 1px solid rgba(86, 156, 214, 0.9); }
.label { position: absolute; left: 0; top: -18px; padding: 1px 6px; font: 11px/16px ui-monospace, monospace; color: #fff; background: rgba(40, 90, 150, 0.95); border-radius: 3px; white-space: nowrap; }
.flash { outline: 2px solid rgba(255, 193, 7, 0.95); background: rgba(255, 193, 7, 0.18); animation: shadowjs-flash 600ms ease-out forwards; }
@keyframes shadowjs-flash { from { opacity: 1; } to { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .flash { animation-duration: 1ms; } }
`;

/**
 * The union of the boxes of `nodes`: the smallest rectangle that contains all of them. Elements are
 * measured with their bounding box, text nodes with a range. Nodes with no layout (zero width and
 * height, or neither an element nor a text node) are skipped.
 *
 * @param nodes The DOM nodes to measure.
 * @param doc The document, used to create ranges for text nodes.
 * @returns The box in viewport coordinates, or `null` when none is laid out.
 * @example
 * import { boxOf } from "@shadow-js/devtools";
 *
 * const box = boxOf([document.body], document);
 * @since 1.0.0
 */
export function boxOf(nodes: readonly Node[], doc: Document): Box | null {
  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const node of nodes) {
    let rect: DOMRect | null = null;
    if (node instanceof Element) {
      rect = node.getBoundingClientRect();
    } else if (node.nodeType === 3 && typeof doc.createRange === "function") {
      const range = doc.createRange();
      range.selectNodeContents(node);
      rect = range.getBoundingClientRect();
    }
    if (rect === null || (rect.width === 0 && rect.height === 0)) continue;
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top, width: right - left, height: bottom - top };
}

function place(element: HTMLElement, box: Box): void {
  element.style.left = `${box.left}px`;
  element.style.top = `${box.top}px`;
  element.style.width = `${box.width}px`;
  element.style.height = `${box.height}px`;
}

/**
 * Creates the in-page overlay: a shadow-root layer above the page that never takes pointer events.
 * It draws the hover highlight and, when enabled, flashes a component's box each time one of its
 * effects or memos re-runs after its first run. It reads positions from the DOM nodes the agent
 * holds weakly. Dev only: `mountDevtools` creates it, and that call does nothing outside `__DEV__`
 * builds, so this layer never ships.
 *
 * @param agent The agent that knows which DOM nodes a component rendered.
 * @param options Document, flash switch and flash limit.
 * @returns The overlay. Call `dispose` on it when it is no longer needed.
 * @example
 * import { componentStats, createAgent, createOverlay } from "@shadow-js/devtools";
 *
 * const agent = createAgent();
 * const overlay = createOverlay(agent);
 * const top = componentStats(agent.model)[0];
 * if (top !== undefined) overlay.highlight(top.id);
 * @see boxOf
 * @since 1.0.0
 */
export function createOverlay(agent: Agent, options: OverlayOptions = {}): Overlay {
  const doc = options.document ?? globalThis.document;
  const limit = options.maxFlashes ?? 40;
  let flashEnabled = options.flash !== false;
  const host = doc.createElement("div");
  host.setAttribute("data-shadowjs-devtools-overlay", "");
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = STYLE;
  const layer = doc.createElement("div");
  layer.className = "layer";
  root.append(style, layer);
  doc.body.appendChild(host);

  let hover: HTMLElement | null = null;
  const flashBoxes: HTMLElement[] = [];

  const removeFlash = (element: HTMLElement): void => {
    const index = flashBoxes.indexOf(element);
    if (index !== -1) flashBoxes.splice(index, 1);
    element.remove();
  };

  const boxFor = (id: number): Box | null => {
    const nodes = agent.nodesOf(id);
    return nodes.length === 0 ? null : boxOf(nodes, doc);
  };

  const flash = (id: number): void => {
    if (!flashEnabled) return;
    const box = boxFor(id);
    if (box === null) return;
    const element = doc.createElement("div");
    element.className = "box flash";
    place(element, box);
    element.addEventListener("animationend", () => removeFlash(element), { once: true });
    layer.appendChild(element);
    flashBoxes.push(element);
    while (flashBoxes.length > limit) {
      const oldest = flashBoxes[0];
      if (oldest === undefined) break;
      removeFlash(oldest);
    }
  };

  // Flash the component of every effect or memo that re-runs (its second and later runs).
  const stop = agent.subscribe((events) => {
    if (!flashEnabled) return;
    const flashed = new Set<number>();
    for (const event of events) {
      if (event.k !== "run") continue;
      const record = agent.model.node(event.id);
      if (record === undefined || record.runs < 2) continue;
      const component = agent.model.componentOf(event.id);
      if (component === NO_ID || flashed.has(component)) continue;
      flashed.add(component);
      flash(component);
    }
  });

  return {
    host,
    get flashes(): number {
      return flashBoxes.length;
    },
    highlight(id): void {
      hover?.remove();
      hover = null;
      if (id === null) return;
      const component =
        agent.model.node(id)?.isComponent === true ? id : agent.model.componentOf(id);
      const target = component === NO_ID ? id : component;
      const box = boxFor(target);
      if (box === null) return;
      const element = doc.createElement("div");
      element.className = "box highlight";
      place(element, box);
      const record = agent.model.node(target);
      const label = doc.createElement("span");
      label.className = "label";
      label.textContent = record === undefined ? `#${target}` : `<${nodeLabel(record)}>`;
      element.appendChild(label);
      layer.appendChild(element);
      hover = element;
    },
    flash,
    clearFlashes(): void {
      for (const element of [...flashBoxes]) removeFlash(element);
    },
    setFlash(on): void {
      flashEnabled = on;
    },
    dispose(): void {
      stop();
      for (const element of [...flashBoxes]) removeFlash(element);
      hover = null;
      host.remove();
    },
  };
}
