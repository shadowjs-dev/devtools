import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent";
import { EVENT, type WireEvent } from "../src/protocol";

afterEach(() => {
  document.body.innerHTML = "";
});

/** The `expected` text of the hydration issue the agent records for `element`. */
function describeElement(element: Element): string {
  const agent = createAgent();
  const seen: WireEvent[] = [];
  agent.subscribe((events) => void seen.push(...events));
  agent.receive(EVENT.HYDRATION_MISMATCH, "mismatch", element, undefined, undefined, undefined);
  agent.flush();
  const event = seen.find((entry) => entry.k === "hydration");
  if (event === undefined || event.k !== "hydration") throw new Error("no hydration event");
  return event.expected;
}

describe("[DEVT-R2-3] a node is described without serializing its whole subtree", () => {
  it("[DEVT-R2-3.1] a small element reads as its outerHTML", () => {
    document.body.innerHTML =
      '<section id="a" class="b c" data-x="1 &amp; &quot;2&quot;"><p>Hello <b>big</b> &lt;world&gt;</p><br><img src="x.png"><!--note--><input disabled></section>';
    const section = document.body.firstElementChild;
    if (section === null) throw new Error("no element");
    expect(describeElement(section)).toBe(section.outerHTML);
    const p = section.querySelector("p");
    if (p === null) throw new Error("no p");
    expect(describeElement(p)).toBe(p.outerHTML);
  });

  it("[DEVT-R2-3.2] a big subtree is cut to 200 characters without reading outerHTML", () => {
    const root = document.createElement("div");
    root.setAttribute("id", "big");
    for (let index = 0; index < 5000; index += 1) {
      const child = document.createElement("span");
      child.textContent = `item ${index}`;
      root.append(child);
    }
    document.body.append(root);
    const full = root.outerHTML;
    let reads = 0;
    Object.defineProperty(root, "outerHTML", {
      get() {
        reads += 1;
        return full;
      },
    });
    const text = describeElement(root);
    expect(reads).toBe(0);
    expect(text).toBe(`${full.slice(0, 199)}…`);
    expect(text.length).toBe(200);
  });

  it("[DEVT-R2-3.3] a deeply nested subtree is described without recursion", () => {
    const root = document.createElement("div");
    let leaf: Element = root;
    for (let depth = 0; depth < 20_000; depth += 1) {
      const child = document.createElement("div");
      leaf.append(child);
      leaf = child;
    }
    const text = describeElement(root);
    expect(text).toBe(`${"<div>".repeat(40).slice(0, 199)}…`);
  });
});
