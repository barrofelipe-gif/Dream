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
  const timers = new Map();
  let now = Date.now(), nextTimer = 0;
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
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
    AbortController, URL, Date: ClockDate, console, crypto: { randomUUID: () => "test-only-request" },
    setTimeout: (fn, delay) => { const id=++nextTimer; timers.set(id,{fn,at:now+delay}); return id; },
    clearTimeout: (id) => timers.delete(id),
    document: { hidden: false, getElementById: element, querySelectorAll: () => [] },
    window: { location: { origin: "https://app.example" }, addEventListener() {} },
    fetch: async (url, options = {}) => {
      if (!options.method) return { ok: true, json: async () => structuredClone(server) };
      calls.push({ url, headers: options.headers, body: JSON.parse(options.body) });
      if (url.endsWith("/accounts/rename")) {
        server = structuredClone(server);
        server.connection.accounts.find((item) => item.id === JSON.parse(options.body).id).label = JSON.parse(options.body).label;
      }
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
  return { element, calls, async submit() { element("add-account-form").listeners.submit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve)); },
    async rename() { element("edit-account-form").listeners.submit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve)); },
    render: () => vm.runInContext("render();", sandbox),
    update(value) { server=value; sandbox.refreshed=structuredClone(value); vm.runInContext("state=refreshed;render();",sandbox); },
    advance(ms) { now+=ms; for (const [id,timer] of [...timers]) if (timer.at<=now && timers.delete(id)) timer.fn(); } };
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
  assert.equal(h.element("selected-account-label").disabled, true);
  assert.equal(h.element("rename-telegram-account").disabled, true);
  assert.match(h.element("qr-status").textContent, /Conectando Yara/);
});

test("the person's chosen name is separate from Telegram's display name and can be corrected without another account", async () => {
  const h = await harness(snapshot("primary:0", { account: { id: 1, name: "Moranga BFF" },
    accounts: [{ id: "primary", label: "Yara", active: true, state: "connected", account: { id: 1, name: "Moranga BFF" } }] }));
  assert.equal(h.element("selected-account-label").value, "Yara");
  assert.match(h.element("connection-summary").textContent, /^Yara/);
  assert.ok(!h.element("telegram-account-list").innerHTML.includes("Moranga BFF"));
  assert.match(h.element("telegram-account-list").innerHTML, /Conta Telegram identificada/);
  h.element("selected-account-label").value = "Yara pessoal";
  h.render();
  assert.equal(h.element("selected-account-label").value, "Yara pessoal", "polling preserves an unfinished label edit");
  await h.rename();
  assert.equal(h.calls.length, 1);
  assert.ok(h.calls[0].url.endsWith("/accounts/rename"));
  assert.deepEqual(h.calls[0].body, { id: "primary", label: "Yara pessoal" });
  assert.equal(h.calls[0].headers["X-Telegram-Context"], "primary:0");
  assert.match(h.element("connection-summary").textContent, /^Yara pessoal/);
});

test("an expired QR disappears on time even if the next server response never arrives", async () => {
  const initial=snapshot("iara:1",{state:"qr",qr:{image:"data:image/png;base64,old",expires_at:(Date.now()+200)/1000}});
  const h=await harness(initial);
  assert.equal(h.element("qr-image").hidden,false);
  h.advance(1000);
  assert.equal(h.element("qr-image").hidden,true);
  assert.match(h.element("qr-status").textContent,/venceu.*próximo código/);
  assert.deepEqual(h.calls,[],"expiry never starts a login or requests a new token");
});

test("an older QR expiry cannot hide a newer token or reappear after an account change",async()=>{
  const initial=snapshot("iara:1",{state:"qr",qr:{image:"data:image/png;base64,old",expires_at:(Date.now()+200)/1000}});
  const h=await harness(initial);
  const newer=snapshot("iara:1",{state:"qr",qr:{image:"data:image/png;base64,new",expires_at:(Date.now()+2000)/1000}});
  h.update(newer);
  h.advance(1000);
  assert.equal(h.element("qr-image").hidden,false);
  assert.equal(h.element("qr-image").src,newer.connection.qr.image);
  h.update(snapshot("felipe:2"));
  h.advance(1100);
  assert.equal(h.element("qr-image").hidden,true);
  assert.deepEqual(h.calls,[]);
});

test("account identity and labels are escaped before rendering the account chooser", async () => {
  const h = await harness(snapshot("primary:0", { accounts: [{ id: "primary", active: true, state: "connected", label: '<img src=x onerror="bad()">', account: { name: "<script>bad()</script>" } }] }));
  const rendered = h.element("telegram-account-list").innerHTML;
  assert.ok(!rendered.includes("<img"));
  assert.ok(!rendered.includes("<script>"));
  assert.match(rendered, /&lt;img/);
});

test("an old operation without account provenance is never attributed to an unconnected draft", async () => {
  const initial = snapshot();
  initial.connection.accounts.push({ id: "draft", label: "Felipe", account: null, active: false, state: "disconnected" });
  initial.jobs = [{ id: "legacy", state: "completed", total: 1, processed: 1, success: 1, added: 1, failed: 0, message: "Historical confirmed operation" }];
  const h = await harness(initial);
  assert.ok(!h.element("job-summary").innerHTML.includes("Conta da operação: Felipe"));
});
