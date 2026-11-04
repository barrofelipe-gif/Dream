import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const native = createRequire(import.meta.url);
function loader(mocks = {}) {
  const cache = new Map();
  return function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const compiled = { exports: {} };
    cache.set(file, compiled);
    const code = transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "cjs", target: "node20" }).code;
    function require(name) {
      if (name in mocks) return mocks[name];
      if (name === "server-only") return {};
      if (name.startsWith(".") || name.startsWith("@/")) {
        let resolved = name.startsWith("@/") ? path.resolve("src", name.slice(2)) : path.resolve(path.dirname(file), name);
        if (!existsSync(resolved)) resolved += ".ts";
        return load(resolved);
      }
      return native(name);
    }
    new Function("require", "module", "exports", code)(require, compiled, compiled.exports);
    return compiled.exports;
  };
}
const domain = loader()("src/lib/telegram/domain.ts");
const context = loader({ "./domain": domain })("src/lib/telegram/request-context.ts");
const realStore = loader({
  "./domain": domain, "./request-context": context,
  "@/lib/prisma": { prisma: {} },
  "@/lib/crypto": { encrypt: (value) => `test-encrypted:${value}`, decrypt: (value) => value.slice("test-encrypted:".length) },
})("src/lib/telegram/store.ts");
const source = { id: -1, name: "Origem comercial", private: false, owner: false, can_invite: false, supergroup: true };
const target = { ...source, id: -2, name: "Comunidade comercial", private: true, owner: true, can_invite: true };
function harness() {
  let row = {
    userId: "operator", authState: "connected", authAttempt: "business-attempt", authExpiresAt: null,
    credentialsEnc: realStore.seal({ apiId: 1, apiHash: "a".repeat(32) }), sessionEnc: realStore.seal("business-session"), loginEnc: null,
    busyToken: null, busyUntil: null,
    parsed: domain.initialData({
      account: { id: 1, name: "Conta comercial de teste", username: "business_test" }, groups: [source, target], sources: [source], targets: [target],
      contacts: [{ user_id: 7, source_id: source.id, name: "Contato de teste", username: "contact_test", accessHash: "historical-private-hash", selected: true, firstCollectedAt: "2026-11-01T10:00:00.000Z" }],
      prospects: [{ id: -10, name: "Público de teste", history: [{ at: "2026-11-01T10:00:00.000Z", members: 100, delta: null }] }],
      collectionRuns: [{ id: "historical-collection", sourceId: source.id, targetId: target.id, collectedAt: "2026-11-01T10:00:00.000Z", received: 1, newContacts: 1, knownContacts: 0, totalKnown: 1 }],
    }),
  };
  let serial = 0;
  const calls = { constructed: [], logOut: [], workflows: [], loads: 0, mutations: 0 };
  const remote = new Set(["business-session"]);
  const settings = { account: { id: 1, name: "Conta comercial de teste", username: "business_test" } };
  class SentCode { constructor(input) { Object.assign(this, input); } }
  class Authorization {}
  class SendCode { constructor(input) { Object.assign(this, input); } }
  class SignIn { constructor(input) { Object.assign(this, input); } }
  class Driver {
    constructor(key, session) {
      this.credentials = key;
      this.saved = session;
      this.number = ++serial;
      calls.constructed.push(session);
      this.client = {
        connected: true,
        checkAuthorization: async () => remote.has(this.saved),
        invoke: async (request) => {
          if (request instanceof SendCode) { this.saved = `pending-session-${this.number}`; return new SentCode({ phoneCodeHash: "test-only-code" }); }
          this.saved = `authorized-session-${this.number}`; remote.add(this.saved); return new Authorization();
        },
        logOut: async () => { calls.logOut.push(this.saved); remote.delete(this.saved); },
      };
    }
    async connect() {}
    async close() {}
    save() { return this.saved; }
    async me() { if (settings.meError) throw settings.meError; return settings.account; }
  }
  const store = {
    load: async () => { calls.loads++; return structuredClone(row); },
    mutate: async (_id, fn) => {
      context.assertRequestContext(row.parsed);
      await settings.beforeMutate?.();
      const draft = structuredClone(row);
      const result = await fn(draft);
      row = draft;
      calls.mutations++;
      context.advanceRequestContext(row.parsed);
      return result;
    },
    lease: async () => {
      context.assertRequestContext(row.parsed);
      realStore.notBusy(row);
      row.busyToken = `lease-${++serial}`; row.busyUntil = new Date(Date.now() + 90000);
      return { token: row.busyToken, row: structuredClone(row) };
    },
    release: async (_id, token) => { if (row.busyToken === token) { row.busyToken = null; row.busyUntil = null; } },
    seal: realStore.seal, secret: realStore.secret, notBusy: realStore.notBusy, finishConnection: realStore.finishConnection, isAdministrator: async () => true,
  };
  const service = loader({
    "./domain": domain, "./request-context": context, "./store": store,
    "./driver": { TelegramDriver: Driver, deadline: async (work) => work, mapError: (error) => error },
    "./access": { csrf: () => "test-csrf" },
    "teleproto": { Api: { auth: { SentCode, Authorization, SendCode, SignIn }, CodeSettings: class {} } },
    "workflow/api": { start: async (...args) => { calls.workflows.push(args); } }, "@/workflows/telegram": {},
  })("src/lib/telegram/service.ts");
  return { service, row: () => row, calls, remote, settings, Driver };
}

