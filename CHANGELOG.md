# Changelog

## 1.0.2

### Fixed

- The extension bridge forwards the answers a panel asked for up to 16 million characters (the complete state of a page that ran a few thousand effects used to be dropped, so the panel never became ready) and replaces a larger answer with an error answer instead of dropping it.
- A panel follows the inspected page across a reload: a batch whose sequence numbers start again from 1 is taken as a new agent and the panel asks for its state.
- `connectRemote` skips events and states that do not have the shape of an event or a state, and holds at most 50,000 events while it waits for the first state.
- The panel's graveyard is cut to its limit when a state from a larger model is imported.
- A failing subscriber of an agent no longer keeps the other subscribers from receiving a batch.
- A sink that detaches while the hook delivers an event no longer makes the next sink miss it.
- A snapshot the panel cannot get (an answer over the bridge's size cap, or a state it cannot read) now shows "Could not load the page: <reason>" in the panel instead of "Connecting" for good; `Backend` has an optional `error()` for it.
- Every message of `serveAgent` carries an `instance` id (random per served agent), and the bridge asks the agent to say `hello` after it reopens a port: a panel that sees another id discards its state and asks for a new one, even when the reloaded page's sequence numbers start above the old ones.
- The agent describes an element in a hydration issue from its first nodes instead of serializing the whole `outerHTML` to keep 200 characters.
- The extension build and zip scripts take their default version from `package.json` instead of a fixed `1.0.0`.
- A snapshot whose JSON text is longer than 15 million characters (the complete state of a very busy page) no longer ends in "Could not load the page": the agent sends it as numbered chunks of at most 400,000 characters (`chunk` messages carrying the request id, the piece number, the count, the total size and the instance id), the extension bridge forwards each one, and `connectRemote` joins them. Answers up to that size keep the single `response` message, so an older panel or bridge sees no change for them. The panel assembles at most 4 answers at a time, 1024 pieces and 256 million characters each, ignores duplicate pieces, pieces for requests it did not make and pieces of another agent instance, and gives an answer up with an error after 30 seconds without a new piece (`RemoteOptions.chunkTimeoutMs`). `ServeOptions` has `chunkChars` and `singleResponseChars` to change the two sizes.

## 1.0.1

### Changed

- Released at 1.0.1 with the other packages, which share one version. No change to this package.

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
