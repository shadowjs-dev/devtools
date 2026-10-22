import { extensionApi } from "./extension-api";

// The devtools page: adds the ShadowJS panel to the DevTools window of every page it is opened on.
extensionApi().devtools?.panels.create("ShadowJS", "", "panel.html");