test("paused networking blocks login, restore, group loading and enqueue before changing a saved session",async()=>{
  const h=harness(), before=structuredClone(h.row()), previous=process.env.TELEGRAM_NETWORK_PAUSED;
  process.env.TELEGRAM_NETWORK_PAUSED="1";
  try{
    const value=await h.service.state("operator");
    assert.equal(value.connection.enabled,false);
    assert.match(value.connection.operation_notice,/pausadas/);
    for(const work of [()=>h.service.begin("operator",{use_saved:true},true),()=>h.service.restore("operator"),()=>h.service.groups("operator"),()=>h.service.createJob("operator",{source_id:source.id,target_id:target.id,user_ids:[7]}),()=>h.service.control("operator",{job_id:"job",action:"resume"})])
      await assert.rejects(work,error=>error.code==="operations_paused");
    assert.deepEqual(h.row(),before);
    assert.equal(h.calls.mutations,0);
    assert.deepEqual(h.calls.constructed,[]);
    assert.deepEqual(h.calls.workflows,[]);
    assert.equal(h.remote.has("business-session"),true);
  }finally{if(previous===undefined)delete process.env.TELEGRAM_NETWORK_PAUSED;else process.env.TELEGRAM_NETWORK_PAUSED=previous;}
});

test("pausing networking still allows cancelling queued work locally",async()=>{
  const h=harness(),job=domain.enqueue(h.row().parsed,source.id,target.id,[7]),previous=process.env.TELEGRAM_NETWORK_PAUSED;
  process.env.TELEGRAM_NETWORK_PAUSED="1";
  try{
    await h.service.control("operator",{job_id:job.id,action:"cancel"});
    assert.equal(h.row().parsed.jobs[0].state,"cancelled");
    assert.deepEqual(h.calls.constructed,[]);
    assert.deepEqual(h.calls.workflows,[]);
  }finally{if(previous===undefined)delete process.env.TELEGRAM_NETWORK_PAUSED;else process.env.TELEGRAM_NETWORK_PAUSED=previous;}
});

test("a pending login can still be cancelled locally while networking is paused",async()=>{
  const h=harness(), previous=process.env.TELEGRAM_NETWORK_PAUSED;
  await h.service.addAccount("operator",{label:"Iara"});
  h.row().authState="qr";h.row().authAttempt="pending-qr";h.row().sessionEnc=realStore.seal("pending-key");
  process.env.TELEGRAM_NETWORK_PAUSED="1";
  try{
    await h.service.cancel("operator");
    assert.equal(h.row().authState,"disconnected");
    assert.equal(h.row().sessionEnc,null);
    await h.service.switchAccount("operator",{id:"primary"});
    assert.equal(realStore.secret(h.row().sessionEnc),"business-session");
    assert.equal(h.remote.has("business-session"),true);
    assert.deepEqual(h.calls.constructed,[]);
    assert.deepEqual(h.calls.logOut,[]);
  }finally{if(previous===undefined)delete process.env.TELEGRAM_NETWORK_PAUSED;else process.env.TELEGRAM_NETWORK_PAUSED=previous;}
});

