import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function snapshot(context = "primary:0", extra = {}) {
  return {
    csrf_token: "test-csrf", mode: "live", contacts: [], confirmed: [], last_results: [], jobs: [], results: [], sources: [], targets: [], limits: { restricted: false, not_before: 0 },
    connection: { enabled: true, state: "connected", context_id: context, active_account_id: context.split(":")[0], account: { id: 1, name: "BFF" }, groups: [], credentials_saved: true,
      accounts: [{ id: "primary", label: "BFF", account: { id: 1, name: "BFF" }, active: true, state: "connected" }], ...extra },
  };
}
async function harness(initial = snapshot(), raced = false) {
  const elements = new Map(), calls = [];
  let server = initial;
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      id, value: id === "account-label" ? "Felipe" : "", innerHTML: "", textContent: "", dataset: {}, hidden: false, disabled: false, listeners: {},
      addEventListener(type, work) { this.listeners[type] = work; }, reportValidity() { return !!this.value; },
      setAttribute(name, value) { this[name] = value; }, getAttribute(name) { return this[name]; }, removeAttribute(name) { delete this[name]; },
    });
    return elements.get(id);
  }
  const sandbox = vm.createContext({
    AbortController, URL, Date, console, crypto: { randomUUID: () => "test-only-request" },
    setTimeout: () => 1, clearTimeout() {},
    document: { hidden: false, getElementById: element, querySelectorAll: () => [] },
    window: { location: { origin: "https://app.example" }, addEventListener() {} },
    fetch: async (url, options = {}) => {
      if (!options.method) return { ok: true, json: async () => structuredClone(server) };
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      if (url.endsWith("/accounts/add")) {
        server = raced ? snapshot("yara:2", { state: "saved" }) : snapshot("felipe:1", { state: "disconnected", account: null,
          accounts: [initial.connection.accounts[0], { id: "felipe", label: "Felipe", account: null, state: "disconnected", active: true }] });
        return { ok: true, json: async () => ({ ok: true, id: "felipe", context_id: "felipe:1" }) };
      }
      return { ok: true, json: async () => ({ ok: true }) };
    },
  });
  vm.runInContext(readFileSync("public/telegram-assets/app.js", "utf8"), sandbox);
  vm.runInContext(readFileSync("public/telegram-assets/setup.js", "utf8"), sandbox);
  await new Promise((resolve) => setImmediate(resolve));
  vm.runInContext("render = () => renderSetup(false); render();", sandbox);
  return { element, calls, async submit() { element("add-account-form").listeners.submit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve)); }, render: () => vm.runInContext("render();", sandbox) };
}

test("adding Felipe starts an empty profile and requests its QR with the refreshed account context", async () => {
  const h = await harness();
  await h.submit();
  assert.equal(h.calls.length, 2);
  assert.ok(h.calls[0].url.endsWith("/accounts/add"));
  assert.deepEqual(h.calls[0].body, { label: "Felipe" });
  assert.equal(h.calls[0].headers["X-Telegram-Context"], "primary:0");
  assert.ok(h.calls[1].url.endsWith("/connection/qr"));
  assert.equal(h.calls[1].headers["X-Telegram-Context"], "felipe:1");
  assert.deepEqual(h.calls[1].body, { use_saved: true });
});

test("a concurrent account switch after draft creation prevents QR login on the newly selected account", async () => {
  const h = await harness(snapshot(), true);
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].url.endsWith("/accounts/add"));
  assert.match(h.element("notice").textContent, /mudou em outra janela/);
});

test("pending login locks the account controls and identifies which Telegram must scan", async () => {
  const h = await harness(snapshot("yara:2", { state: "qr", accounts_locked: true,
    accounts: [{ id: "yara", label: "Yara", active: true, state: "qr", account: null }],
    qr: { image: "data:image/png;base64,test", expires_at: Date.now() / 1000 + 30 },
  }));
  assert.equal(h.element("add-telegram-account").disabled, true);
  assert.equal(h.element("account-label").disabled, true);
  assert.match(h.element("qr-status").textContent, /Conectando Yara/);
});

test("account identity and labels are escaped before rendering the account chooser", async () => {
  const h = await harness(snapshot("primary:0", { accounts: [{ id: "primary", active: true, state: "connected", label: '<img src=x onerror="bad()">', account: { name: "<script>bad()</script>" } }] }));
  const rendered = h.element("telegram-account-list").innerHTML;
  assert.ok(!rendered.includes("<img"));
  assert.ok(!rendered.includes("<script>"));
  assert.match(rendered, /&lt;img/);
});
