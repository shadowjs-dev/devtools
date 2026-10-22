import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildExtensions, findForbidden } from "../../extension/build.mjs";
import { extensionApi } from "../../extension/src/extension-api";
import {
  auditManifest,
  createFirefoxManifest,
  createManifest,
  createManifestFor,
  EXTENSION_TARGETS,
  FILES,
  FIREFOX_MIN_VERSION,
  GECKO_ID,
  LOOPBACK_MATCHES,
} from "../../extension/src/manifest";

/** The Chromium manifest as the build wrote it before the Firefox build existed. It must never change. */
const CHROMIUM_GOLDEN =
  '{\n  "manifest_version": 3,\n  "name": "ShadowJS DevTools",\n  "version": "1.0.0",\n  "description": "Development only: inspect a ShadowJS app running on localhost.",\n  "minimum_chrome_version": "111",\n  "permissions": [],\n  "background": {\n    "service_worker": "background.js"\n  },\n  "content_scripts": [\n    {\n      "matches": [\n        "http://localhost/*",\n        "http://127.0.0.1/*",\n        "http://[::1]/*"\n      ],\n      "js": [\n        "content.js"\n      ],\n      "run_at": "document_start",\n      "all_frames": false,\n      "world": "ISOLATED"\n    },\n    {\n      "matches": [\n        "http://localhost/*",\n        "http://127.0.0.1/*",\n        "http://[::1]/*"\n      ],\n      "js": [\n        "page-main.js"\n      ],\n      "run_at": "document_start",\n      "all_frames": false,\n      "world": "MAIN"\n    }\n  ],\n  "devtools_page": "devtools.html",\n  "content_security_policy": {\n    "extension_pages": "script-src \'self\'; object-src \'none\'"\n  }\n}\n';

const chromium = createManifest({ version: "1.0.0" });
const firefox = createFirefoxManifest({ version: "1.0.0" });

describe("[DVT-FX-MF] the Firefox manifest is generated from the same sources", () => {
  it("[DVT-FX-MF.1] the Chromium manifest is byte-identical to the one the build wrote before", () => {
    expect(`${JSON.stringify(chromium, null, 2)}
`).toBe(CHROMIUM_GOLDEN);
    expect(createManifestFor("chromium", { version: "1.0.0" })).toEqual(chromium);
  });

  it("[DVT-FX-MF.2] Firefox gets an event page, not a service worker, and no Chrome-only key", () => {
    expect(firefox.manifest_version).toBe(3);
    expect(firefox.background).toEqual({ scripts: [FILES.background] });
    const keys = Object.keys(firefox);
    expect(keys).not.toContain("minimum_chrome_version");
    expect(JSON.stringify(firefox)).not.toContain("service_worker");
    expect(createManifestFor("firefox", { version: "1.0.0" })).toEqual(firefox);
    expect(EXTENSION_TARGETS).toEqual(["chromium", "firefox"]);
  });

  it("[DVT-FX-MF.3] the add-on id, the minimum version and the data collection answer are declared", () => {
    expect(firefox.browser_specific_settings.gecko).toEqual({
      id: GECKO_ID,
      strict_min_version: FIREFOX_MIN_VERSION,
      data_collection_permissions: { required: ["none"] },
    });
    expect(GECKO_ID).toMatch(/^[a-z0-9-]+@[a-z0-9.-]+$/);
    expect(Number.parseInt(FIREFOX_MIN_VERSION, 10)).toBeGreaterThanOrEqual(128);
  });

  it("[DVT-FX-MF.4] the permission lists: no API permission, host access to the loopback hosts only", () => {
    expect(firefox.permissions).toEqual([]);
    expect(firefox.host_permissions).toEqual(LOOPBACK_MATCHES);
    const serialized = JSON.stringify(firefox);
    expect(serialized).not.toContain("<all_urls>");
    expect(serialized).not.toContain("*://*/*");
    for (const key of [
      "optional_permissions",
      "web_accessible_resources",
      "externally_connectable",
    ]) {
      expect(Object.keys(firefox)).not.toContain(key);
    }
  });

  it("[DVT-FX-MF.5] the content scripts, the devtools page and the policy are the Chromium manifest's own", () => {
    expect(firefox.content_scripts).toEqual(chromium.content_scripts);
    expect(firefox.devtools_page).toBe(chromium.devtools_page);
    expect(firefox.content_security_policy).toEqual(chromium.content_security_policy);
    const hook = firefox.content_scripts.find((script) => script.world === "MAIN");
    expect(hook?.js).toEqual([FILES.pageMain]);
    expect(hook?.run_at).toBe("document_start");
  });

  it("[DVT-FX-MF.6] no remote code: the policy is script-src self, with no eval, inline code or remote source", () => {
    for (const manifest of [chromium, firefox]) {
      const csp = manifest.content_security_policy.extension_pages;
      expect(csp).toBe("script-src 'self'; object-src 'none'");
      expect(csp).not.toMatch(/unsafe-eval|unsafe-inline|https?:|\*|data:|blob:/);
    }
  });
});