test("QR and invitation workflows are explicitly pinned to Brazil",async()=>{
  const qr=harness();
  qr.row().authState="saved";
  await qr.service.begin("operator",{use_saved:true},true);
  assert.deepEqual(qr.calls.workflows[0][2],{region:"gru1"});
  const queue=harness();
  const job=await queue.service.createJob("operator",{source_id:source.id,target_id:target.id,user_ids:[7]});
  assert.deepEqual(queue.calls.workflows[0][2],{region:"gru1"});
  await queue.service.control("operator",{job_id:job.id,action:"pause"});
  await queue.service.control("operator",{job_id:job.id,action:"resume"});
  assert.deepEqual(queue.calls.workflows[1][2],{region:"gru1"});
});

test("normal connection polling reads once without writing or taking the workspace mutation lock", async () => {
  for (const authState of ["connected", "qr", "code", "password"]) {
    const h = harness();
    h.row().authState = authState;
    h.row().authExpiresAt = authState === "connected" ? null : new Date(Date.now() + 60000);
    const before = structuredClone(h.row());
    const value = await h.service.state("operator");
    assert.equal(value.connection.state, authState);
    assert.equal(h.calls.loads, 1);
    assert.equal(h.calls.mutations, 0);
    assert.deepEqual(h.row(), before);
  }
});

test("an expired login is repaired once and later polls remain read-only", async () => {
  const h = harness();
  h.row().authState = "qr";
  h.row().authExpiresAt = new Date(Date.now() - 1000);
  h.row().busyToken = "expired-lease";
  h.row().busyUntil = new Date(Date.now() - 1000);
  const value = await h.service.state("operator");
  assert.equal(value.connection.state, "qr_error");
  assert.match(value.connection.qr_error, /prazo da conexão/);
  assert.equal(h.row().busyToken, null);
  assert.equal(h.calls.mutations, 1);
  await h.service.state("operator");
  assert.equal(h.calls.mutations, 1);
});

test("an expiry detected before the lock cannot expire a newer successful authentication", async () => {
  const h = harness();
  h.row().authState = "qr";
  h.row().authExpiresAt = new Date(Date.now() - 1000);
  h.settings.beforeMutate = () => {
    h.row().authState = "connected";
    h.row().authAttempt = "new-authentication";
    h.row().authExpiresAt = null;
    h.row().sessionEnc = realStore.seal("new-retained-key");
  };
  const value = await h.service.state("operator");
  assert.equal(value.connection.state, "connected");
  assert.equal(h.row().authAttempt, "new-authentication");
  assert.equal(realStore.secret(h.row().sessionEnc), "new-retained-key");
  assert.equal(h.row().loginEnc, null);
});

test("polling still interrupts an expired in-progress invitation without resending it", async () => {
  const h = harness();
  const job = domain.enqueue(h.row().parsed, source.id, target.id, [7]);
  job.lease_until = Date.now() / 1000 - 10;
  h.row().parsed.results[0].state = "in_progress";
  await h.service.state("operator");
  assert.equal(h.row().parsed.jobs[0].state, "interrupted");
  assert.equal(h.row().parsed.results[0].state, "uncertain");
  assert.equal(h.calls.mutations, 1);
  assert.deepEqual(h.calls.workflows, []);
  assert.deepEqual(h.calls.constructed, []);
  await h.service.state("operator");
  assert.equal(h.calls.mutations, 1);
});

test("adding a labeled account parks the legacy business session and opens an empty draft with saved app keys only", async () => {
  const h = harness(), before = structuredClone(h.row());
  const initial = await h.service.state("operator");
  const primary = initial.connection.active_account_id;
  assert.equal(initial.connection.accounts.length, 1);
  const added = await h.service.addAccount("operator", { label: "Felipe" });
  assert.equal(added.ok, true);
  const result = await h.service.state("operator");
  assert.equal(added.id, result.connection.active_account_id);
  assert.equal(added.context_id, result.connection.context_id);
  assert.equal(result.connection.accounts.length, 2);
  assert.notEqual(result.connection.active_account_id, primary);
  assert.notEqual(result.connection.context_id, initial.connection.context_id);
  assert.equal(result.connection.accounts.find((item) => item.active).label, "Felipe");
  assert.equal(h.row().sessionEnc, null);
  assert.equal(h.row().credentialsEnc, before.credentialsEnc);
  assert.equal(h.row().parsed.account, undefined);
  assert.deepEqual(h.row().parsed.contacts, []);
  assert.doesNotMatch(JSON.stringify(result.connection.accounts), /business-session|test-encrypted|historical-private-hash|contextEnc|sessionEnc|credentialsEnc|apiHash/);
  await h.service.switchAccount("operator", { id: primary });
  assert.equal(realStore.secret(h.row().sessionEnc), "business-session");
  for (const key of ["contacts", "prospects", "collectionRuns", "sources", "targets"]) assert.deepEqual(h.row().parsed[key], before.parsed[key]);
  assert.deepEqual(h.calls.logOut, []);
});

