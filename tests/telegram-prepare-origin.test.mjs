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
const { Api, utils } = native("teleproto");
const bigInt = native("big-integer");
const domain = loader()("src/lib/telegram/domain.ts");
const { TelegramDriver, mapError, deadline } = loader({ "./domain": domain })("src/lib/telegram/driver.ts");
const { saveProspectRecord } = loader()("src/lib/telegram/prospects.ts");
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };
const flush = () => new Promise((resolve) => setImmediate(resolve));

function sdkBoundary(options = {}) {
  const entity = new Api.Channel({
    id: bigInt(1234567890), accessHash: bigInt(999), title: "Public fitness group",
    username: "fitness_group", megagroup: true, broadcast: false, left: !options.joined,
    date: 0, photo: new Api.ChatPhotoEmpty(), ...options.entity,
  });
  const destination = new Api.Channel({
    id: bigInt(987654321), accessHash: bigInt(888), title: "Our private community",
    megagroup: true, creator: true, left: false, date: 0, photo: new Api.ChatPhotoEmpty(),
  });
  const calls = [];
  const targetMembers = new Set();
  const enumerations = [];
  let joined = !!options.joined;
  const boundary = {
    resolve: async () => ({ peer: new Api.PeerChannel({ channelId: entity.id }), chats: [entity] }),
    dialogs: async () => [destination, ...(joined ? [entity] : [])].map((chat) => ({ entity: chat })),
  };
  const driver = Object.create(TelegramDriver.prototype);
  driver.client = {
    invoke: async (request, dcId, callOptions) => {
      calls.push({ name: request.className, request, dcId, options: callOptions });
      if (request instanceof Api.contacts.ResolveUsername) {
        assert.equal(request.username, "fitness_group");
        return boundary.resolve();
      }
      if (request instanceof Api.channels.JoinChannel) {
        assert.equal(request.channel, entity);
        assert.deepEqual(callOptions, { maxRetryCount: 0, floodSleepThreshold: 0, timeout: 15000 });
        if (options.joinError) throw options.joinError;
        if (options.webView)
          return new Api.messages.ChatInviteJoinResultWebView({ botId: bigInt(7), queryId: bigInt(9), users: [] });
        joined = !options.unconfirmed;
        entity.left = !joined;
        return new Api.messages.ChatInviteJoinResultOk({ updates: new Api.Updates({ updates: [], chats: [], users: [], date: 0, seq: 0 }) });
      }
      if (request instanceof Api.channels.GetParticipant) {
        if (request.channel === destination) {
          assert.ok(request.participant instanceof Api.InputUser);
          const userId = Number(request.participant.userId.toString());
          if (!targetMembers.has(userId)) throw { errorMessage: "USER_NOT_PARTICIPANT" };
          return { participant: new Api.ChannelParticipant({ userId: bigInt(userId), date: 0 }) };
        }
        assert.equal(request.channel, entity);
        assert.ok(request.participant instanceof Api.InputPeerSelf);
        if (options.membershipError) throw options.membershipError;
        if (options.malformed) return { participant: {} };
        if (!joined) throw { errorMessage: "USER_NOT_PARTICIPANT" };
        return { participant: new Api.ChannelParticipantSelf({ userId: bigInt(1), inviterId: bigInt(2), date: 0 }) };
      }
      if (request instanceof Api.channels.GetFullChannel) {
        assert.equal(request.channel, destination);
        return { fullChat: new Api.ChannelFull({ id: destination.id, about: "", participantsCount: targetMembers.size }), chats: [destination], users: [] };
      }
      if (request instanceof Api.channels.InviteToChannel) {
        assert.equal(request.channel, destination);
        assert.equal(request.users.length, 1);
        targetMembers.add(Number(request.users[0].userId.toString()));
        return { missingInvitees: [] };
      }
      assert.fail(`Unexpected RPC: ${request.className}`);
    },
    getDialogs: async () => boundary.dialogs(),
    iterParticipants: async function* (source, options) {
      assert.equal(source, entity);
      assert.equal(options.limit, 500);
      enumerations.push({ sourceId: Number(utils.getPeerId(source)), limit: options.limit });
      yield new Api.User({ id: bigInt(7), accessHash: bigInt(777), firstName: "Collected lead", username: "collected_lead", bot: false, deleted: false });
    },
  };
  const id = Number(utils.getPeerId(entity));
  return { driver, entity, destination, calls, boundary, id, targetMembers, enumerations, names: () => calls.map((call) => call.name) };
}

