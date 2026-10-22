/**
 * The stylesheet of the Timeline tab, as a string that `PANEL_STYLE` includes. It uses logical CSS properties
 * only (`inline-size`, `padding-inline`, `border-inline-start`, `inset-inline-start`), so the layout mirrors
 * in a right-to-left browser; the time axis inside the drawing always runs from the start to the end of the
 * recording. Nothing animates, and the reduced-motion rule of the panel covers the rest.
 *
 * @since 1.0.0
 */
export const TIMELINE_STYLE: string = `
.tl { display: grid; gap: 8px; }
.tl-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.tl-field { display: inline-flex; align-items: center; gap: 4px; color: var(--text-muted); }
.tl-field input[type="number"] { inline-size: 7em; padding-block: 3px; padding-inline: 6px; border: 1px solid var(--rule-strong); border-radius: 6px; background: var(--canvas); }
.tl-field input[type="file"] { max-inline-size: 14em; }
.tl-status { margin-block: 0; color: var(--text-muted); }
.tl-grid { display: grid; grid-template-columns: minmax(6rem, 14rem) minmax(0, 1fr); border: 1px solid var(--rule); border-radius: 6px; overflow: hidden; }
.tl-labels { border-inline-end: 1px solid var(--rule); background: var(--surface); }
.tl-label { block-size: 24px; line-height: 24px; padding-inline: 8px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; border-block-end: 1px solid var(--rule); box-sizing: border-box; }
.tl-plot { position: relative; overflow: hidden; cursor: grab; touch-action: pan-y; }
.tl-plot:active { cursor: grabbing; }
.tl-svg { display: block; inline-size: 100%; }
.tl-rule { fill: var(--rule); }
.tl-flush { fill: var(--accent-tint); }
.tl-bar { cursor: pointer; }
.tl-run { fill: var(--accent); }
.tl-same { fill: var(--accent); opacity: 0.45; }
.tl-write { fill: var(--text); }
.tl-related-bar { stroke: var(--text); stroke-width: 1.5px; vector-effect: non-scaling-stroke; }
.tl-selected { stroke: var(--focus); stroke-width: 3px; vector-effect: non-scaling-stroke; }
.tl-axis { margin-block: 0; color: var(--text-muted); }
.tl-details { padding-inline: 12px; padding-block: 4px; border-inline-start: 3px solid var(--rule-strong); }
.tl-details h3 { margin-block: 4px; font-size: 13px; }
.tl-details h4 { margin-block: 8px 2px; color: var(--text-muted); font-weight: 500; }
.tl-related { margin-block: 0; padding-inline-start: 18px; }
.tl-list summary { cursor: pointer; }
`;
