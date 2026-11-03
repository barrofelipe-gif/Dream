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
const { initialData, TelegramError, pair } = domain;
const TITLE = "BFF Fitness | Atacado VIP";
const requestId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const channel = { id: -100900, name: TITLE, private: true, owner: true, can_invite: true, supergroup: false, kind: "channel" };
const privacy = { group_id: channel.id, name: TITLE, private: true, owner: true, members_hidden: false, content_protected: false, supergroup: false, kind: "channel", checked_at: 1, notes: [] };
const source = { ...channel, id: -100800, name: "Origem de teste", kind: "group", supergroup: true };
function harness(t) {
  const clock = { now: Date.parse("2026-11-03T12:00:00.000Z") };
  t.mock.method(Date, "now", () => clock.now);
  const calls = { creates: 0, invites: 0, tests: 0, leases: 0, collections: 0 };
  const row = {
    userId: "operator", authState: "connected", authAttempt: "attempt", credentialsEnc: "test-credentials", sessionEnc: "test-session", loginEnc: null,
    authExpiresAt: null, busyToken: null, busyUntil: null,
    parsed: initialData({
      account: { id: 123, name: "Conta de teste", username: "criadora_teste" },
      sources: [source], targets: [source], groups: [source],
      contacts: [{ user_id: 77, name: "Contato de teste", username: "test_contact", source_id: source.id, selected: true, accessHash: "test-only-hash" }],
      collectionRuns: [{ id: "old-run", sourceId: source.id, targetId: -5, collectedAt: "2026-11-01T00:00:00.000Z", received: 1, newContacts: 1, knownContacts: 0, totalKnown: 1 }],
    }),
  };
  let admin = true;
  let create = async (_title, beforeCreate) => { await beforeCreate(); calls.creates++; return { channel, privacy }; };
  let inspect = async (_target, _handle, beforeInvite) => {
    await beforeInvite(); calls.invites++;
    return { state: "added", user: { id: 456, name: "Conta própria de teste", username: "barros_felipe" }, message: "Participação confirmada." };
  };
  let groups = [source, channel];
  let connect = async () => {};
  let deadline = async (value) => value;
  class Driver {
    async connect() { return connect(); }
    async close() {}
    save() { return "test-session"; }
    async createPrivateChannel(title, beforeCreate) { return create(title, beforeCreate); }
    async testChannelAccount(target, handle, beforeInvite) { calls.tests++; return inspect(target, handle, beforeInvite); }
    async groups() { return groups; }
    async privacy() { return privacy; }
    async collect() { calls.collections++; return []; }
  }
  // Fake only persistence/authentication and SDK boundaries; execute real service fences.
  const store = {
    load: async () => structuredClone(row),
    mutate: async (_userId, fn) => {
      const draft = structuredClone(row);
      const result = await fn(draft);
      Object.assign(row, draft);
      return result;
    },
    lease: async () => {
      calls.leases++;
      if (!admin) throw new TelegramError("permission", "Acesso revogado.", 0, 403);
      if (row.busyToken && row.busyUntil > new Date(clock.now)) throw new TelegramError("busy", "Operação em andamento.", 0, 409);
      row.busyToken = `lease-${calls.leases}`;
      row.busyUntil = new Date(clock.now + 90000);
      return { token: row.busyToken, row: structuredClone(row) };
    },
    release: async (_userId, token) => { if (row.busyToken === token) { row.busyToken = null; row.busyUntil = null; } },
    isAdministrator: async () => admin,
    secret: (value) => value === "test-credentials" ? { apiId: 1, apiHash: "test-only" } : value ?? undefined,
    seal: (value) => value,
  };
  const service = loader({
    "teleproto": { Api: {} }, "./access": { csrf: () => "test-csrf" }, "./store": store, "./domain": domain,
    "./driver": { TelegramDriver: Driver, deadline: (value) => deadline(value), mapError: (error) => error instanceof TelegramError ? error : new TelegramError("uncertain", "Resposta não confirmada.", 0, 409) },
    "workflow/api": { start: async () => { throw new Error("Unexpected workflow"); } }, "@/workflows/telegram": {},
  })("src/lib/telegram/service.ts");
  return {
    service, row, calls, clock, create: (fn) => { create = fn; }, inspect: (fn) => { inspect = fn; },
    admin: (value) => { admin = value; }, groups: (value) => { groups = value; },
    connect: (fn) => { connect = fn; }, deadline: (fn) => { deadline = fn; },
    seedChannel() {
      row.parsed.channelSetup = { creations: [{ requestId: requestId(1), title: TITLE, accountId: 123, status: "confirmed", startedAt: "2026-11-03T12:00:00.000Z", channel: structuredClone(channel), privacy: structuredClone(privacy) }], tests: [], audit: [] };
      row.parsed.groups.push(structuredClone(channel));
    },
  };
}