test("prepare resolves the saved identity, joins only that public supergroup and confirms self membership", async () => {
  const h = sdkBoundary();
  let guarded = 0;
  const source = await h.driver.prepareOrigin("@fitness_group", h.id, async () => { guarded++; });
  assert.equal(source.id, h.id);
  assert.equal(source.name, "Public fitness group");
  assert.equal(source.supergroup, true);
  assert.equal(guarded, 1);
  assert.deepEqual(h.names(), ["contacts.ResolveUsername", "channels.JoinChannel", "channels.GetParticipant"]);
  assert.deepEqual(h.enumerations, []);
  assert.equal(JSON.stringify(source).includes("accessHash"), false);
});

test("an already joined origin is idempotent and never sends JoinChannel", async () => {
  const h = sdkBoundary({ joined: true });
  await h.driver.prepareOrigin("fitness_group", h.id);
  await h.driver.prepareOrigin("fitness_group", h.id);
  assert.deepEqual(h.names(), ["contacts.ResolveUsername", "channels.GetParticipant", "contacts.ResolveUsername", "channels.GetParticipant"]);
});

test("identity reuse, broadcast channels, private and flagged entities never reach join", async () => {
  for (const [options, offset, expected] of [
    [{}, -1, "group_identity"],
    [{ entity: { megagroup: false, broadcast: true } }, 0, "origin_kind"],
    [{ entity: { username: undefined } }, 0, "group_identity"],
    [{ entity: { scam: true } }, 0, "group_identity"],
    [{ entity: { fake: true } }, 0, "group_identity"],
  ]) {
    const h = sdkBoundary(options);
    await assert.rejects(h.driver.prepareOrigin("fitness_group", h.id + offset), (error) => error.code === expected);
    assert.deepEqual(h.names(), ["contacts.ResolveUsername"]);
  }
});

test("an explicit pending approval is reported as pending and never as ready", async () => {
  const h = sdkBoundary({ joinError: { errorMessage: "INVITE_REQUEST_SENT" } });
  await assert.rejects(h.driver.prepareOrigin("fitness_group", h.id), (error) => mapError(error).code === "join_pending" && mapError(error).status === 409);
  assert.deepEqual(h.names(), ["contacts.ResolveUsername", "channels.JoinChannel"]);
  const waiting = sdkBoundary({ entity: { joinRequest: true }, unconfirmed: true });
  await assert.rejects(waiting.driver.prepareOrigin("fitness_group", waiting.id), (error) => error.code === "join_pending");
});

test("the installed SDK's verification webview is surfaced without following bots or collecting", async () => {
  const h = sdkBoundary({ webView: true });
  await assert.rejects(h.driver.prepareOrigin("fitness_group", h.id), (error) => error.code === "join_verification");
  assert.deepEqual(h.names(), ["contacts.ResolveUsername", "channels.JoinChannel"]);
});

test("unconfirmed or malformed self membership cannot claim that an origin is ready", async () => {
  for (const options of [{ unconfirmed: true }, { malformed: true }]) {
    const h = sdkBoundary(options);
    await assert.rejects(h.driver.prepareOrigin("fitness_group", h.id), (error) => error.code === "join_unconfirmed");
    assert.equal(h.calls.filter((call) => call.name === "channels.JoinChannel").length, 1);
  }
});

test("flood limits, account capacity and permission refusals are preserved without retries", async () => {
  for (const [failure, expected] of [
    [{ errorMessage: "FLOOD_WAIT_123", seconds: 123 }, "flood_wait"],
    [{ errorMessage: "CHANNELS_TOO_MUCH" }, "join_limit"],
    [{ errorMessage: "USER_BANNED_IN_CHANNEL" }, "permission"],
    [{ errorMessage: "CHANNEL_PRIVATE" }, "permission"],
  ]) {
    const h = sdkBoundary({ joinError: failure });
    await assert.rejects(h.driver.prepareOrigin("fitness_group", h.id), (error) => {
      assert.equal(error, failure);
      assert.equal(mapError(error).code, expected);
      if (expected === "flood_wait") assert.equal(mapError(error).wait, 123);
      return true;
    });
    assert.equal(h.calls.filter((call) => call.name === "channels.JoinChannel").length, 1);
  }
  const h = sdkBoundary({ joined: true, membershipError: { errorMessage: "CHAT_ADMIN_REQUIRED" } });
  await assert.rejects(h.driver.prepareOrigin("fitness_group", h.id), (error) => mapError(error).code === "permission");
  assert.equal(h.names().includes("channels.JoinChannel"), false);
});

