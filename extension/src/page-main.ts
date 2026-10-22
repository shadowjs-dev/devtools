import { startPageAgent } from "./page";

// The entry of the MAIN-world script (see manifest.ts). It runs once, at document_start: the hook is
// installed before the application's own scripts run, so no event is missed.
startPageAgent({ window, origin: location.origin });