describe("[DVT-FX-AU] the audit rejects a manifest that widens the permission policy", () => {
  it("[DVT-FX-AU.1] both generated manifests are clean", () => {
    expect(auditManifest(chromium)).toEqual([]);
    expect(auditManifest(firefox)).toEqual([]);
  });

  const widen = (patch: Record<string, unknown>): unknown => ({ ...firefox, ...patch });

  it("[DVT-FX-AU.2] an API permission, a broad host or <all_urls> is reported", () => {
    expect(auditManifest(widen({ permissions: ["tabs"] }))).not.toEqual([]);
    expect(
      auditManifest(widen({ permissions: ["scripting"], host_permissions: ["<all_urls>"] })),
    ).not.toEqual([]);
    expect(auditManifest(widen({ host_permissions: ["https://*/*"] }))).not.toEqual([]);
    expect(
      auditManifest(
        widen({ content_scripts: [{ ...firefox.content_scripts[0], matches: ["<all_urls>"] }] }),
      ),
    ).not.toEqual([]);
  });

  it("[DVT-FX-AU.3] eval, inline code, a remote source or a wildcard in the policy is reported", () => {
    for (const extension_pages of [
      "script-src 'self' 'unsafe-eval'; object-src 'none'",
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'none'",
      "script-src 'self' 'unsafe-inline'; object-src 'none'",
      "script-src 'self' https://cdn.example.test; object-src 'none'",
      "script-src 'self' *; object-src 'none'",
      "object-src 'none'",
    ]) {
      expect(auditManifest(widen({ content_security_policy: { extension_pages } }))).not.toEqual(
        [],
      );
    }
  });

  it("[DVT-FX-AU.4] a remote script file, web-accessible resources or a second frame are reported", () => {
    expect(
      auditManifest(widen({ background: { scripts: ["https://example.test/a.js"] } })),
    ).not.toEqual([]);
    expect(auditManifest(widen({ background: { scripts: ["../outside.js"] } }))).not.toEqual([]);
    expect(
      auditManifest(
        widen({ web_accessible_resources: [{ resources: ["*"], matches: ["<all_urls>"] }] }),
      ),
    ).not.toEqual([]);
    expect(
      auditManifest(
        widen({ content_scripts: [{ ...firefox.content_scripts[0], all_frames: true }] }),
      ),
    ).not.toEqual([]);
    expect(auditManifest(widen({ manifest_version: 2 }))).not.toEqual([]);
  });

  it("[DVT-FX-AU.5] a value that is not a manifest is one violation, not a crash", () => {
    for (const value of [null, undefined, 3, "x", [], {}]) {
      expect(auditManifest(value).length).toBeGreaterThan(0);
    }
  });
});

describe("[DVT-FX-API] one adapter reads the browser or chrome namespace", () => {
  const runtime = (id: string) => ({
    id,
    connect: () => ({}),
    onConnect: { addListener: () => undefined, removeListener: () => undefined },
  });

  it("[DVT-FX-API.1] browser wins when it is complete; chrome is the fallback", () => {
    const both = { browser: { runtime: runtime("fx") }, chrome: { runtime: runtime("cr") } };
    expect(extensionApi(both).runtime.id).toBe("fx");
    expect(extensionApi({ chrome: { runtime: runtime("cr") } }).runtime.id).toBe("cr");
    expect(
      extensionApi({ browser: { runtime: { id: "x" } }, chrome: { runtime: runtime("cr") } })
        .runtime.id,
    ).toBe("cr");
  });

  it("[DVT-FX-API.2] outside an extension it throws a clear error", () => {
    expect(() => extensionApi({})).toThrow(/inside the extension/);
    expect(() => extensionApi({ chrome: {} })).toThrow(/inside the extension/);
  });

  it("[DVT-FX-API.3] the devtools API passes through, and the browser's namespace is not written to", () => {
    const devtools = { inspectedWindow: { tabId: 7 }, panels: { create: () => undefined } };
    const chrome = Object.freeze({ runtime: runtime("cr"), devtools });
    const api = extensionApi({ chrome });
    expect(api.devtools?.inspectedWindow.tabId).toBe(7);
    expect(Object.keys(chrome)).toEqual(["runtime", "devtools"]);
    expect(extensionApi({ chrome: { runtime: runtime("cr") } }).devtools).toBeUndefined();
  });
});

describe("[DVT-FX-BD] the build writes both browsers' folders from the same bundles", () => {
  it("[DVT-FX-BD.1] dist/extension/chromium and dist/extension/firefox hold the same files, with their own manifest", async () => {
    const root = mkdtempSync(join(tmpdir(), "shadowjs-extension-build-"));
    try {
      const out = await buildExtensions({ version: "1.2.3", quiet: true, outRoot: root });
      expect(out).toEqual({ chromium: join(root, "chromium"), firefox: join(root, "firefox") });
      const names = readdirSync(out.chromium).sort();
      expect(readdirSync(out.firefox).sort()).toEqual(names);
      expect(names).toEqual([
        "background.js",
        "content.js",
        "devtools.html",
        "devtools.js",
        "manifest.json",
        "page-main.js",
        "panel-main.js",
        "panel.html",
      ]);
      for (const name of names.filter((file) => file !== "manifest.json")) {
        const text = readFileSync(join(out.chromium, name));
        expect(readFileSync(join(out.firefox, name)).equals(text)).toBe(true);
        if (name.endsWith(".js")) expect(findForbidden(text.toString("utf8"))).toEqual([]);
      }
      const written = (dir: string): unknown =>
        JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      expect(written(out.chromium)).toEqual(createManifest({ version: "1.2.3" }));
      expect(written(out.firefox)).toEqual(createFirefoxManifest({ version: "1.2.3" }));
      expect(readFileSync(join(out.chromium, "manifest.json"), "utf8")).toBe(
        `${JSON.stringify(createManifest({ version: "1.2.3" }), null, 2)}
`,
      );
      expect(readdirSync(root).sort()).toEqual(["chromium", "firefox"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);

  it("[DVT-FX-BD.2] a version that is not x.y.z is refused before anything is written", async () => {
    await expect(buildExtensions({ version: "1.0", quiet: true })).rejects.toThrow(/not x\.y\.z/);
  });
});