test("a cancelled caller is checked immediately before the membership-changing RPC", async () => {
  const h = sdkBoundary();
  await assert.rejects(h.driver.prepareOrigin("fitness_group", h.id, async () => {
    throw new domain.TelegramError("busy", "Caller expired", 0, 409);
  }), (error) => error.code === "busy");
  assert.deepEqual(h.names(), ["contacts.ResolveUsername"]);
});

function serviceBoundary(options = {}) {
  const sdk = sdkBoundary(options);
  const publicGroup = sdk.driver.publicGroup(sdk.entity, false, true);
  const now = Date.now();
  const data = domain.initialData({
    account: { id: 1, name: "Connected account", username: "account" },
    sources: [{ id: -5, name: "Old source" }], targets: [sdk.driver.groupInfo(sdk.destination)],
    contacts: [{ user_id: 7, name: "Historic contact", username: "contact", accessHash: "test-only-hash", source_id: -5, selected: true }],
    collectionRuns: [{ id: "old-run", sourceId: -5, targetId: -6, collectedAt: new Date(now - 1000).toISOString(), received: 1, newContacts: 1, knownContacts: 0, totalKnown: 1 }],
    prospects: saveProspectRecord([], publicGroup, "fitness", now),
  });
  let row = {
    userId: "A", parsed: data, authState: "connected", authAttempt: "attempt", authExpiresAt: null,
    credentialsEnc: "test-key", sessionEnc: "test-session", loginEnc: null, busyToken: null, busyUntil: null,
  };
  let constructed = 0, serial = 0;
  const settings = { timeout: 1000, allowQueue: false };
  const workflows = [];
  class Driver {
    constructor() {
      constructed++;
      sdk.driver.connect = async () => {};
      sdk.driver.close = async () => {};
      sdk.driver.save = () => "test-session";
      sdk.driver.me = async () => ({ id: 1, name: "Connected account", username: "account" });
      sdk.driver.client.logOut = async () => {};
      return sdk.driver;
    }
  }
  const mocks = {
    "./domain": domain,
    "./driver": { TelegramDriver: Driver, mapError, deadline: (promise) => deadline(promise, settings.timeout) },
    "./store": {
      load: async (userId) => { assert.equal(userId, "A"); return structuredClone(row); },
      mutate: async (userId, change) => {
        assert.equal(userId, "A");
        const draft = structuredClone(row), result = await change(draft);
        row = draft;
        return result;
      },
      lease: async () => {
        assert.equal(row.busyToken, null);
        row.busyToken = `lease-${++serial}`;
        row.busyUntil = new Date(Date.now() + 90_000);
        return { token: row.busyToken, row: structuredClone(row) };
      },
      release: async (_userId, token) => { if (row.busyToken === token) { row.busyToken = null; row.busyUntil = null; } },
      secret: (value) => value === "test-key" ? { apiId: 1, apiHash: "test-only-key" } : value,
      seal: (value) => value,
      notBusy: (current) => {
        if (current.busyToken && current.busyUntil?.getTime() > Date.now())
          throw new domain.TelegramError("busy", "Another operation is running", 0, 409);
      },
      isAdministrator: async () => true,
    },
    "./access": { csrf: () => "test-csrf" },
    "workflow/api": { start: async (_workflow, args) => {
      assert.equal(settings.allowQueue, true, "No workflow may start while preparing an origin");
      workflows.push(args);
    } },
    "@/workflows/telegram": { runTelegramQueue: () => {} },
  };
  const service = loader(mocks)("src/lib/telegram/service.ts");
  const steps = loader(mocks)("src/lib/telegram/steps.ts");
  return { ...sdk, service, steps, settings, workflows, row: () => row, constructed: () => constructed };
}

