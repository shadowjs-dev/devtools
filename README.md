<p align="center"><img src="https://raw.githubusercontent.com/shadowjs-dev/devtools/main/.github/banner.png" alt="ShadowJS" width="100%"></p>

# @shadow-js/devtools

[![npm](https://img.shields.io/npm/v/@shadow-js/devtools.svg)](https://www.npmjs.com/package/@shadow-js/devtools)
[![CI](https://github.com/shadowjs-dev/devtools/actions/workflows/ci.yml/badge.svg)](https://github.com/shadowjs-dev/devtools/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow.svg)](https://github.com/shadowjs-dev/devtools/blob/main/LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.12-brightgreen.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

Developer tools for the ShadowJS reactive graph. A floating panel, built with ShadowJS, shows the
components, signals, memos, effects, stores and resources of a running app, the flushes that update
them, the state values (which you can edit) and the runtime errors. The same panel can also run in
another page, such as a browser extension or another tab, through a transport.

> **Development only.** Never ship this package to production. See [Development only](#development-only).

## Install

```sh
npm install -D @shadow-js/devtools
```

Install it as a development dependency. The package has no runtime dependencies. It declares
`@shadow-js/core` and `@shadow-js/web` as peer dependencies, which your app already uses.

ShadowJS 1.0.0 is not on npm yet. Until it is published, install the packages from this repository's workspace.

## Quick start

```tsx
/// <reference types="vite/client" />
import { useSignal } from "@shadow-js/core";
import { mountDevtools } from "@shadow-js/devtools";
import { render } from "@shadow-js/web";

function Counter() {
  const [count, setCount] = useSignal(0);
  return <button on:click={() => setCount(count() + 1)}>Count: {count()}</button>;
}

// Dev only. Mount the panel before the app renders, so no event is missed.
if (import.meta.env.DEV) mountDevtools({ open: true });

render(() => <Counter />, document.body);
```

Run the app with `vite dev`. The panel opens in the top-left corner of the page. Press `Alt+Shift+D`
to toggle it. The `vite/client` reference types `import.meta.env`; apps made with `create-shadow-app` already have it
in `src/vite-env.d.ts`.

## Enable it in development

`mountDevtools(options?)` creates the panel and returns a handle. Call it before the application
renders, because events reported before the hook exists are lost. It installs the hook itself.
Without `open: true`, only a small launcher button labeled "S" shows; click it or press
`Alt+Shift+D` to open the panel.

| Option | Default | What it does |
| --- | --- | --- |
| `open` | `false` | Start with the panel open. |
| `toggleKey` | `"Alt+Shift+D"` | Keyboard shortcut that toggles the panel. `false` turns the shortcut off. |
| `tab` | `"tree"` | First view: `"tree"`, `"timeline"`, `"state"` or `"issues"`. |
| `position` | `{ x: 16, y: 16 }` | Starting position in pixels from the top-left corner. |
| `flash` | `true` | Flash components on the page when they update. The header button switches it. |
| `launcher` | `true` | Show the launcher button. |
| `serve` | none | Also serve the agent over a transport, for a [remote panel](#remote-panel). |

`hook`, `agent`, `container` and `document` are for tests and unusual setups.

The handle returned by `mountDevtools()` has `open()`, `close()`, `toggle()`, `moveTo(x, y)`,
`setTab(tab)`, `select(id)`, `flush()` and `dispose()`, plus the read-only `isOpen`, `host`, `root`,
`agent` and `backend`. `dispose()` removes the panel, the overlay and every listener.

## The panel

The panel is draggable by its header. The header also pauses and clears the recording. It has four
views:

- **Components**: the owner tree (components, memos, effects, signals, resources and stores), with
  re-runs rolled up per component. A filter box narrows the tree. The arrow keys move the selection
  (Up and Down), collapse and expand (Left and Right), and Home and End jump to the first and last
  row. The detail pane shows what the node reads, what reads it, and why it last ran. Hovering a row
  highlights the component on the page.
- **Timeline**: the newest flushes as flame lanes (a memo pulled by an effect sits under it), the
  render and user queue sizes of each flush, and the components that re-ran most.
- **State**: every signal, store and resource with its current value. Select a signal or a store to
  see its value as JSON, change the text and press **Apply**. The write goes through the engine like
  any other write. Resources are listed but cannot be edited.
- **Issues**: runtime errors with their diagnostic code, and hydration mismatches.

## API

| Export | What it is |
| --- | --- |
| `mountDevtools(options?)` | The floating panel in a shadow root, plus the in-page overlay. Dev only. |
| `installHook(options?)`, `getHook(target?)`, `uninstallHook(target?)` | The global hook `globalThis.__SHADOWJS_DEVTOOLS_HOOK__` that the runtime reports to. |
| `createAgent(options?)` | Receives hook events, keeps bounded buffers and answers commands (read and edit values). |
| `InspectorModel`, `snapshotOf`, `ownerTree`, `componentStats`, `explainRun`, `flameTimeline`, `nodeLabel`, `foldEvents` | The headless inspector: pure functions over the recorded events. |
| `serveAgent()`, `connectRemote()` and the transports | The panel over `postMessage`, `MessagePort` or `BroadcastChannel`. |
| `Panel`, `createPanelState()` | The panel component and its state, for a custom panel page. |
| `EVENT`, `PROTOCOL_VERSION`, `HOOK_KEY` | The protocol constants (see below). |
| `registerInspection(name, source)` | Shows an app's router, query cache or other state in the extension (see [Inspection sources](#inspection-sources)). Dev only. |
| `routerInspection(router)`, `queryInspection(client)` | Inspection sources for a router (`@shadow-js/router`) and a query client (`@shadow-js/query`), read through structural types. |
| `InspectionSource`, `InspectionRow`, `readInspections()`, `parseInspectResult()`, `sanitizeRows()` | The inspection contract: the rows a source shows, bounded and plain. |
| `createInspectionState(backend)` | The state of the router and query views of a panel. |
| `MAX_INSPECTIONS`, `MAX_INSPECTION_ROWS` | The limits of the inspection registry: 16 sources, 500 rows each. |

### The hook

`installHook()` installs the hook once and returns it. It returns the hook that is already installed
when its `version` matches `PROTOCOL_VERSION`. It returns `undefined`, and installs nothing, when a
hook of another version is present or in production builds. Its options are:

- `target`: the object to install on (default `globalThis`).
- `buffer`: how many events to keep for a sink that attaches later (default 5000). The buffer is
  dropped when the first sink attaches.

`getHook()` returns the installed hook when its version matches, and `uninstallHook()` removes it
from the global. Sinks stay attached to the old object. The hook's `attach(sink)` adds a sink,
replays the buffered events to it and returns a function that detaches it. `faults` counts sinks
that threw, and `lastFault` holds the last error; the application never sees either.

```ts
import { createAgent, getHook, installHook, uninstallHook } from "@shadow-js/devtools";

// The hook is undefined in production builds, so the agent is only created in development.
const hook = installHook({ buffer: 5000 });
if (hook !== undefined) {
  const agent = createAgent();
  const detach = agent.attach(hook);
  console.log(agent.stats.recorded);
  detach();
}

console.log(getHook() === hook); // true while the hook is installed
uninstallHook();
```

`createAgent()` does not make signals editable. Pass `writeSignal` from `@shadow-js/core/extend` to
allow edits; `mountDevtools()` does this for you.

## Remote panel

A remote panel runs in another page and talks to the agent over a transport. The inspected page
serves the agent:

```ts
/// <reference types="vite/client" />
import { createBroadcastChannelTransport, mountDevtools } from "@shadow-js/devtools";

if (import.meta.env.DEV) {
  mountDevtools({ serve: createBroadcastChannelTransport("shadowjs-devtools") });
}
```

The panel page connects to it and renders the same `Panel` against the remote backend:

```tsx
/// <reference types="vite/client" />
import {
  connectRemote,
  createBroadcastChannelTransport,
  createPanelState,
  Panel,
} from "@shadow-js/devtools";
import { render } from "@shadow-js/web";

// The backend keeps a copy of the model, filled by the events the agent sends.
const backend = connectRemote(createBroadcastChannelTransport("shadowjs-devtools"));
await backend.ready;

render(() => {
  const state = createPanelState(backend);
  // onMove is a no-op here, so this panel stays at 16, 16 and does not persist its position.
  return <Panel state={state} open={true} x={16} y={16} onMove={() => {}} onClose={() => {}} />;
}, document.body);
```

The transports:

- `createBroadcastChannelTransport(name)` uses a `BroadcastChannel`, so it reaches the other pages of
  the same origin.
- `createWindowTransport({ target, origin })` uses `postMessage` between a page and a panel in
  another window or frame. It refuses `"*"` as the origin and accepts messages only from `target`
  and `origin`.
- `createPortTransport(port)` wraps a `MessagePort`.
- `createMemoryTransportPair()` returns two connected in-memory transports, for tests.

`serveAgent(agent, transport, options?)` serves an agent and returns a function that stops serving.
`connectRemote(transport, options?)` returns a `Backend`; its `ready` promise resolves when the first
complete state arrives. Every message is plain, structured-clonable data and carries `channel`, `v`
and `from`.

## Inspection sources

The panel shows the components, signals, stores and effects of the graph by itself. An app's router and
query cache are not in the graph, so the app describes them with an inspection source:

```ts
import { queryInspection, registerInspection, routerInspection } from "@shadow-js/devtools";

if (import.meta.env.DEV) {
  registerInspection("router", routerInspection(router));
  registerInspection("query", queryInspection(queryClient));
}
```

An `InspectionSource` has a `title` and a `rows()` function. The panel asks for the rows when it shows
the source, so each view is the state at the time of the request, not a copy from registration.
`routerInspection` lists the location, whether a navigation is pending, the last error and the matched
routes. `queryInspection` lists one row per query: its key, fetch status, observers, age and whether it
was invalidated.

The adapters are structural: `routerInspection` takes anything with the `state` accessors of a router, and
`queryInspection` takes anything whose `queryCache` has `find()` (query snapshots) and `subscribe(listener)`. A
`QueryClient` from `@shadow-js/query` and a `Router` from `@shadow-js/router` fit those shapes, so devtools does not
depend on either package.

Live updates: a source may have a `subscribe(notify)` function that calls `notify` when its rows may have changed.
`queryInspection` uses the query cache's `subscribe`, and the extension's page side forwards each change to the
panel as an inspection ping, so the Queries view updates as the cache changes. The query cache offers `subscribe`
through its `inspection` feature: create the client with `features: [inspection]` (from `@shadow-js/query/inspection`).
Without it the source still lists the queries, and the panel reads them when it opens the view.

Limits, so a broken source cannot flood the panel: at most 16 sources (`MAX_INSPECTIONS`; a 17th new name is
refused, and re-registering a name replaces its source), at most 500 rows per source (`MAX_INSPECTION_ROWS`;
the last row says how many were cut), and every field is text of at most 200 characters. A source that
throws is shown with its error. `registerInspection` returns `false` when nothing was registered (no hook,
an empty name, or the limit); it registers nothing in production builds. The hook keeps a registered source
until the page unloads or another source is registered under the same name, so a source that reads a
router or a client keeps that object reachable: register sources for the lifetime of the app, not per
screen.

## Browser extension

The extension is a Manifest V3 panel for Chromium (Chrome and Edge are built and tested) and for Firefox 128 or
newer (built from the same sources; see [Firefox](#firefox) for what was and was not run). It adds a **ShadowJS**
tab to the DevTools window of a page on `localhost`, `127.0.0.1` or `[::1]`. The panel is a ShadowJS application
(`extension/src/panel/`) with these views:

| View | Shows |
| --- | --- |
| Components | the component tree, with search, arrow-key navigation and the selected node's details |
| Signals | every signal with its current value and write count, updated as the page writes it |
| Stores | every store as JSON. Apply writes each changed top-level key with a `store-set` command |
| Effects | effects and memos with their runs, updates and durations |
| Timeline | a recording of reactive activity over time: signal writes and computation runs on lanes (see [Timeline](#timeline)) |
| Resources | resources with their last reported state |
| Router | the source the app registered with `registerInspection("router", routerInspection(router))` |
| Queries | the source the app registered with `registerInspection("query", queryInspection(client))`, pushed when the cache changes |
| Issues | runtime errors and hydration mismatches |

The toolbar has a search box (it filters the current view), **Pause** and **Resume** (recording in the page; the
label changes only after the page confirms the command), a light and dark theme (dark by default) and the
connection status. The tabs work with the arrow keys, Home and End, and motion stops when the operating system asks
for reduced motion.

### Build it

```sh
npm run build:extension -w @shadow-js/devtools
```

The build writes two folders from the same bundles, `dist/extension/chromium` and
`dist/extension/firefox`. They hold the same eight files; only `manifest.json` differs.
`npm run build -w @shadow-js/devtools` builds the library and then the extension. The folders are not part of the
published npm package.

### Load it in Chrome or Edge

1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Choose **Load unpacked** and select `dist/extension/chromium`.
3. Run your app in development on `localhost`, open DevTools and choose the **ShadowJS** tab.

Without DevTools, open the panel page of the extension: `chrome-extension://<id>/panel.html`, where the id is on
the extension's card. The panel asks the background which pages on localhost it can inspect. When there is one
it attaches to it; when there are several it lists them and you choose one. `panel.html?tabId=<id>` attaches to
the tab with that id directly.

### Firefox

Install from source as a temporary add-on (Firefox removes it when it quits):

1. Build the folders as above.
2. Open `about:debugging#/runtime/this-firefox` and choose **Load Temporary Add-on...**.
3. Select `dist/extension/firefox/manifest.json`.
4. Firefox lists the localhost access the add-on asks for. Allow it (Firefox 127 and newer are meant to ask at
   install; if the panel stays empty, check the add-on's permissions in `about:addons`).
5. Run your app in development on `localhost`, open the Firefox developer tools and choose **ShadowJS**.

The Firefox manifest is generated by the same code as the Chromium one (`extension/src/manifest.ts`). It differs
where Firefox requires it: `background.scripts` (an event page) instead of `background.service_worker`;
`browser_specific_settings.gecko` with the add-on id `devtools@shadowjs.net`, `strict_min_version` 128.0 (the first
Firefox that runs a content script in the page's `MAIN` world) and the data collection answer `none`; and the same
three loopback patterns as `host_permissions`. It has no `minimum_chrome_version`. One small adapter
(`extension/src/extension-api.ts`) reads the `browser` namespace when it exists and `chrome` otherwise, so the
scripts are the same for both browsers.

> **Status.** The Firefox build is verified by the manifest tests and by loading the same scripts in Chromium. It
> has not been run in Firefox: no Firefox was available where it was built. Before you rely on it, load it once
> and check that the panel connects. Two behaviors are expected from the documentation and unverified: whether
> Firefox keeps the event page alive while the panel's port is open (if it does not, the panel reloads and
> attaches again, as it does when Chromium stops the service worker), and whether it accepts the empty panel icon
> path.

### Timeline

The **Timeline** tab records what the reactive graph does over time. Press **Start recording**, use the app, and
press **Stop recording**. Each computation (memo or effect) that ran gets a lane; a bar is one run, as wide as its
duration, and a fainter bar means the run produced the same value. The top lane holds the signal writes. Flushes of
the scheduler are drawn as bands behind the lanes.

- **Selection explains.** Select a run to see the writes that caused it (a write names the computations subscribed
  to it) and the runs of the memos it read; select a write to see the runs it set off, up to the end of the flush
  that ran them. The causes are what the recording shows: a write older than the buffer is not listed.
- **Zoom and pan.** Buttons (Zoom in, Zoom out, Earlier, Later, Show everything), the wheel with Ctrl or Cmd, Shift
  and the wheel, or a drag. **Follow live** keeps a zoomed window on the newest entries while recording.
- **Bounded memory.** Entries live in a ring buffer (default 10 000, from 1 to 200 000 in **Buffer size**). When it is
  full the oldest entries are overwritten and counted ("N older overwritten"). Each entry keeps at most 64 ids per
  list, at most 50 000 labels are kept, and a lane draws at most 300 bars (closer bars merge), at most 200 lanes exist
  (the busiest computations) and 40 are shown until you ask for more.
- **Zero cost when idle.** Nothing is attached to the event stream until you press Start recording: no listener, no
  buffer, no request to the page. The page's hook and agent record the same events whether the tab is recording or not
  (`DVT-TL-ZO.*` counts them).
- **Export and import.** **Export JSON** saves the recording (`shadowjs-timeline.json`, `format` `shadowjs-timeline`,
  `version` 1). **Import JSON** reads one back and shows it in place of the live recording; Start recording or Clear
  returns to the live view. The file is validated as untrusted input: at most 32 MiB, a plain object with exactly the
  schema's fields, at most 200 000 entries, integer ids, numbers in range, non-decreasing sequence numbers, labels of
  at most 200 characters, and no unknown keys (so `__proto__` and `constructor` are refused). A file that fails comes back
  as a message and changes nothing.
- **Accessible.** Every control is a labeled button, field or checkbox. The plot takes the keyboard: arrows select (left
  and right along a lane, up and down between lanes), `+` and `-` zoom, Shift with an arrow pans, `0` shows everything,
  Escape clears the selection. The selection is announced in a polite status line, and the entries in view are listed in
  a table with a Select button each, so nothing needs the drawing. Nothing animates, and the layout uses logical CSS
  properties only, so it mirrors in a right-to-left browser (the time axis always runs from the earliest to the latest
  entry).

### Store submission

`npm run zip:extension -w @shadow-js/devtools` builds both folders and writes
`extension/store/shadowjs-devtools-chromium-<version>.zip` and
`extension/store/shadowjs-devtools-firefox-<version>.zip`. Each zip holds the eight built files of
its folder (checked with `unzip -t` and by the test `[DVT-EXT-ZP.1]`); they are written locally and nothing is
uploaded. The package does
not submit the extension to any store. A person does that, after reading the store's policy for development
tools.

### How it works

- `page-main.js` runs in the page's own world at `document_start`. It installs the devtools hook before the
  application's code runs, attaches an agent and serves it over `window.postMessage`. When an inspection source
  registered with `registerInspection` reports a change, it posts one inspection ping per burst of changes.
- `content.js` runs in the isolated world. It relays the agent's messages to the background and the panel's
  requests back to the page. It checks both directions: the source and origin of a message, its envelope and
  its shape. It also limits what one page can send: a burst of 2000 messages, refilled at 1000 a second, and no
  message over 1 000 000 characters of JSON. Messages it drops are counted, and the panel is not told.
- `background.js` is the service worker (Chromium) or the event page (Firefox). It pairs each tab's page port with the panel port of that tab, and
  answers a panel's request for the list of pages.
- `panel-main.js` is the panel page. It attaches to a tab, then renders the panel over a port transport. When the
  browser stops the service worker, the page reloads and attaches again, so it resynchronizes from the page's full
  state; the page's bridge reconnects on its own.

### Limits

- The Firefox build has not been run in Firefox (see [Firefox](#firefox)).
- Signals cannot be edited from the extension, because writing one needs the app's own copy of the runtime.
  Stores can be edited.
- The hover highlight of a component is not drawn on the page (the overlay draws it), and the flame graph
  of the last flushes is in the overlay only. The extension has the recording [Timeline](#timeline) instead.
- One panel per tab. The extension is not submitted to a store by this repository.

### Tests

The unit tests cover the manifests (`DVT-FX-*`), the timeline recorder, file schema, model and session
(`DVT-TL-*`), the bridge (spoofed origin and source, malformed and oversized messages, the flood limit,
the inspection ping), the relay (pairing, the page list, pings), the page side (the subscriptions of the
inspection sources), the panel's state (`panel/state.ts`, a pure reducer and the store-draft rules), the manifest
and the zip writer. DOM tests mount the Timeline tab and the panel (`timeline-view.dom.test.ts`). A real-browser run loads the built
folder into full Chromium, opens a fixture page that uses the dev runtime, and drives the standalone panel: signals,
effects, stores, resources, router, queries (pushed), pause, search, the tab keys and the theme; another records a click,
selects the run, exports, imports and refuses a hostile file.

## Security

Read this before you use the extension.

- **Development only.** The extension is a development tool and is not a production artifact. Its manifest
  matches only the three loopback hosts, so it does nothing on a deployed site. The devtools code is not in
  any production bundle (`DVT-15.*` and `DVT-EXT-*` tests). On a production build of an app the runtime reports
  nothing to the hook, so the panel stays empty.
- **Permissions.** The Chromium manifest asks for no permissions and no host permissions. The Firefox manifest asks for
  no permissions either; it lists the same three loopback patterns as `host_permissions`, which Firefox shows at install.
  `auditManifest` checks both manifests and the build fails on a violation. Each thing the extension uses needs none:
  the two content scripts match the loopback hosts in the top frame only (no `<all_urls>`); the devtools page
  uses `chrome.devtools`, which the browser grants to the DevTools window; and the background and the pages use
  `runtime.connect` and `runtime.onConnect`, which are not permissions. `tabs`, `scripting`, `storage` and
  `activeTab` are not requested. The tab ids that the page list returns come from the browser's port senders, not
  from the `tabs` API. `DVT-EXT-MF.1` fails if a permission is added.
- **Content Security Policy.** The extension pages allow scripts from the extension only
  (`script-src 'self'; object-src 'none'`). The page hook is a `MAIN`-world content script, not an inline
  `<script>` element and not a web-accessible resource, so a strict page CSP does not block it and pages cannot
  load the extension's files.
- **No eval, no remote code.** No bundle contains `eval`, `new Function`, a string timer or `document.write`:
  the build scans its output and fails when one is found. The bundles load nothing from the network.
- **Origin and source checks.** The page side accepts a message only when its source is the page's own window
  and its origin is the page's origin. The background accepts a port only from the extension's own pages and
  scripts, and only with a tab for a content script (or an `attach` with an integer tab id for the panel).
- **Message validation and limits.** Every message is checked for its envelope (`channel`, `from`, `v`, `type`)
  and the fields its type needs before it is forwarded. An events batch holds at most 2 000 events. A message is
  dropped when it is larger than 1 000 000 characters of JSON, or when its page has sent more than its rate (a
  burst of 2 000, refilled at 1 000 a second). The inspection ping is accepted only in its exact four-field shape.
  The panel checks the answer to an `inspect` request for shape and bounds (`parseInspectResult`) before it shows
  it. Anything else is dropped.
- **What the page can do.** Window messages are visible to every script of the page, so a script of the inspected
  page can post messages that look like the agent's. The panel treats what the page sends as data: it shows it,
  and it sends the page only the commands the user makes in the panel. A page script can already run any code in
  the page, so this adds no capability, but the panel can show data that did not come from the hook. Do not trust a
  value shown in the panel for a security decision.
- **What leaves the machine.** Nothing. The extension makes no network request, stores nothing (no `storage`
  permission, no `localStorage`), and sends no telemetry. The events and previews (signal values up to 80
  characters, store state) travel between the page, the extension's background and the panel, all on this
  machine.
- **Do not use it with real data.** The state of a development build can contain secrets, personal data and
  session tokens. Use the extension only on a development server with development data.

## The dev-hook protocol (version 1)

The runtime calls `hook.report(kind, a, b, c, d, e)` in development builds only. The arguments are
positional and are the runtime's own objects, so reporting allocates nothing. The hook forwards every
kind to its sinks. The agent ignores kinds it does not know, so a newer runtime degrades instead of
breaking. A sink that throws is counted in `hook.faults` and never reaches the application.

| kind | a | b | c | d | e |
| --- | --- | --- | --- | --- | --- |
| `OWNER_CREATED` | owner | parent owner or `null` | `"root"` or `"owner"` | name or `undefined` | |
| `OWNER_DISPOSED` | owner | | | | |
| `SIGNAL_CREATED` | signal node | owner or `null` | name or `undefined` | initial value (shown as a preview) | |
| `SIGNAL_WRITTEN` | signal node | next value | writing computation or `null` | observers array or `null` | |
| `COMPUTATION_CREATED` | computation | owner or `null` | `"memo"` or `"effect"` | name or `undefined` | render flag |
| `COMPUTATION_RUN` | computation | start time (ms) | duration (ms) | value changed | sources array |
| `COMPUTATION_DISPOSED` | computation | | | | |
| `COMPONENT_MOUNTED` | owner of the component | name | rendered nodes (Node, Node[] or `null`) | | |
| `COMPONENT_UNMOUNTED` | owner of the component | | | | |
| `RESOURCE_STATE` | resource handle (object) | state: `"unresolved"`, `"pending"`, `"ready"`, `"refreshing"` or `"errored"` for `useResource`; the query status or `"fetching"` for the query client | name or `undefined` | owner or `null` | |
| `ERROR` | source owner or `null` | the thrown value | diagnostic code or `undefined` | | |
| `HYDRATION_MISMATCH` | message | expected (node or text) | actual (node or text) | | |
| `FLUSH_START` | render queue size | user queue size | | | |
| `FLUSH_END` | computations run in the flush | | | | |
| `STORE_CREATED` | store handle (`name`, `snapshot()`, `set(path, value)`) | owner or `null` | | | |
| `TRANSITION_START` | | | | | |
| `TRANSITION_END` | transitions resolved | | | | |

The kind numbers are the values of `EVENT`: `OWNER_CREATED` is 1 and `TRANSITION_END` is 17. The
runtime's own call sites are listed in [Runtime integration](#runtime-integration).

Kinds 16 and 17 are reported by `transition()` (`TRANSITION_START`, with no arguments, after the
transition callback has run) and by the transition lane (`TRANSITION_END`, with the number of
transitions it resolved, when the lane is idle). The agent does not use them yet: it counts them as
ignored, like any kind it does not know.

`hook.version` must equal `PROTOCOL_VERSION` (1). Adding an event kind does not change the version;
changing the meaning of an existing argument does.

## Development only

This package is for development. Never ship it to production (the [Security](#security) section covers the
browser extension too):

- It exposes application state: component names, signal and store values, resource states and
  errors.
- It can write to signals and stores through the State tab.
- Its `BroadcastChannel` transport is readable by every script of the same origin, and its
  `postMessage` transport sends the state to the window you name.

Import it only in development code, and guard the call with `if (import.meta.env.DEV)`. The
`development` export condition resolves the full package only under `vite dev`. The production
build resolves the no-op build instead. That is a safety net, not a reason to leave the call in
your bundle.

## Production behavior

The package has two builds:

- `dist/dev` has the tools. The `development` export condition resolves to it.
- `dist/prod` is built with `__DEV__` set to `false`. The `default` export condition resolves to it.
  In that build, `installHook()` returns `undefined`, `mountDevtools()` returns a handle of no-ops,
  and nothing touches the DOM or `globalThis`. Without a `document` (on the server), `mountDevtools()`
  also returns the no-op handle.

Vite resolves the `development` condition in `vite dev` and the `default` condition in `vite build`
(its `development|production` condition resolves to `production` in a build). So `vite build` uses
the no-op build.

The package declares `"sideEffects": false`. An app that only calls `mountDevtools()` bundles to under
1000 characters with none of the tools' code left (the package's `production.dom.test.ts`, DVT-15.1).

## Cost

Recording does constant work per event. `test/perf.test.ts` (DVT-08) records 100 000 events and
checks that every buffer stays at its bound. It also checks that the second batch of 50 000 events
costs less than four times the first.

The default bounds are:

- model: 20 000 runs, 10 000 signal writes, 1 000 flushes, 200 errors, 4 000 recently disposed
  nodes (the graveyard), and 100 000 live nodes;
- agent: 10 000 raw events in the events log and 10 000 events held for subscribers;
- hook: 5 000 buffered events before the first sink attaches;
- serving: at most 2 000 events per message.

The agent holds application objects only through `WeakRef` and `WeakMap`. A signal, a store or a
resource that nothing references is released, and the finalizer removes its node from the model (DVT-16,
DVT-RTGC). Stores and resources have no dispose event of their own, so this is how they leave the model
when nothing owns them or their owner never disposes. A store's handle is anchored to the store's root
object by the runtime, so the handle lives exactly as long as the store the app can still reach. Owners and
computations are not retired by collection: an owner can be unreachable while its signals are in use, and
a computation can own signals. Their records stay until the runtime disposes them or `maxNodes` is reached.
The hook's replay buffer holds the first events (up to `buffer`) until the first sink attaches; that is
the one place the hook keeps application objects before any agent is attached.

## Runtime integration

The runtime does not import this package. The runtime's side of the protocol is
`packages/core/src/internal/devtools.ts`. Its `report()` returns at once unless `__DEV__` is true,
looks up the global hook, and calls `hook.report` only when `hook.version === 1`. Core exports it as
`devtoolsReport`, together with `DEVTOOLS_EVENT` (the kind numbers), from `@shadow-js/core/extend`.
`@shadow-js/web` imports both from there (`packages/web/src/component.ts` and
`packages/web/src/internal/claim.ts`). Each call site is wrapped in `if (__DEV__)`, so production
bundles drop it.

| Event | Where it is reported | Arguments |
| --- | --- | --- |
| `OWNER_CREATED` | `Owner` constructor (`internal/owner.ts`), only when `new.target === Owner`; computations report their own | `(owner, parent, "root" or "owner")` |
| `OWNER_DISPOSED`, `COMPUTATION_DISPOSED` | `Owner.disposeSelf()` after `disposed` is set, through `reportDisposed()`; `Computation` overrides it | `(node)` |
| `SIGNAL_CREATED` | `Signal` constructor (`internal/graph.ts`) | `(signal, owner, name, value)` |
| `SIGNAL_WRITTEN` | `writeSignal` (`extend.ts`), after the equality check and before `notify` | `(signal, next, running computation, observers)` |
| `COMPUTATION_CREATED` | `Computation` constructor (`internal/graph.ts`) | `(computation, owner, "memo" or "effect", name, render flag)` |
| `COMPUTATION_RUN` | end of `recompute` (`internal/graph.ts`), timed with `performance.now()` around the user function | `(computation, start, duration, changed, sources)` |
| `FLUSH_START`, `FLUSH_END` | `flush()` (`internal/scheduler.ts`) when it starts the loop, and in its `finally` | `(render queue size, user queue size)`; `(computations run)` |
| `ERROR` | `handleError()` (`internal/owner.ts`) | `(owner, error, diagnostic code)` |
| `COMPONENT_MOUNTED`, `COMPONENT_UNMOUNTED` | `createComponent` in `@shadow-js/web`, after the component returns; a cleanup on the component's owner | `(owner, name, result)`; `(owner)` |
| `RESOURCE_STATE` | `setState` in `useResource` (`resource.ts`), and the query client (`packages/query/src/internal/core.ts`) | `useResource`: `(resource, state, options.name, owner)`. The query client: `(entry, status or "fetching", entry hash, owner)`. The third argument is the name the code gave, and the agent shows it as the name. |
| `STORE_CREATED` | `useStore` (`store/use-store.ts`) | `({ name, snapshot, set }, owner)` |
| `HYDRATION_MISMATCH` | `claimElement` in `@shadow-js/web`, when no server element has the key | `(message, key, undefined)` |
| `TRANSITION_START`, `TRANSITION_END` | `internal/concurrency.ts`: after a transition callback runs; when the transition lane is idle | `()`; `(transitions resolved)` |

Each component runs under its own owner in every build, not only in development. That is what lets
devtools attribute an update to a component.

## Links

- [`@shadow-js/core`](https://shadowjs.net/reference/core/): the reactive engine and the `@shadow-js/core/extend` entry
  point that exports `devtoolsReport`.
- [`@shadow-js/web`](https://shadowjs.net/reference/web/): the renderer that `mountDevtools()` uses for its panel.

## Dependencies

- Runtime: none.
- Peers: `@shadow-js/core` and `@shadow-js/web` `^1.0.0`: the runtime the inspector reads and hooks into.

## Types

- Names from the root: `Backend`, `PageHooks`, `InstalledHook`, `InstallHookOptions`, `InspectorModel`, `InspectionSource`.

## Support

- Node.js `>=22.12.0`. ESM only: use `import`; `require` is not supported.
- Browsers: current evergreen releases.
- Versioning: every `@shadow-js/*` package releases together at one version. Upgrade them as one set.
- Documentation: [ShadowJS documentation](https://shadowjs.net).

## Using, changing and contributing

- **Use the package** (a person or a coding agent that builds with it): this README, and [SKILL.md](SKILL.md), the short page an agent reads first.
- **Change the package** (fix a bug, add a feature): [AGENTS.md](AGENTS.md) says how the repository is laid out, how to implement and test a change, and how a pull request is reviewed. It is written for people and coding agents alike.
- **Take part**: [CONTRIBUTING.md](CONTRIBUTING.md) is the short guide; [SECURITY.md](SECURITY.md) is for vulnerabilities.
