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
    const require = (name) => {
      if (name in mocks) return mocks[name];
      if (name === "server-only") return {};
      if (name.startsWith(".") || name.startsWith("@/")) {
        let resolved = name.startsWith("@/") ? path.resolve("src", name.slice(2)) : path.resolve(path.dirname(file), name);
        if (!existsSync(resolved)) resolved += ".ts";
        return load(resolved);
      }
      return native(name);
    };
    new Function("require", "module", "exports", code)(require, compiled, compiled.exports);
    return compiled.exports;
  };
}
const domain = loader()("src/lib/telegram/domain.ts");
const { deadline } = loader()("src/lib/telegram/driver.ts");
const { recordCollection } = loader()("src/lib/telegram/collection-history.ts");
const { saveProspectRecord } = loader()("src/lib/telegram/prospects.ts");
const realStore = loader({
  "./domain": domain,
  "@/lib/prisma": { prisma: {} },
  "@/lib/crypto": { encrypt: (value) => `test-encrypted:${value}`, decrypt: (value) => value.slice("test-encrypted:".length) },
})("src/lib/telegram/store.ts");
const source = { id: -1, name: "Source", private: false, owner: false, can_invite: false, supergroup: true };
const target = { id: -2, name: "Destination", private: true, owner: true, can_invite: true, supergroup: true };
const publicGroup = { id: -10, name: "Public", username: "fitness_public", url: "https://t.me/fitness_public", members: 100, sponsored: false };
const person = { user_id: 7, name: "Contact", username: "contact", accessHash: "test-only-hash" };
const privacy = { group_id: -2, name: "Destination", private: true, members_hidden: false, content_protected: false, owner: true, supergroup: true, checked_at: 1 };
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Real service, domain, store.finishConnection and helpers; no real SDK, database or workflow.
function harness() {
  const data = domain.initialData({ groups: [source, target], sources: [source], targets: [target], account: { id: 1, name: "Account A", username: "a" } });
  recordCollection(data, -1, -2, [person], 1_700_000_000_000, "historical-run");
  data.contacts[0].selected = true;
  data.authorizedIds = [7];
  data.discovery = { groups: [publicGroup], query: "fitness", at: Date.now() };
  data.prospects = saveProspectRecord([], publicGroup, "fitness", Date.now());
  let row = {
    userId: "A", parsed: data, authState: "connected", authAttempt: "attempt-old", authExpiresAt: null,
    credentialsEnc: realStore.seal({ apiId: 1, apiHash: "test-only-key" }),
    sessionEnc: realStore.seal("existing-session"), loginEnc: null, busyToken: null, busyUntil: null,
  };
  const remote = new Set(["existing-session"]);
  const calls = { logOut: [], closed: [], constructed: [] };
  let serial = 0;
  const settings = { timeout: 1000, administrator: true };
  const sdk = {
    groups: async () => [source, target],
    searchGroups: async () => [publicGroup],
    privacy: async () => privacy,
    protect: async () => privacy,
    collect: async () => [person],
    inspectPublicGroup: async () => ({ ...publicGroup, members: 110 }),
    connect: async () => {},
    invite: async () => ({ state: "added", message: "Confirmed by test boundary" }),
    auth: async (_kind, driver) => { driver.saved = `authorized-session-${driver.id}`; remote.add(driver.saved); },
  };
  class Authorization {}
  class SignIn { constructor(input) { Object.assign(this, input); } }
  class Driver {
    constructor(credentials, saved) {
      this.credentials = credentials;
      this.saved = saved;
      this.account = structuredClone(row.parsed.account) || { id: 99, name: "Signed in account", username: "signed_in" };
      this.id = ++serial;
      calls.constructed.push(this.id);
      this.client = {
        connected: false,
        checkAuthorization: async () => remote.has(this.saved),
        invoke: async () => { await sdk.auth("code", this); return new Authorization(); },
        signInWithPassword: async () => { await sdk.auth("password", this); },
        logOut: async () => { calls.logOut.push(this.saved); remote.delete(this.saved); },
      };
    }
    async connect() { this.client.connected = true; await sdk.connect(this); }
    async close() { calls.closed.push(this.id); this.client.connected = false; }
    save() { return this.saved; }
    async me() { return this.account; }
    async groups() { return sdk.groups(); }
    async searchGroups() { return sdk.searchGroups(); }
    async privacy() { return sdk.privacy(); }
    async protect() { return sdk.protect(); }
    async collect() { return sdk.collect(); }
    async inspectPublicGroup() { return sdk.inspectPublicGroup(); }
    async invite(_source, _target, _person, beforeInvite) {
      if (beforeInvite) await beforeInvite();
      return sdk.invite();
    }
  }
  const store = {
    load: async () => structuredClone(row),
    mutate: async (_userId, change) => {
      const draft = structuredClone(row);
      const result = await change(draft);
      row = draft;
      return result;
    },
    lease: async () => {
      if (!settings.administrator)
        throw new domain.TelegramError("permission", "Administrator access revoked", 0, 403);
      realStore.notBusy(row);
      row.busyToken = `lease-${++serial}`;
      row.busyUntil = new Date(Date.now() + 90_000);
      return { token: row.busyToken, row: structuredClone(row) };
    },
    release: async (_userId, token) => { if (row.busyToken === token) { row.busyToken = null; row.busyUntil = null; } },
    secret: realStore.secret, seal: realStore.seal, notBusy: realStore.notBusy,
    finishConnection: realStore.finishConnection, isAdministrator: async () => settings.administrator,
  };
  const mocks = {
    "./domain": domain,
    "./store": store,
    "./driver": { TelegramDriver: Driver, deadline: (promise) => deadline(promise, settings.timeout), mapError: (error) => error },
    "./access": { csrf: () => "test-csrf" },
    "teleproto": { Api: { auth: { Authorization, SignIn } } },
    "workflow/api": { start: async () => {} },
    "@/workflows/telegram": {},
  };
  return {
    service: loader(mocks)("src/lib/telegram/service.ts"),
    steps: loader(mocks)("src/lib/telegram/steps.ts"),
    row: () => row, sdk, remote, calls, settings,
    login(password = false) {
      row.authState = password ? "password" : "code";
      row.authExpiresAt = new Date(Date.now() + 60_000);
      row.loginEnc = realStore.seal({ phone: "+5511999999999", phone_code_hash: "test-only-code-hash" });
      row.sessionEnc = realStore.seal("partial-login-session");
    },
  };
}

