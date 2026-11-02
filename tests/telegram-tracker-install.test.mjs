import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transformSync } from "esbuild";

const code = transformSync(readFileSync("src/lib/telegram/tracker-install.ts", "utf8"), {
  loader: "ts", format: "cjs", target: "node20",
}).code;
const compiled = { exports: {} };
new Function("require", "module", "exports", code)(() => ({}), compiled, compiled.exports);
const { TRACKER_SOURCE, STOREFRONT_URL, hasTrackerScript, verifyStorefrontTracker } = compiled.exports;
const tag = `<script defer src="${TRACKER_SOURCE}"></script>`;

test("detects the exact active tracker tag and normal HTML attribute forms", () => {
  assert.equal(hasTrackerScript(`<!doctype html><html><body>${tag}</body></html>`), true);
  assert.equal(hasTrackerScript(`<SCRIPT data-label="a > b" SRC='${TRACKER_SOURCE}'></SCRIPT>`), true);
  assert.equal(hasTrackerScript(`<script src=${TRACKER_SOURCE}></script>`), true);
});

test("module tags cannot mark the currentScript-based tracker installed", async (t) => {
  const moduleTag = `<script type="module" src="${TRACKER_SOURCE}"></script>`;
  assert.equal(hasTrackerScript(moduleTag), false);
  assert.equal(hasTrackerScript(moduleTag.replace('type="module"', 'type="MoDuLe"')), false);
  assert.equal(hasTrackerScript(moduleTag + tag), true);
  t.mock.method(globalThis, "fetch", async () => new Response(moduleTag, {
    headers: { "Content-Type": "text/html" },
  }));
  const result = await verifyStorefrontTracker();
  assert.equal(result.installed, false);
  assert.equal(result.reason, "missing");
});

test("does not mistake comments, raw text, templates or data scripts for installation", () => {
  for (const html of [
    `<!-- ${tag} -->`,
    `<script>const text = '${tag.replace("</script>", "<\\/script>")}';</script>`,
    `<textarea>${tag}</textarea>`,
    `<style>${tag}</style>`,
    `<template><template>${tag}</template></template>`,
    `<noscript>${tag}</noscript>`,
    `<script type="application/json" src="${TRACKER_SOURCE}"></script>`,
    `<script nomodule src="${TRACKER_SOURCE}"></script>`,
    `<script data-src="${TRACKER_SOURCE}"></script>`,
    `<script title='src="${TRACKER_SOURCE}"'></script>`,
    `<script src="https://example.com/other.js" src="${TRACKER_SOURCE}"></script>`,
    `<script src="${TRACKER_SOURCE}?other=1"></script>`,
    `<script src="${TRACKER_SOURCE}.invalid"></script>`,
  ]) assert.equal(hasTrackerScript(html), false, html);
  assert.equal(hasTrackerScript(`<template>${tag}</template>${tag}`), true);
});

test("verification uses only the fixed public storefront, without redirects or credentials", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (...args) => {
    calls.push(args);
    return new Response(`<html>${tag}</html>`, { headers: { "content-type": "text/html; charset=ISO-8859-1" } });
  });
  const result = await verifyStorefrontTracker();
  assert.equal(result.installed, true);
  assert.equal(result.reason, "present");
  assert.equal(result.reachable, true);
  assert.equal(result.storefrontUrl, STOREFRONT_URL);
  assert.equal(result.source, TRACKER_SOURCE);
  const [url, options] = calls[0];
  assert.equal(url.origin + url.pathname, STOREFRONT_URL);
  assert.deepEqual([...url.searchParams.keys()], ["bff_tracker_check"]);
  assert.match(url.searchParams.get("bff_tracker_check"), /^\d+$/);
  assert.equal(options.redirect, "manual");
  assert.equal(options.credentials, "omit");
  assert.equal(options.cache, "no-store");
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers.Cookie, undefined);
});

test("missing scripts and failed, redirected or non-HTML responses never mark installed", async (t) => {
  for (const [response, reason] of [
    [new Response("<html>empty</html>", { headers: { "content-type": "text/html" } }), "missing"],
    [new Response(null, { status: 302, headers: { Location: "http://127.0.0.1/" } }), "unreachable"],
    [new Response(null, { status: 403 }), "unreachable"],
    [new Response(tag, { headers: { "content-type": "application/json" } }), "non_html"],
  ]) {
    const mock = t.mock.method(globalThis, "fetch", async () => response);
    const result = await verifyStorefrontTracker();
    assert.equal(result.installed, false);
    assert.equal(result.reason, reason);
    assert.equal(mock.mock.callCount(), 1);
    mock.mock.restore();
  }
});

test("response size is bounded even without content-length", async (t) => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
    },
    cancel() { cancelled = true; },
  });
  t.mock.method(globalThis, "fetch", async () => new Response(stream, { headers: { "content-type": "text/html" } }));
  const result = await verifyStorefrontTracker();
  assert.equal(result.installed, false);
  assert.equal(result.reason, "too_large");
  assert.equal(cancelled, true);
});

test("network failures are reported without exposing response data", async (t) => {
  t.mock.method(globalThis, "fetch", async () => { throw new Error("private error details"); });
  const result = await verifyStorefrontTracker();
  assert.equal(result.installed, false);
  assert.equal(result.reachable, false);
  assert.equal(result.reason, "unreachable");
  assert.equal(JSON.stringify(result).includes("private error details"), false);
});
