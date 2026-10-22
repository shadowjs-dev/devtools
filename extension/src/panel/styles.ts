/**
 * The extension panel's stylesheet, as a string the panel page adopts. Its colors are the values of
 * design tokens copied here as constants: the extension is built from its own package and does not import
 * them from elsewhere in the repository. The dark scheme is the default; `data-theme="light"` switches to
 * the light scheme. Motion is removed under `prefers-reduced-motion`, and every control has a visible focus
 * ring.
 *
 * @packageDocumentation
 */

import { TIMELINE_STYLE } from "./timeline-styles";

/**
 * The dark scheme (the token values of the brand's dark theme). The default.
 *
 * @since 1.0.0
 */
export const DARK_TOKENS = {
  canvas: "#171717",
  surface: "#222222",
  text: "#ededed",
  textMuted: "#a3a3a3",
  rule: "rgb(255 255 255 / 0.08)",
  ruleStrong: "rgb(255 255 255 / 0.14)",
  focus: "#ededed",
  accent: "oklch(0.78 0.12 265)",
  accentTint: "oklch(0.78 0.12 265 / 0.12)",
  danger: "#ff8a8a",
} as const;

/**
 * The light scheme (the token values of the brand's light theme).
 *
 * @since 1.0.0
 */
export const LIGHT_TOKENS = {
  canvas: "#fafafa",
  surface: "#ededed",
  text: "#171717",
  textMuted: "#737373",
  rule: "rgb(0 0 0 / 0.08)",
  ruleStrong: "rgb(0 0 0 / 0.14)",
  focus: "#171717",
  accent: "#171717",
  accentTint: "rgb(0 0 0 / 0.06)",
  danger: "#b42318",
} as const;

/** The variables of one scheme, as CSS custom properties. */
function variables(tokens: Readonly<Record<keyof typeof DARK_TOKENS, string>>): string {
  return [
    `--canvas: ${tokens.canvas}`,
    `--surface: ${tokens.surface}`,
    `--text: ${tokens.text}`,
    `--text-muted: ${tokens.textMuted}`,
    `--rule: ${tokens.rule}`,
    `--rule-strong: ${tokens.ruleStrong}`,
    `--focus: ${tokens.focus}`,
    `--accent: ${tokens.accent}`,
    `--accent-tint: ${tokens.accentTint}`,
    `--danger: ${tokens.danger}`,
  ].join("; ");
}

/**
 * The whole stylesheet of the panel page.
 *
 * @since 1.0.0
 */
export const PANEL_STYLE: string = `
:root { color-scheme: dark; ${variables(DARK_TOKENS)}; }
.shell[data-theme="light"] { color-scheme: light; ${variables(LIGHT_TOKENS)}; }
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: var(--canvas); color: var(--text); }
body { font: 13px/1.5 "Geist", "Geist Fallback", system-ui, sans-serif; }
button, input, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.shell { position: fixed; inset: 0; display: flex; flex-direction: column; background: var(--canvas); }
.bar { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-bottom: 1px solid var(--rule); background: var(--surface); flex-wrap: wrap; }
.tabs { display: flex; gap: 2px; flex-wrap: wrap; }
.tab { background: transparent; border: 1px solid transparent; border-radius: 6px; padding: 4px 9px; color: var(--text-muted); cursor: pointer; transition: background-color 150ms ease, color 150ms ease; }
.tab[aria-selected="true"] { color: var(--text); border-color: var(--rule-strong); background: var(--accent-tint); }
.tab:hover { color: var(--text); }
.search { display: flex; }
.search input { min-width: 180px; padding: 4px 8px; border: 1px solid var(--rule-strong); border-radius: 6px; background: var(--canvas); }
.btn { padding: 4px 10px; border: 1px solid var(--rule-strong); border-radius: 6px; background: var(--canvas); cursor: pointer; }
.btn[aria-pressed="true"] { background: var(--accent-tint); }
.btn:disabled { opacity: 0.5; cursor: default; }
.status { margin-inline-start: auto; color: var(--text-muted); }
.view { flex: 1; min-height: 0; overflow: auto; padding: 8px 12px; }
.split { display: grid; grid-template-columns: minmax(0, 1fr) minmax(220px, 320px); gap: 12px; height: 100%; min-height: 0; }
.tree, .list { min-height: 0; overflow: auto; }
.row { display: flex; align-items: center; gap: 6px; padding: 3px 8px; border-radius: 4px; cursor: pointer; white-space: nowrap; transition: background-color 150ms ease; }
.row[aria-selected="true"] { background: var(--accent-tint); }
.row .kind { color: var(--text-muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; }
.row .value { color: var(--text-muted); overflow: hidden; text-overflow: ellipsis; }
table { width: 100%; border-collapse: collapse; }
th, td { text-align: start; padding: 4px 8px; border-bottom: 1px solid var(--rule); vertical-align: top; word-break: break-word; }
th { color: var(--text-muted); font-weight: 500; }
.details { border-inline-start: 1px solid var(--rule); padding-inline-start: 12px; overflow: auto; }
.details dt { color: var(--text-muted); }
.details dd { margin: 0 0 8px; }
.editor { display: grid; gap: 8px; }
.textarea { width: 100%; min-height: 220px; padding: 8px; border: 1px solid var(--rule-strong); border-radius: 6px; background: var(--surface); font-family: "Geist Mono", ui-monospace, monospace; resize: vertical; }
.note { color: var(--text-muted); margin: 8px 0; }
.error { color: var(--danger); }
.empty { color: var(--text-muted); padding: 8px 0; }
.link { background: none; border: 0; padding: 0; color: var(--text); text-decoration: underline; cursor: pointer; }
.more { margin: 6px 0; }
${TIMELINE_STYLE}@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; }
}
@media (max-width: 640px) {
  .split { grid-template-columns: minmax(0, 1fr); }
  .details { border-inline-start: 0; padding-inline-start: 0; }
}
`;