for (const password of [false, true]) {
  test(`${password ? "password" : "code"} login cancelled during authorization revokes its discarded remote session`, async () => {
    const h = harness();
    h.login(password);
    const gate = deferred(), entered = deferred();
    h.sdk.auth = async (_kind, driver) => { entered.resolve(); await gate.promise; driver.saved = "discarded-authorized"; h.remote.add(driver.saved); };
    const pending = h.service.verify("A", password ? { password: "test-only-password" } : { code: "12345" }, password);
    const rejected = assert.rejects(pending, (error) => ["busy", "cancelled"].includes(error.code));
    await entered.promise;
    await h.service.cancel("A");
    gate.resolve();
    await rejected;
    assert.equal(h.row().authState, "disconnected");
    assert.equal(h.row().sessionEnc, null);
    assert.equal(h.remote.has("discarded-authorized"), false);
    assert.deepEqual(h.calls.logOut, ["discarded-authorized"]);
    assert.equal(h.calls.closed.length, 1);
  });
}

for (const adopted of [false, true]) {
  test(`discarding an older attempt preserves the newer ${adopted ? "same" : "different"} saved session`, async () => {
    const h = harness();
    h.login();
    const gate = deferred(), entered = deferred();
    h.sdk.auth = async (_kind, driver) => { entered.resolve(); await gate.promise; driver.saved = "old-authorized"; h.remote.add(driver.saved); };
    const pending = h.service.verify("A", { code: "12345" }, false);
    const rejected = assert.rejects(pending, (error) => error.code === "busy");
    await entered.promise;
    const currentSession = adopted ? "old-authorized" : "new-current-session";
    h.remote.add(currentSession);
    Object.assign(h.row(), {
      authState: "connected", authAttempt: "attempt-new", sessionEnc: realStore.seal(currentSession),
      busyToken: "new-lease", busyUntil: new Date(Date.now() + 90_000),
    });
    h.row().parsed.account = { id: 2, name: "New account", username: "new" };
    const current = structuredClone(h.row());
    gate.resolve();
    await rejected;
    assert.deepEqual(h.row(), current);
    assert.equal(h.remote.has(currentSession), true);
    assert.deepEqual(h.calls.logOut, adopted ? [] : ["old-authorized"]);
  });
}

test("valid code-to-password and password-to-connected transitions retain the active session", async () => {
  const h = harness();
  h.login();
  h.sdk.auth = async (kind, driver) => {
    if (kind === "code") {
      driver.saved = "partial-two-factor-session";
      throw new domain.TelegramError("password_required", "Two factor required", 0, 409);
    }
    driver.saved = "accepted-authorized-session";
    h.remote.add(driver.saved);
  };
  assert.deepEqual(await h.service.verify("A", { code: "12345" }, false), { ok: true });
  assert.equal(h.row().authState, "password");
  assert.equal(realStore.secret(h.row().sessionEnc), "partial-two-factor-session");
  assert.deepEqual(await h.service.verify("A", { password: "test-only-password" }, true), { ok: true });
  assert.equal(h.row().authState, "connected");
  assert.equal(realStore.secret(h.row().sessionEnc), "accepted-authorized-session");
  assert.equal(h.remote.has("accepted-authorized-session"), true);
  assert.deepEqual(h.calls.logOut, []);
});

