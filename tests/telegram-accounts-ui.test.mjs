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
async function harness(initial = snapshot(), raced = false, failAfterWrite = false) {
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
      if (!options.method && failAfterWrite && calls.length) throw new Error("Synthetic state refresh failure");
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
  const renderAll=vm.runInContext("render",sandbox);
  vm.runInContext("render = () => renderSetup(false); render();", sandbox);
  return { element, calls, async submit() { element("add-account-form").listeners.submit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve)); },
    async rename() { element("edit-account-form").listeners.submit({ preventDefault() {} }); await new Promise((resolve) => setImmediate(resolve)); },
    render: () => vm.runInContext("render();", sandbox),
    renderAll: () => renderAll(),
    async recover() { failAfterWrite=false; await vm.runInContext("refresh();",sandbox); },
    discovery() { vm.runInContext(readFileSync("public/telegram-assets/discovery.js","utf8"),sandbox); vm.runInContext("renderDiscovery(false,false);",sandbox); },
    update(value) { server=value; sandbox.refreshed=structuredClone(value); vm.runInContext("state=refreshed;render();",sandbox); },
    advance(ms) { now+=ms; for (const [id,timer] of [...timers]) if (timer.at<=now && timers.delete(id)) timer.fn(); } };
}

test("a successful write followed by a failed refresh stays acknowledged and blocks a new inclusion until recovery",async()=>{
  const initial=snapshot();
  initial.contacts=[{user_id:7,source_id:-1,name:"Test contact",username:"test",selected:true,can_use:true}];
  initial.sources=[{id:-1,name:"Source"}];initial.targets=[{id:-2,name:"Target"}];initial.connection.configured=true;
  const h=await harness(initial,false,true);
  h.element("source").value="-1";h.element("target").value="-2";h.renderAll();
  assert.equal(h.element("start").disabled,false);
  h.element("selected-account-label").value="Iara";
  await h.rename();h.renderAll();
  assert.equal(h.calls.length,1);
  assert.match(h.element("notice").textContent,/Ação registrada/);
  assert.notEqual(h.element("notice").className,"error");
  assert.equal(h.element("start").disabled,true);
  await h.recover();h.renderAll();
  assert.equal(h.element("start").disabled,false);
  assert.equal(h.calls.length,1,"recovery only reads status; it never repeats the write");
});

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

test("a paused Telegram shows the reason and hides QR without requesting another connection",async()=>{
  const h=await harness(snapshot("iara:1",{enabled:false,state:"qr",operation_notice:"Operações Telegram pausadas após o relato de suspensão.",qr:{image:"data:image/png;base64,old",expires_at:Date.now()/1000+30}}));
  assert.equal(h.element("connection-badge").textContent,"Operações pausadas");
  assert.equal(h.element("connection-error").hidden,false);
  assert.match(h.element("connection-error").textContent,/pausadas/);
  assert.equal(h.element("qr-connection").hidden,false,"the local cancellation control stays reachable");
  assert.equal(h.element("qr-instructions").hidden,true);
  assert.equal(h.element("qr-help").hidden,true);
  assert.equal(h.element("qr-image").hidden,true);
  assert.equal(h.element("start-qr").disabled,true);
  assert.equal(h.element("retry-qr").disabled,true);
  h.update(snapshot("iara:1",{enabled:false,state:"connected",operation_notice:"Operações Telegram pausadas."}));
  h.discovery();
  assert.equal(h.element("discovery-submit").disabled,true);
  assert.match(h.element("discovery-hint").textContent,/pausadas/);
  assert.deepEqual(h.calls,[]);
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