test("add/switch refuse pending authentication, active jobs and a valid lease without modifying either account", async () => {
  for (const state of ["qr", "code", "password", "job", "lease"]) {
    const h = harness();
    const primary = (await h.service.state("operator")).connection.active_account_id;
    await h.service.addAccount("operator", { label: "Felipe" });
    if (["qr", "code", "password"].includes(state)) { h.row().authState = state; h.row().authExpiresAt = new Date(Date.now() + 60000); }
    if (state === "job") h.row().parsed.jobs.push({ id: "active-job", state: "paused" });
    if (state === "lease") { h.row().busyToken = "other-operation"; h.row().busyUntil = new Date(Date.now() + 60000); }
    const before = structuredClone(h.row());
    await assert.rejects(h.service.addAccount("operator", { label: "Another" }));
    await assert.rejects(h.service.switchAccount("operator", { id: primary }));
    assert.deepEqual(h.row(), before);
  }
});

test("cancelling a draft login permits switching back without revoking the parked business session", async () => {
  const h = harness();
  const primary = (await h.service.state("operator")).connection.active_account_id;
  await h.service.addAccount("operator", { label: "Felipe" });
  await h.service.begin("operator", { use_saved: true }, true);
  assert.equal(h.row().authState, "qr");
  assert.equal(h.row().sessionEnc, null);
  await h.service.cancel("operator");
  await h.service.switchAccount("operator", { id: primary });
  assert.equal(realStore.secret(h.row().sessionEnc), "business-session");
  assert.equal(h.remote.has("business-session"), true);
  assert.deepEqual(h.calls.logOut, []);
});

test("a new code login always starts with a fresh MTProto session instead of silently adopting the saved account", async () => {
  const h = harness();
  h.row().authState = "saved";
  await h.service.begin("operator", { use_saved: true, phone: "+5511999999999" }, false);
  assert.equal(h.calls.constructed[0], "");
  assert.equal(h.row().authState, "code");
  assert.match(realStore.secret(h.row().sessionEnc), /^pending-session-/);
  assert.equal(h.remote.has("business-session"), true);
});

test("an invalid phone cannot erase or cancel the active saved session", async () => {
  const h = harness();
  h.row().authState = "saved";
  const before = structuredClone(h.row());
  await assert.rejects(h.service.begin("operator", { use_saved: true, phone: "invalid" }, false), (error) => error.code === "input");
  assert.deepEqual(h.row(), before);
  assert.deepEqual(h.calls.constructed, []);
  assert.deepEqual(h.calls.logOut, []);
});

test("renaming a saved account is fenced against stale tabs and does not replace its Telegram identity", async () => {
  const h = harness();
  await h.service.addAccount("operator", { label: "Other" });
  await h.service.switchAccount("operator", { id: "primary" });
  const before = structuredClone(h.row());
  await context.withRequestContext("primary:0", async () => {
    await assert.rejects(h.service.renameAccount("operator", { id: "primary", label: "Wrong stale name" }), (error) => error.code === "account_changed");
  });
  assert.deepEqual(h.row(), before);
  await h.service.renameAccount("operator", { id: "primary", label: "Yara" });
  assert.equal(h.row().parsed.accounts.profiles[0].label, "Yara");
  assert.deepEqual(h.row().parsed.account, before.parsed.account);
  assert.equal(h.row().sessionEnc, before.sessionEnc);
  assert.deepEqual(h.calls.constructed, []);
});