test("authorization completing after timeout revokes an unchanged pre-login MTProto key", async () => {
  const h = harness();
  h.login();
  h.settings.timeout = 5;
  const gate = deferred(), entered = deferred();
  h.sdk.auth = async (_kind, driver) => {
    entered.resolve();
    await gate.promise;
    // StringSession normally contains the same auth key before and after sign-in.
    h.remote.add(driver.saved);
  };
  const pending = h.service.verify("A", { code: "12345" }, false);
  const rejected = assert.rejects(pending, (error) => error.code === "uncertain");
  await entered.promise;
  await rejected;
  const afterTimeout = structuredClone(h.row());
  gate.resolve();
  await flush();
  await flush();
  assert.equal(h.remote.has("partial-login-session"), false);
  assert.deepEqual(h.calls.logOut, ["partial-login-session"]);
  assert.deepEqual(h.row(), afterTimeout);
});

test("authorization finishing after the app login expired is discarded without accepting its session", async () => {
  const h = harness();
  h.login(true);
  const gate = deferred(), entered = deferred();
  h.sdk.auth = async (_kind, driver) => { entered.resolve(); await gate.promise; h.remote.add(driver.saved); };
  const pending = h.service.verify("A", { password: "test-only-password" }, true);
  const rejected = assert.rejects(pending, (error) => error.code === "cancelled");
  await entered.promise;
  h.row().authExpiresAt = new Date(Date.now() - 1);
  gate.resolve();
  await rejected;
  assert.notEqual(h.row().authState, "connected");
  assert.equal(h.remote.has("partial-login-session"), false);
  assert.deepEqual(h.calls.logOut, ["partial-login-session"]);
});

const lateCalls = [
  ["groups", "groups", (service) => service.groups("A"), [source, target]],
  ["discover", "searchGroups", (service) => service.discover("A", { query: "fitness" }), [publicGroup]],
  ["privacy", "privacy", (service) => service.privacy("A", -2), privacy],
  ["protect", "protect", (service) => service.privacy("A", -2, true), privacy],
  ["configure", "privacy", (service) => service.configure("A", { source_id: -1, target_id: -2 }), privacy],
  ["collect", "collect", (service) => service.collect("A", { source_id: -1, target_id: -2 }), [person]],
  ["refresh", "inspectPublicGroup", (service) => service.refreshProspect("A", { id: -10 }), { ...publicGroup, members: 110 }],
];
for (const [name, method, invoke, response] of lateCalls) {
  test(`${name} completing after timeout and disconnect cannot restore stale account data`, async () => {
    const h = harness();
    h.settings.timeout = 5;
    const gate = deferred(), entered = deferred();
    h.sdk[method] = async () => { entered.resolve(); return gate.promise; };
    const pending = invoke(h.service);
    const rejected = assert.rejects(pending, (error) => error.code === "uncertain");
    await entered.promise;
    await rejected;
    await h.service.disconnect("A");
    const disconnected = structuredClone(h.row());
    gate.resolve(response);
    await flush();
    await flush();
    assert.deepEqual(h.row(), disconnected);
    assert.equal(h.row().authState, "disconnected");
  });
}

test("a changed account with the same lease and attempt fences an old RPC result", async () => {
  const h = harness();
  const gate = deferred(), entered = deferred();
  h.sdk.groups = async () => { entered.resolve(); return gate.promise; };
  const pending = h.service.groups("A");
  const rejected = assert.rejects(pending, (error) => error.code === "busy");
  await entered.promise;
  h.row().parsed.account = { id: 2, name: "Different account", username: "different" };
  h.row().parsed.groups = [];
  gate.resolve([source, target]);
  await rejected;
  assert.deepEqual(h.row().parsed.groups, []);
  assert.equal(h.row().parsed.account.id, 2);
});

