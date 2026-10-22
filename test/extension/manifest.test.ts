import { describe, expect, it } from "vitest";
import { FORBIDDEN, findForbidden } from "../../extension/build.mjs";
import { createManifest, FILES, LOOPBACK_MATCHES } from "../../extension/src/manifest";

const manifest = createManifest({ version: "1.0.0" });

describe("[DVT-EXT-MF] the manifest asks for the least the extension needs", () => {
  it("[DVT-EXT-MF.1] no permissions, no host permissions, no web-accessible resources", () => {
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.permissions).toEqual([]);
    expect(Object.keys(manifest)).not.toContain("host_permissions");
    expect(Object.keys(manifest)).not.toContain("web_accessible_resources");
    expect(Object.keys(manifest)).not.toContain("optional_permissions");
  });

  it("[DVT-EXT-MF.2] the content scripts run only on the loopback hosts, in the top frame, and never on <all_urls>", () => {
    const serialized = JSON.stringify(manifest);
    expect(serialized).not.toContain("<all_urls>");
    expect(serialized).not.toContain("*://*/*");
    expect(LOOPBACK_MATCHES).toEqual([
      "http://localhost/*",
      "http://127.0.0.1/*",
      "http://[::1]/*",
    ]);
    for (const script of manifest.content_scripts) {
      expect(script.matches).toEqual(LOOPBACK_MATCHES);
      expect(script.all_frames).toBe(false);
      expect(script.run_at).toBe("document_start");
    }
  });

  it("[DVT-EXT-MF.3] the page hook runs in the MAIN world at document_start, and the bridge in the isolated world", () => {
    const [bridge, hook] = manifest.content_scripts;
    expect(hook?.js).toEqual([FILES.pageMain]);
    expect(hook?.world).toBe("MAIN");
    expect(bridge?.js).toEqual([FILES.content]);
    expect(bridge?.world).toBe("ISOLATED");
  });

  it("[DVT-EXT-MF.4] the extension pages allow scripts from the extension only, and no eval", () => {
    const csp = manifest.content_security_policy.extension_pages;
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("*");
  });

  it("[DVT-EXT-MF.5] the manifest names only files the build writes, and needs Chrome 111 for MAIN-world scripts", () => {
    expect(manifest.background.service_worker).toBe(FILES.background);
    expect(manifest.devtools_page).toBe(FILES.devtoolsPage);
    expect(manifest.minimum_chrome_version).toBe("111");
    expect(manifest.version).toBe("1.0.0");
    expect(JSON.parse(JSON.stringify(manifest))).toEqual(manifest);
  });
});

describe("[DVT-EXT-BD] the build refuses dynamic code in the extension bundles", () => {
  it("[DVT-EXT-BD.1] eval, new Function, a string timer and document.write are reported", () => {
    expect(FORBIDDEN.map((entry) => entry.name)).toEqual([
      "eval",
      "new Function",
      "string timer",
      "document.write",
      "network request",
      "dynamic import",
    ]);
    expect(findForbidden("const x = eval('1')")).toEqual(["eval"]);
    expect(findForbidden("new Function('return 1')")).toEqual(["new Function"]);
    expect(findForbidden("setTimeout('x = 1', 0)")).toEqual(["string timer"]);
    expect(findForbidden("document.write('<p>')")).toEqual(["document.write"]);
  });

  it("[DVT-EXT-BD.3] a network request or a dynamic import is reported, so no bundle can send data out or load code", () => {
    expect(findForbidden("fetch('https://example.test/collect', { method: 'POST' })")).toEqual([
      "network request",
    ]);
    expect(findForbidden("new XMLHttpRequest()")).toEqual(["network request"]);
    expect(findForbidden("new WebSocket('wss://example.test')")).toEqual(["network request"]);
    expect(findForbidden("navigator.sendBeacon('/x', body)")).toEqual(["network request"]);
    expect(findForbidden("import('https://example.test/code.js')")).toEqual(["dynamic import"]);
    expect(findForbidden("resource.fetch(id); store.import(file); navigator.sendBeacon")).toEqual(
      [],
    );
  });

  it("[DVT-EXT-BD.2] ordinary code, a method named evaluate and a timer with a function are not reported", () => {
    expect(findForbidden("const v = model.evaluate(1); setTimeout(() => run(), 0);")).toEqual([]);
    expect(findForbidden("obj.eval(1)")).toEqual([]);
  });
});