test("service uses the server-saved username and only refreshes groups, preserving destination and history", async () => {
  const h = serviceBoundary();
  const before = structuredClone(h.row().parsed);
  const prepared = await h.service.prepareOrigin("A", { id: h.id, username: "attacker_supplied", target_id: -666 });
  assert.equal(prepared.accountId, 1);
  assert.equal(prepared.source.id, h.id);
  assert.equal(prepared.groups.some((group) => group.id === h.id), true);
  assert.deepEqual(h.row().parsed.groups, prepared.groups);
  for (const field of ["sources", "targets", "contacts", "collectionRuns", "prospects", "jobs", "results"])
    assert.deepEqual(h.row().parsed[field], before[field], field);
  assert.equal(h.names().some((name) => /GetParticipants|InviteToChannel|AddChatUser/.test(name)), false);
});

test("a current server discovery also qualifies, and verified self membership handles a delayed dialog listing", async () => {
  const h = serviceBoundary();
  h.row().parsed.discovery = { groups: [h.driver.publicGroup(h.entity, false, true)], query: "fitness", at: Date.now() };
  h.row().parsed.prospects = [];
  h.boundary.dialogs = async () => [{ entity: h.destination }];
  const result = await h.service.prepareOrigin("A", { id: h.id });
  assert.equal(result.accountId, 1);
  assert.equal(result.groups.some((group) => group.id === h.id), true);
  assert.equal(result.source.id, h.id);
  assert.equal(h.names().includes("channels.GetParticipant"), true);
});

test("unknown IDs and saved channels are refused before constructing a client", async () => {
  const unknown = serviceBoundary();
  await assert.rejects(unknown.service.prepareOrigin("A", { id: -999, username: "fitness_group" }), (error) => error.status === 404);
  assert.equal(unknown.constructed(), 0);
  const channel = serviceBoundary({ entity: { megagroup: false, broadcast: true } });
  await assert.rejects(channel.service.prepareOrigin("A", { id: channel.id }), (error) => error.code === "origin_kind");
  assert.equal(channel.constructed(), 0);
  assert.deepEqual(channel.names(), []);
});

test("active jobs and account restrictions prevent any preparation RPC", async () => {
  for (const mode of ["job", "restricted", "wait"]) {
    const h = serviceBoundary();
    if (mode === "job") h.row().parsed.jobs = [{ id: "active", state: "running" }];
    if (mode === "restricted") h.row().parsed.limits.restricted = true;
    if (mode === "wait") h.row().parsed.limits.not_before = Date.now() / 1000 + 1000;
    await assert.rejects(h.service.prepareOrigin("A", { id: h.id }), (error) => ["busy", "restricted", "flood_wait"].includes(error.code));
    assert.equal(h.constructed(), 0);
  }
});

test("a missing or invalid connected account ID is refused before acquiring a client", async () => {
  for (const accountId of [undefined, 0, -1, NaN, "1"]) {
    const h = serviceBoundary();
    h.row().parsed.account = accountId === undefined ? undefined : { id: accountId, name: "Invalid", username: "invalid" };
    await assert.rejects(h.service.prepareOrigin("A", { id: h.id }), (error) => error.code === "auth_required");
    assert.equal(h.constructed(), 0);
    assert.deepEqual(h.names(), []);
  }
});

test("approval pending is not persisted as a ready origin", async () => {
  const h = serviceBoundary({ joinError: { errorMessage: "INVITE_REQUEST_SENT" } });
  const before = structuredClone(h.row().parsed);
  await assert.rejects(h.service.prepareOrigin("A", { id: h.id }), (error) => error.code === "join_pending");
  for (const field of ["groups", "sources", "targets", "contacts", "collectionRuns", "prospects"])
    assert.deepEqual(h.row().parsed[field], before[field], field);
});

test("an origin removed while resolving cannot start a later JoinChannel", async () => {
  const h = serviceBoundary(), gate = deferred(), entered = deferred();
  h.boundary.resolve = async () => { entered.resolve(); return gate.promise; };
  const pending = h.service.prepareOrigin("A", { id: h.id });
  const rejected = assert.rejects(pending, (error) => error.status === 404);
  await entered.promise;
  h.row().parsed.prospects = [];
  gate.resolve({ peer: new Api.PeerChannel({ channelId: h.entity.id }), chats: [h.entity] });
  await rejected;
  assert.equal(h.names().includes("channels.JoinChannel"), false);
});

