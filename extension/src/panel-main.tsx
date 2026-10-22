import { useSignal } from "@shadow-js/core";
import { For, render, Show } from "@shadow-js/web";
import type { Component } from "@shadow-js/web/jsx-runtime";
import { connectRemote } from "../../src/transport";
import { createRuntimeTransport, isInspectedPing, PANEL_PORT } from "./bridge";
import { extensionApi } from "./extension-api";
import { PanelApp } from "./panel/app";
import { PANEL_STYLE } from "./panel/styles";
import { isPagesReply } from "./relay";
import { createEventTap } from "./timeline/tap";

// The panel page (see manifest.ts). Opened from the DevTools window it attaches to the inspected tab. Opened
// on its own (a tab of the extension), it asks the background which pages it can inspect: one page is attached
// at once, several are offered as a choice, and `?tabId=N` attaches to a tab directly. When the port closes
// (the browser stopped the background), the page reloads and attaches again, so there is nothing to merge.
const sheet = new CSSStyleSheet();
sheet.replaceSync(PANEL_STYLE);
document.adoptedStyleSheets = [sheet];

const api = extensionApi();
const port = api.runtime.connect({ name: PANEL_PORT });
const pingListeners = new Set<() => void>();
let onPages: ((tabIds: readonly number[]) => void) | undefined;
let attached = false;
let stopStart: (() => void) | undefined;

port.onMessage.addListener((message) => {
  if (isInspectedPing(message)) {
    for (const listener of [...pingListeners]) listener();
    return;
  }
  if (isPagesReply(message)) onPages?.(message.tabIds);
});
port.onDisconnect.addListener(() => {
  setTimeout(() => location.reload(), 1000);
});

/** Subscribes to the inspection pings of the attached page; returns the function that unsubscribes. */
const inspected = (listener: () => void): (() => void) => {
  pingListeners.add(listener);
  return () => {
    pingListeners.delete(listener);
  };
};

/** Attaches the panel to a tab, then shows the panel. Only the first attach counts. */
function attach(tabId: number): void {
  if (attached) return;
  attached = true;
  onPages = undefined;
  port.postMessage({ type: "attach", tabId });
  stopStart?.();
  // The tap lets the Timeline tab see the event batches; it forwards nothing until the user records.
  const tap = createEventTap();
  const backend = connectRemote(tap.wrap(createRuntimeTransport(port)));
  render(
    () => <PanelApp backend={backend} inspected={inspected} events={tap.subscribe} />,
    document.body,
  );
}

/** The start screen of a standalone panel: it lists the pages the background can inspect. */
const Start: Component<Record<string, never>> = () => {
  const [tabIds, setTabIds] = useSignal<readonly number[] | undefined>(undefined);
  onPages = (ids) => {
    const only = ids[0];
    if (ids.length === 1 && only !== undefined) attach(only);
    else setTabIds(ids);
  };
  return (
    <main class="shell" data-theme="dark">
      <div class="view">
        <h1>ShadowJS DevTools</h1>
        <Show
          when={tabIds() !== undefined}
          fallback={<p class="empty">Looking for ShadowJS pages on localhost…</p>}
        >
          <Show
            when={(tabIds() ?? []).length > 0}
            fallback={
              <p class="empty">
                No ShadowJS page on localhost is connected. Open the app in development, then reopen
                this panel.
              </p>
            }
          >
            <p class="note">Choose the page to inspect:</p>
            <For each={tabIds() ?? []} key={(id) => id}>
              {(id) => (
                <button type="button" class="btn" on:click={() => attach(id())}>
                  Tab {id()}
                </button>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </main>
  );
};

const requested = new URLSearchParams(location.search).get("tabId");
const devtoolsTab = api.devtools?.inspectedWindow.tabId;
if (devtoolsTab !== undefined) {
  attach(devtoolsTab);
} else if (requested !== null && /^\d+$/.test(requested)) {
  attach(Number(requested));
} else {
  stopStart = render(() => <Start />, document.body);
  port.postMessage({ type: "pages" });
}