test("duplicate account authentication reconnects its canonical profile without logging out the accepted session", async () => {
  const h = harness();
  const primary = (await h.service.state("operator")).connection.active_account_id;
  await h.service.addAccount("operator", { label: "Yara" });
  await h.service.begin("operator", { use_saved: true, phone: "+5511999999999" }, false);
  await h.service.verify("operator", { code: "12345" }, false);
  assert.deepEqual(h.calls.logOut, []);
  assert.equal(h.remote.has("business-session"), true);
  assert.equal(h.row().authState, "connected");
  assert.equal(h.row().parsed.accounts.activeId, primary);
  assert.equal(h.row().parsed.accounts.profiles[0].label, "Yara");
  assert.match(realStore.secret(h.row().sessionEnc), /^authorized-session-/);
  assert.deepEqual(h.row().parsed.groups, [source, target]);
});

test("a temporary identity lookup failure while restoring a saved session cannot revoke that session", async () => {
  const h = harness();
  h.row().authState = "saved";
  h.settings.meError = new Error("Temporary identity lookup failure");
  await assert.rejects(h.service.restore("operator"), /Temporary identity lookup failure/);
  assert.equal(h.row().authState, "saved");
  assert.equal(realStore.secret(h.row().sessionEnc), "business-session");
  assert.equal(h.remote.has("business-session"), true);
  assert.deepEqual(h.calls.logOut, []);
  h.settings.meError = null;
  await h.service.restore("operator");
  assert.equal(h.row().authState, "connected");
  assert.equal(h.remote.has("business-session"), true);
});

test("discard cleanup never logs out an authorization retained by a parked profile", async () => {
  const h = harness();
  await h.service.addAccount("operator", { label: "Felipe" });
  const driver = new h.Driver({ apiId: 1, apiHash: "test-only" }, "business-session");
  await assert.rejects(h.service.connected("operator", "obsolete-attempt", driver, async () => { throw new domain.TelegramError("cancelled", "Cancelled test login"); }));
  assert.deepEqual(h.calls.logOut, []);
  assert.equal(h.remote.has("business-session"), true);
});

test("new authentication of the same saved account changes context and invalidates actionable hashes while keeping history", async () => {
  const h = harness();
  h.row().authState = "saved";
  const before = structuredClone(h.row().parsed);
  const previousContext = context.accountContext(h.row().parsed);
  await h.service.begin("operator", { use_saved: true, phone: "+5511999999999" }, false);
  await h.service.verify("operator", { code: "12345" }, false);
  assert.equal(h.row().authState, "connected");
  assert.notEqual(context.accountContext(h.row().parsed), previousContext);
  assert.equal(h.row().parsed.contacts[0].selected, false);
  assert.ok(!h.row().parsed.contacts[0].accessHash);
  for (const key of ["prospects", "collectionRuns", "jobs", "results"]) assert.deepEqual(h.row().parsed[key], before[key]);
  assert.equal(h.row().parsed.contacts[0].firstCollectedAt, before.contacts[0].firstCollectedAt);
});

test("individual and bulk selection reject stale or other-account hashes while permitting safe deselection", async () => {
  const h = harness();
  h.row().parsed.accounts = { activeId: "primary", generation: 1, profiles: [{ id: "primary", label: "Comercial", account: h.row().parsed.account }] };
  const original = h.row().parsed.contacts[0];
  h.row().parsed.contacts.push(
    { ...original, user_id: 8, accountId: 1, accessHash: "current-account-hash", selected: false },
    { ...original, user_id: 9, accountId: 2, selected: true },
    { ...original, user_id: 10, accountId: 1, accessHash: "", selected: true },
  );
  for (const user_id of [7, 9, 10])
    await assert.rejects(h.service.localAction("operator", "/selection", { source_id: source.id, user_id, selected: true }), (error) => error.code === "contact_stale");
  await h.service.localAction("operator", "/selection", { source_id: source.id, user_id: 7, selected: false });
  assert.equal(h.row().parsed.contacts.find((person) => person.user_id === 7).selected, false);
  const result = await h.service.localAction("operator", "/selection/bulk", { source_id: source.id, target_id: target.id });
  assert.equal(result.selected, 1);
  assert.deepEqual(h.row().parsed.contacts.filter((person) => person.selected).map((person) => person.user_id), [8]);
});
