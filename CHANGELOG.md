# Changelog

## 1.0.0

### Added

- Development instrumentation and a browser extension for inspecting ShadowJS applications.
- A bridge and panel for reactive state, components and runtime diagnostics.
- A Firefox build of the browser extension (Firefox 128 or newer), generated from the same sources as the Chromium
  build by a typed manifest generator with a permission audit. The build writes `dist/extension/chromium` and
  `dist/extension/firefox`; the Chromium manifest is unchanged.
- A Timeline tab in the extension panel: records signal writes, computation runs with durations and flushes into a
  bounded ring buffer (10 000 entries by default), draws one lane per computation with zoom and pan, explains which
  write caused which runs, and exports and imports a versioned, validated JSON recording. It listens to nothing until
  recording starts. Keyboard operable, reduced-motion safe and right-to-left safe.
