import { extensionApi } from "./extension-api";
import { createRelay } from "./relay";

// The service worker: pairs each tab's page port with its panel port (see relay.ts).
const api = extensionApi();
const relay = createRelay({ extensionId: api.runtime.id });
api.runtime.onConnect.addListener((port) => relay.connect(port));