for (const phase of ["resolve", "dialogs"]) {
  test(`a late ${phase} response after timeout/disconnect cannot mutate the new state`, async () => {
    const h = serviceBoundary(), gate = deferred(), entered = deferred();
    h.settings.timeout = 5;
    if (phase === "resolve") h.boundary.resolve = async () => { entered.resolve(); return gate.promise; };
    else h.boundary.dialogs = async () => { entered.resolve(); return gate.promise; };
    const pending = h.service.prepareOrigin("A", { id: h.id });
    const rejected = assert.rejects(pending, (error) => error.code === "uncertain");
    await entered.promise;
    await rejected;
    await h.service.disconnect("A");
    const after = structuredClone(h.row());
    gate.resolve(phase === "resolve"
      ? { peer: new Api.PeerChannel({ channelId: h.entity.id }), chats: [h.entity] }
      : [{ entity: h.destination }, { entity: h.entity }]);
    await flush();
    await flush();
    assert.deepEqual(h.row(), after);
    if (phase === "resolve") assert.equal(h.names().includes("channels.JoinChannel"), false);
  });
}

test("isolated composed flow prepares, configures, collects and confirms one queued addition to the exact target", async () => {
  const h = serviceBoundary();
  const targetId = Number(utils.getPeerId(h.destination));
  const originalTarget = structuredClone(h.row().parsed.targets);
  const prepared = await h.service.prepareOrigin("A", { id: h.id });
  assert.equal(prepared.accountId, 1);
  assert.equal(prepared.source.id, h.id);
  assert.deepEqual(h.row().parsed.targets, originalTarget);
  assert.deepEqual(h.enumerations, []);
  assert.equal(h.names().includes("channels.InviteToChannel"), false);
  await h.service.configure("A", { source_id: h.id, target_id: targetId });
  assert.equal(h.row().parsed.sources[0].id, h.id);
  assert.equal(h.row().parsed.targets[0].id, targetId);
  assert.equal(h.row().parsed.privacy.group_id, targetId);
  assert.equal(h.row().parsed.privacy.private, true);
  const collected = await h.service.collect("A", { source_id: h.id, target_id: targetId });
  assert.equal(collected.received, 1);
  assert.equal(collected.newContacts, 1);
  assert.deepEqual(h.enumerations, [{ sourceId: h.id, limit: 500 }]);
  const contact = h.row().parsed.contacts.find((person) => person.source_id === h.id && person.user_id === 7);
  assert.equal(contact.name, "Collected lead");
  assert.equal(contact.selected, false);
  assert.equal(h.targetMembers.has(7), false);
  assert.deepEqual(h.workflows, []);
  await h.service.localAction("A", "/selection", { source_id: h.id, user_id: 7, selected: true });
  h.settings.allowQueue = true;
  const job = await h.service.createJob("A", { source_id: h.id, target_id: targetId, user_ids: [7] });
  assert.deepEqual(h.workflows, [["A", job.id]]);
  assert.equal(h.names().includes("channels.InviteToChannel"), false);
  assert.equal(await h.steps.queueStep("A", job.id), false);
  const result = h.row().parsed.results.find((item) => item.job_id === job.id);
  const finished = h.row().parsed.jobs.find((item) => item.id === job.id);
  assert.equal(result.name, "Collected lead");
  assert.equal(result.state, "added");
  assert.equal(finished.target_id, targetId);
  assert.equal(finished.state, "completed");
  assert.equal(finished.added, 1);
  assert.equal(finished.already, 0);
  assert.equal(h.targetMembers.has(7), true);
  const invitation = h.calls.find((call) => call.name === "channels.InviteToChannel");
  assert.equal(Number(utils.getPeerId(invitation.request.channel)), targetId);
  const confirmation = h.calls.at(-1);
  assert.equal(confirmation.name, "channels.GetParticipant");
  assert.equal(confirmation.request.channel, h.destination);
  assert.equal(Number(confirmation.request.participant.userId.toString()), 7);
});