test("a stale auth failure cannot clear a newer connection or its lease", async () => {
  const h = harness();
  const gate = deferred(), entered = deferred();
  h.sdk.groups = async () => { entered.resolve(); await gate.promise; throw new domain.TelegramError("auth_required", "Old session expired", 0, 409); };
  const pending = h.service.groups("A");
  const rejected = assert.rejects(pending, (error) => error.code === "auth_required");
  await entered.promise;
  Object.assign(h.row(), { authAttempt: "new-attempt", sessionEnc: realStore.seal("new-session"), busyToken: "new-lease" });
  h.row().parsed.account = { id: 2, name: "New", username: "new" };
  const current = structuredClone(h.row());
  gate.resolve();
  await rejected;
  assert.deepEqual(h.row(), current);
});

test("disconnect clears actionable selection and discovery while retaining collection/prospect/result history", async () => {
  const h = harness();
  h.row().parsed.results = [{ job_id: "historical", user_id: 7, name: "Contact", state: "failed", message: "Historical", updated_at: 1 }];
  const before = structuredClone(h.row().parsed);
  await h.service.disconnect("A");
  const current = h.row().parsed;
  assert.equal(current.contacts[0].selected, false);
  assert.deepEqual(current.contacts, before.contacts.map((contact) => ({ ...contact, selected: false })));
  assert.deepEqual(current.collectionRuns, before.collectionRuns);
  assert.deepEqual(current.prospects, before.prospects);
  assert.deepEqual(current.results, before.results);
  assert.deepEqual(current.authorizedIds, []);
  assert.equal(current.discovery, undefined);
  assert.deepEqual(current.sources, []);
  assert.deepEqual(current.targets, []);
  assert.equal(h.row().sessionEnc, null);
  assert.equal(h.row().busyToken, null);
});

for (const mode of ["revoked", "worker-orphan", "state-orphan", "paused-before-dispatch"]) {
  test(`${mode} records the time of the result transition`, async (t) => {
    let now = 1_800_000_000_000;
    t.mock.method(Date, "now", () => now);
    const h = harness();
    const job = domain.enqueue(h.row().parsed, -1, -2, [7]);
    h.row().parsed.results[0].updated_at = 1;
    if (mode === "revoked") h.row().parsed.contacts[0].selected = false;
    if (mode.includes("orphan")) {
      h.row().parsed.results[0].state = "in_progress";
      job.lease = "orphan-lease";
      job.lease_until = now / 1000 - 1;
    }
    if (mode === "paused-before-dispatch") h.sdk.connect = async () => {
      now += 5000;
      h.row().parsed.jobs[0].state = "paused";
    };
    if (mode === "state-orphan") await h.service.state("A");
    else await h.steps.queueStep("A", job.id);
    const result = h.row().parsed.results[0];
    assert.equal(result.updated_at, now / 1000);
    assert.equal(result.state, mode === "revoked" ? "revoked" : mode === "paused-before-dispatch" ? "waiting" : "uncertain");
  });
}

test("a duplicate worker rejected without a lease cannot erase the active worker's confirmed result", async () => {
  const h = harness();
  const job = domain.enqueue(h.row().parsed, -1, -2, [7]);
  const entered = deferred(), outcome = deferred();
  let dispatched = 0;
  h.sdk.invite = async () => { dispatched++; entered.resolve(); return outcome.promise; };
  const active = h.steps.queueStep("A", job.id);
  await entered.promise;
  const duringDispatch = structuredClone(h.row());
  h.settings.administrator = false;
  assert.equal(await h.steps.queueStep("A", job.id), false);
  assert.deepEqual(h.row(), duringDispatch);
  assert.equal(h.row().parsed.results[0].state, "in_progress");
  outcome.resolve({ state: "added", message: "Participation confirmed" });
  assert.equal(await active, false);
  assert.equal(dispatched, 1);
  assert.equal(h.row().parsed.results[0].state, "added");
  assert.equal(h.row().parsed.jobs[0].state, "completed");
  assert.equal(h.row().parsed.jobs[0].success, 1);
  assert.equal(h.row().parsed.jobs[0].lease, undefined);
  assert.equal(h.row().busyToken, null);
  const completed = structuredClone(h.row());
  // A later rejected duplicate must not turn a completed job into failed either.
  assert.equal(await h.steps.queueStep("A", job.id), false);
  assert.deepEqual(h.row(), completed);
});

test("revocation before any dispatch still fails an unclaimed queued job without sending", async () => {
  const h = harness();
  const job = domain.enqueue(h.row().parsed, -1, -2, [7]);
  h.settings.administrator = false;
  let dispatched = 0;
  h.sdk.invite = async () => { dispatched++; return { state: "added", message: "Unexpected" }; };
  assert.equal(await h.steps.queueStep("A", job.id), false);
  assert.equal(dispatched, 0);
  assert.equal(h.row().parsed.jobs[0].state, "failed");
  assert.equal(h.row().parsed.results[0].state, "waiting");
  assert.equal(h.row().busyToken, null);
});
