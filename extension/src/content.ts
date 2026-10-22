import { createPageBridge, PAGE_PORT, type PageWindow } from "./bridge";
import { extensionApi } from "./extension-api";

// The isolated-world content script (see manifest.ts): relays the page's agent messages to the background
// and the panel's requests back to the page.
const api = extensionApi();
createPageBridge({
  page: window as unknown as PageWindow,
  origin: location.origin,
  connect: () => api.runtime.connect({ name: PAGE_PORT }),
});
