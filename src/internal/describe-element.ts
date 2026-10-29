/**
 * Markup of an element for a message, cut after `limit` characters.
 *
 * `outerHTML` serializes the whole subtree before anything can be cut, so describing the root of a big
 * page cost time and memory proportional to the page. This walk produces the same text as `outerHTML`
 * for small elements (tags, attributes, text, comments, void elements, raw-text elements) and stops as
 * soon as more than `limit` characters exist, so it visits only the nodes at the start of the subtree.
 * It is iterative (a deep tree cannot overflow the stack) and slices every attribute value and text node
 * to the room that is left before it escapes it.
 *
 * @param root The element to describe.
 * @param limit The most characters the result may have; a longer markup ends with `…` at this length.
 * @returns The markup, or its first `limit - 1` characters and `…`.
 */
export function describeElement(root: Element, limit: number): string {
  let out = "";
  const room = (): number => limit + 1 - out.length;
  const full = (): boolean => out.length > limit;
  const stack: Array<{ next: Node | null; close: string }> = [];

  const open = (element: Element): void => {
    const name =
      element.prefix === null ? element.localName : `${element.prefix}:${element.localName}`;
    out += `<${name}`;
    const attributes = element.attributes;
    for (let index = 0; index < attributes.length && !full(); index += 1) {
      const attribute = attributes.item(index);
      if (attribute === null) continue;
      out += ` ${attribute.name}="${escapeAttribute(attribute.value.slice(0, room()))}"`;
    }
    out += ">";
    if (VOID.has(name)) return;
    const first =
      name === "template" && "content" in element && isNode(element.content)
        ? element.content.firstChild
        : element.firstChild;
    stack.push({ next: first, close: `</${name}>` });
  };

  open(root);
  while (stack.length > 0 && !full()) {
    const frame = stack[stack.length - 1];
    if (frame === undefined) break;
    const node = frame.next;
    if (node === null) {
      stack.pop();
      out += frame.close;
      continue;
    }
    frame.next = node.nextSibling;
    switch (node.nodeType) {
      case 1:
        open(node as Element);
        break;
      case 3:
      case 4: {
        const text = (node as CharacterData).data.slice(0, room());
        out += RAW_TEXT.has((node.parentNode as Element | null)?.localName ?? "")
          ? text
          : escapeText(text);
        break;
      }
      case 8:
        out += `<!--${(node as CharacterData).data.slice(0, room())}-->`;
        break;
      case 7:
        out += `<?${(node as ProcessingInstruction).target} ${(node as CharacterData).data.slice(0, room())}>`;
        break;
      default:
        break;
    }
  }
  return out.length > limit ? `${out.slice(0, limit - 1)}…` : out;
}

const VOID = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "embed",
  "frame",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

/** Elements whose text the HTML serializer writes without escaping. */
const RAW_TEXT = new Set(["style", "script", "xmp", "iframe", "noembed", "noframes", "plaintext"]);

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && "firstChild" in value;
}

function escapeText(text: string): string {
  return text.replace(/[& <>]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&nbsp;",
  );
}

function escapeAttribute(text: string): string {
  return text.replace(/[& "]/g, (char) =>
    char === "&" ? "&amp;" : char === '"' ? "&quot;" : "&nbsp;",
  );
}