test("channel creation persists intention before dispatch, confirms identity, and preserves contact/history data", async (t) => {
  const h = harness(t), before = structuredClone(h.row.parsed);
  h.create(async (title, beforeCreate) => {
    assert.equal(title, TITLE);
    assert.equal(h.row.parsed.channelSetup.creations[0].status, "pending");
    assert.equal(h.row.parsed.channelSetup.creations[0].dispatchedAt, undefined);
    assert.equal((await h.service.state("operator")).connection.channel_setup.creation.status, "pending");
    await beforeCreate();
    assert.ok(h.row.parsed.channelSetup.creations[0].dispatchedAt);
    h.calls.creates++;
    return { channel, privacy };
  });
  const result = await h.service.createChannel("operator", { title: TITLE, requestId: requestId(1) });
  assert.deepEqual([result.accountId, result.channelId, result.creation.status], [123, channel.id, "confirmed"]);
  assert.ok(h.row.parsed.targets.some((group) => group.id === channel.id && group.kind === "channel"));
  for (const key of ["sources", "contacts", "collectionRuns", "jobs", "results"]) assert.deepEqual(h.row.parsed[key], before[key]);
  assert.equal(h.calls.creates, 1);
  assert.equal(h.row.parsed.channelSetup.audit.at(-1).status, "confirmed");
  assert.doesNotMatch(JSON.stringify(h.row.parsed.channelSetup), /test-only-hash|test-session|test-credentials/);
});

test("confirmed creation is idempotent for the same UUID and prevents another same-title creation", async (t) => {
  const h = harness(t);
  const first = await h.service.createChannel("operator", { title: TITLE, requestId: requestId(1) });
  const again = await h.service.createChannel("operator", { title: TITLE, requestId: requestId(1) });
  const otherId = await h.service.createChannel("operator", { title: TITLE, requestId: requestId(2) });
  assert.equal(again.channelId, first.channelId);
  assert.equal(otherId.channelId, first.channelId);
  assert.equal(h.calls.creates, 1);
  assert.equal(h.calls.leases, 1);
  await assert.rejects(h.service.createChannel("operator", { title: "Outro título", requestId: requestId(1) }), (e) => e.code === "input");
});

test("an unconfirmed creation response is retained and cannot be automatically repeated with any UUID", async (t) => {
  const h = harness(t);
  h.create(async (_title, beforeCreate) => { await beforeCreate(); h.calls.creates++; throw new Error("network loss"); });
  await assert.rejects(h.service.createChannel("operator", { title: TITLE, requestId: requestId(1) }));
  assert.equal(h.row.parsed.channelSetup.creations[0].status, "uncertain");
  for (const id of [1, 2]) await assert.rejects(h.service.createChannel("operator", { title: TITLE, requestId: requestId(id) }), (e) => e.code === "uncertain");
  assert.equal(h.calls.creates, 1);
});

test("a concurrent duplicate cannot replace the first request's pending confirmation", async (t) => {
  const h = harness(t);
  let releaseConnect, connecting;
  const connected = new Promise((resolve) => { connecting = resolve; });
  h.connect(() => { connecting(); return new Promise((resolve) => { releaseConnect = resolve; }); });
  const input = { title: TITLE, requestId: requestId(1) };
  const first = h.service.createChannel("operator", input);
  await connected;
  await assert.rejects(h.service.createChannel("operator", input), (e) => e.code === "busy");
  assert.equal(h.row.parsed.channelSetup, undefined);
  releaseConnect();
  assert.equal((await first).creation.status, "confirmed");
  assert.equal(h.calls.creates, 1);
});

