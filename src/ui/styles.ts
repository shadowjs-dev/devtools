/**
 * The panel's stylesheet. It lives inside the shadow root, so page styles cannot reach the panel and the
 * panel's styles cannot leak out. Colors follow `prefers-color-scheme`. Development tool: `mountDevtools()`
 * inserts it in development builds only.
 *
 * @example
 * import { LAUNCHER_CSS, PANEL_CSS } from "@shadow-js/devtools";
 * const host = document.createElement("div");
 * const root = host.attachShadow({ mode: "open" });
 * const style = document.createElement("style");
 * style.textContent = `${PANEL_CSS}${LAUNCHER_CSS}`;
 * root.append(style);
 * document.body.append(host);
 * @since 1.0.0
 */
export const PANEL_CSS: string = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }
.panel {
  --bg: #1e1f22; --bg2: #26282c; --bg3: #2f3237; --fg: #d7dae0; --muted: #8d939c; --line: #3a3d42;
  --accent: #4da3ff; --good: #6bcb77; --warn: #ffc107; --bad: #ff6b6b; --select: #254a73;
  position: fixed; z-index: 2147483647; width: 460px; height: 380px; min-width: 300px; min-height: 200px;
  display: flex; flex-direction: column; overflow: hidden; resize: both;
  background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 8px;
  box-shadow: 0 8px 30px rgba(0,0,0,.45); font: 12px/1.45 ui-sans-serif, system-ui, sans-serif;
}
@media (prefers-color-scheme: light) {
  .panel { --bg: #fbfbfc; --bg2: #f0f1f3; --bg3: #e4e6ea; --fg: #22252a; --muted: #6b717b; --line: #cfd3d9;
    --accent: #0b6bcb; --good: #1f8a3b; --warn: #a66b00; --bad: #c62828; --select: #cfe3fb; }
}
.panel[hidden] { display: none; }
.header { display: flex; align-items: center; gap: 8px; padding: 6px 8px; background: var(--bg2); border-bottom: 1px solid var(--line); cursor: grab; user-select: none; touch-action: none; }
.header.dragging { cursor: grabbing; }
.title { font-weight: 600; letter-spacing: .02em; }
.spacer { flex: 1; }
.tabs { display: flex; gap: 2px; padding: 4px 6px 0; background: var(--bg2); border-bottom: 1px solid var(--line); }
.tab { border: 0; background: transparent; color: var(--muted); padding: 5px 10px; border-radius: 6px 6px 0 0; cursor: pointer; font: inherit; }
.tab[aria-selected="true"] { color: var(--fg); background: var(--bg); box-shadow: inset 0 -2px 0 var(--accent); }
.badge { display: inline-block; min-width: 16px; padding: 0 5px; margin-left: 4px; border-radius: 8px; background: var(--bg3); color: var(--fg); text-align: center; font-size: 10px; }
.badge.bad { background: var(--bad); color: #fff; }
.btn { border: 1px solid var(--line); background: var(--bg3); color: var(--fg); border-radius: 5px; padding: 2px 8px; cursor: pointer; font: inherit; }
.btn:hover { border-color: var(--accent); }
.btn[aria-pressed="true"] { background: var(--select); border-color: var(--accent); }
.body { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--line); }
.input, .textarea { background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 5px; padding: 3px 6px; font: inherit; }
.input { flex: 1; min-width: 0; }
.textarea { width: 100%; min-height: 70px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; resize: vertical; }
.split { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.list { flex: 1; min-height: 60px; overflow: auto; }
.detail { max-height: 45%; overflow: auto; border-top: 1px solid var(--line); padding: 8px; background: var(--bg2); }
.row { display: flex; align-items: center; gap: 4px; padding: 1px 8px; cursor: default; white-space: nowrap; }
.row:hover { background: var(--bg3); }
.row[aria-selected="true"] { background: var(--select); }
.twisty { width: 14px; padding: 0; border: 0; background: none; text-align: center; color: var(--muted); cursor: pointer; flex: none; font: inherit; }
.twisty[hidden] { display: none; }
.row:focus-visible { outline: 1px solid var(--accent); outline-offset: -1px; }
.kind { font-size: 10px; padding: 0 4px; border-radius: 3px; background: var(--bg3); color: var(--muted); flex: none; }
.kind.component { color: var(--accent); }
.kind.signal { color: var(--good); }
.kind.memo { color: var(--warn); }
.name { overflow: hidden; text-overflow: ellipsis; }
.name.component { color: var(--accent); font-weight: 600; }
.value { color: var(--muted); overflow: hidden; text-overflow: ellipsis; }
.updates { margin-left: auto; color: var(--warn); font-variant-numeric: tabular-nums; flex: none; }
.more { padding: 6px 8px; }
.section { margin-bottom: 8px; }
.section h4 { margin: 0 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
.chain { list-style: none; margin: 0; padding: 0; }
.chain li { padding: 1px 0; }
.chain li::before { content: "→ "; color: var(--muted); }
.chain li:first-child::before { content: ""; }
.link { color: var(--accent); cursor: pointer; background: none; border: 0; padding: 0; font: inherit; text-decoration: underline; }
.flush { padding: 6px 8px; border-bottom: 1px solid var(--line); }
.flush-head { display: flex; gap: 8px; color: var(--muted); margin-bottom: 4px; }
.lanes { position: relative; background: var(--bg2); border-radius: 4px; overflow: hidden; }
.bar { position: absolute; height: 14px; overflow: hidden; white-space: nowrap; font-size: 10px; line-height: 14px; padding: 0 2px; border-radius: 2px; background: var(--accent); color: #fff; cursor: pointer; }
.bar.memo { background: var(--warn); color: #000; }
.bar.unchanged { opacity: .55; }
.table { width: 100%; border-collapse: collapse; }
.table th, .table td { text-align: left; padding: 2px 8px; border-bottom: 1px solid var(--line); }
.table td.num, .table th.num { text-align: right; font-variant-numeric: tabular-nums; }
.empty { padding: 16px; color: var(--muted); text-align: center; }
.status { color: var(--muted); }
.status.bad { color: var(--bad); }
.status.good { color: var(--good); }
.issue { padding: 6px 8px; border-bottom: 1px solid var(--line); }
.issue code { color: var(--bad); }
.footer { display: flex; gap: 12px; padding: 4px 8px; border-top: 1px solid var(--line); background: var(--bg2); color: var(--muted); }
`;

/**
 * Styles of the small button that opens the panel. Like {@link PANEL_CSS}, it is inserted into the shadow
 * root by `mountDevtools()` in development builds only.
 *
 * @example
 * import { LAUNCHER_CSS } from "@shadow-js/devtools";
 * const style = document.createElement("style");
 * style.textContent = LAUNCHER_CSS;
 * document.head.append(style);
 * @since 1.0.0
 */
export const LAUNCHER_CSS: string = `
.launcher { position: fixed; right: 12px; bottom: 12px; z-index: 2147483647; width: 36px; height: 36px; border-radius: 50%;
  border: 1px solid #3a3d42; background: #1e1f22; color: #4da3ff; font: 600 14px/1 ui-sans-serif, system-ui, sans-serif; cursor: pointer;
  box-shadow: 0 4px 14px rgba(0,0,0,.4); }
.launcher:hover { border-color: #4da3ff; }
.launcher[hidden] { display: none; }
`;