test("a response arriving after the service deadline cannot convert uncertain intent to confirmed or dispatch again", async (t) => {
  const h = harness(t);
  let dispatched, finishResponse, work;
  const sent = new Promise((resolve) => { dispatched = resolve; });
  h.create(async (_title, beforeCreate) => {
    await beforeCreate(); h.calls.creates++; dispatched();
    return new Promise((resolve) => { finishResponse = () => resolve({ channel, privacy }); });
  });
  h.deadline(async (promise) => {
    work = promise;
    promise.catch(() => {});
    await sent;
    throw new TelegramError("uncertain", "Prazo da consulta encerrado.", 0, 409);
  });
  const input = { title: TITLE, requestId: requestId(1) };
  await assert.rejects(h.service.createChannel("operator", input), (e) => e.code === "uncertain");
  assert.equal(h.row.parsed.channelSetup.creations[0].status, "uncertain");
  finishResponse();
  await assert.rejects(work, (e) => e.code === "busy");
  assert.equal(h.row.parsed.channelSetup.creations[0].status, "uncertain");
  await assert.rejects(h.service.createChannel("operator", input), (e) => e.code === "uncertain");
  assert.equal(h.calls.creates, 1);
});

test("permission revocation, account replacement and expired lease prevent the mutating channel RPC", async (t) => {
  for (const change of ["role", "account", "lease"]) {
    const h = harness(t);
    h.create(async (_title, beforeCreate) => {
      if (change === "role") h.admin(false);
      if (change === "account") h.row.parsed.account.id = 999;
      if (change === "lease") h.clock.now += 90001;
      await beforeCreate();
      h.calls.creates++;
      return { channel, privacy };
    });
    await assert.rejects(h.service.createChannel("operator", { title: TITLE, requestId: requestId(1) }), (e) => ["permission", "busy"].includes(e.code));
    assert.equal(h.calls.creates, 0);
    assert.equal(h.row.parsed.channelSetup.creations[0].status, "failed");
  }
});

test("creation rejects invalid inputs and refuses unverified privacy or channel identity", async (t) => {
  const h = harness(t);
  for (const input of [{ title: TITLE, requestId: "invalid" }, { title: "x", requestId: requestId(1) }, { title: "bad\nname", requestId: requestId(1) }])
    await assert.rejects(h.service.createChannel("operator", input), (e) => e.code === "input");
  assert.equal(h.calls.leases, 0);
  h.create(async (_title, beforeCreate) => { await beforeCreate(); h.calls.creates++; return { channel: { ...channel, owner: false }, privacy }; });
  await assert.rejects(h.service.createChannel("operator", { title: TITLE, requestId: requestId(1) }), (e) => e.code === "uncertain");
  assert.equal(h.row.parsed.channelSetup.creations[0].status, "uncertain");
});

test("an already present own account needs no invite and test results never become acquisitions", async (t) => {
  const h = harness(t); h.seedChannel();
  const before = structuredClone(h.row.parsed);
  h.inspect(async (targetId, username) => {
    assert.deepEqual([targetId, username], [channel.id, "barros_felipe"]);
    return { state: "already", user: { id: 123, name: "Conta proprietária", username }, message: "A conta já é proprietária do canal." };
  });
  const input = { target_id: channel.id, username: "@barros_felipe", requestId: requestId(2) };
  const result = await h.service.testChannel("operator", input);
  assert.equal(result.state, "already");
  assert.equal((await h.service.testChannel("operator", input)).state, "already");
  assert.deepEqual([h.calls.tests, h.calls.invites], [1, 0]);
  for (const key of ["contacts", "collectionRuns", "jobs", "results"]) assert.deepEqual(h.row.parsed[key], before[key]);
});

test("a test invitation is dispatched once and records only privately confirmed membership", async (t) => {
  const h = harness(t); h.seedChannel();
  const input = { target_id: channel.id, username: "barros_felipe", requestId: requestId(2) };
  const result = await h.service.testChannel("operator", input);
  assert.equal(result.state, "added");
  assert.equal(h.row.parsed.channelSetup.tests[0].status, "added");
  assert.ok(h.row.parsed.channelSetup.tests[0].dispatchedAt);
  await h.service.testChannel("operator", input);
  assert.equal(h.calls.invites, 1);
  assert.deepEqual(h.row.parsed.results, []);
  assert.deepEqual(h.row.parsed.jobs, []);
});

test("privacy refusals and uncertain invitations are never reported as confirmed additions or retried", async (t) => {
  for (const state of ["privacy", "uncertain"]) {
    const h = harness(t); h.seedChannel();
    h.inspect(async (_target, username, beforeInvite) => {
      await beforeInvite(); h.calls.invites++;
      if (state === "uncertain") throw new Error("response lost");
      return { state, user: { id: 456, name: "Conta teste", username }, message: "O Telegram recusou por privacidade." };
    });
    const input = { target_id: channel.id, username: "barros_felipe", requestId: requestId(2) };
    if (state === "privacy") assert.equal((await h.service.testChannel("operator", input)).state, "privacy");
    else {
      await assert.rejects(h.service.testChannel("operator", input));
      for (const id of [2, 3]) await assert.rejects(h.service.testChannel("operator", { ...input, requestId: requestId(id) }), (e) => e.code === "uncertain");
    }
    assert.equal(h.row.parsed.channelSetup.tests[0].status, state);
    assert.equal(h.calls.invites, 1);
    assert.deepEqual(h.row.parsed.results, []);
  }
});

test("testing rejects unknown, other-account, nonowner or public channels and invalid handles before the SDK", async (t) => {
  for (const change of ["unknown", "account", "owner", "public", "kind"]) {
    const h = harness(t); h.seedChannel();
    const record = h.row.parsed.channelSetup.creations[0];
    if (change === "unknown") record.channel.id = -8;
    if (change === "account") record.accountId = 999;
    if (change === "owner") record.channel.owner = false;
    if (change === "public") record.channel.private = false;
    if (change === "kind") record.channel.kind = "group";
    await assert.rejects(h.service.testChannel("operator", { target_id: channel.id, username: "barros_felipe", requestId: requestId(2) }), (e) => e.code === "permission");
    assert.equal(h.calls.tests, 0);
  }
  const h = harness(t); h.seedChannel();
  await assert.rejects(h.service.testChannel("operator", { target_id: channel.id, username: "https://t.me/barros_felipe", requestId: requestId(2) }), (e) => e.code === "input");
});

test("test invitation also fences a changed account immediately before dispatch", async (t) => {
  const h = harness(t); h.seedChannel();
  h.inspect(async (_target, _username, beforeInvite) => { h.row.parsed.account.id = 999; await beforeInvite(); h.calls.invites++; });
  await assert.rejects(h.service.testChannel("operator", { target_id: channel.id, username: "barros_felipe", requestId: requestId(2) }), (e) => e.code === "busy");
  assert.equal(h.calls.invites, 0);
  assert.equal(h.row.parsed.channelSetup.tests[0].status, "failed");
});

test("state exposes only the connected account's channel setup and labels abandoned intent as unconfirmed", async (t) => {
  const h = harness(t); h.seedChannel();
  h.row.parsed.channelSetup.creations.push({ requestId: requestId(4), accountId: 999, title: "Other account", status: "confirmed", startedAt: "2026-11-03T12:00:00.000Z", channel: { ...channel, id: -999 } });
  h.row.parsed.channelSetup.tests.push({ requestId: requestId(2), accountId: 123, targetId: channel.id, username: "barros_felipe", status: "pending", startedAt: "2026-11-03T12:00:00.000Z" });
  h.row.parsed.channelSetup.activeRequest = { requestId: requestId(2), leaseToken: "expired-channel-lease" };
  h.row.busyToken = "unrelated-groups-lease";
  h.row.busyUntil = new Date(h.clock.now + 90000);
  const result = await h.service.state("operator");
  assert.equal(result.connection.channel_setup.creation.accountId, 123);
  assert.equal(result.connection.channel_setup.channel.id, channel.id);
  assert.equal(result.connection.channel_setup.test.status, "uncertain");
  assert.doesNotMatch(JSON.stringify(result.connection.channel_setup), /Other account|test-session|test-credentials|audit|leaseToken|expired-channel-lease/);
  assert.equal(h.row.parsed.channelSetup.creations.length, 2);
});

test("broadcast channels can be destinations but never configured or collected as participant origins", async (t) => {
  const h = harness(t);
  h.row.parsed.targets = [channel];
  assert.deepEqual(pair(h.row.parsed, source.id, channel.id), { sourceId: source.id, targetId: channel.id });
  h.row.parsed.sources = [channel];
  h.row.parsed.targets = [source];
  assert.throws(() => pair(h.row.parsed, channel.id, source.id), (e) => e.code === "origin_kind");
  await assert.rejects(h.service.collect("operator", { source_id: channel.id, target_id: source.id }), (e) => e.code === "origin_kind");
  await assert.rejects(h.service.configure("operator", { source_id: channel.id, target_id: source.id }), (e) => e.code === "origin_kind");
  assert.equal(h.calls.collections, 0);
});
