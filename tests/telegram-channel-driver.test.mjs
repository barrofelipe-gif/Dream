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
      if (name.startsWith(".")) {
        let resolved = path.resolve(path.dirname(file), name);
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
const { TelegramDriver, mapError } = loader()("src/lib/telegram/driver.ts");
const TITLE = "BFF Fitness | Atacado VIP";
const mutationOptions = { maxRetryCount: 0, floodSleepThreshold: 0, timeout: 15000 };
const channel = (id, overrides = {}) => new Api.Channel({
  id: bigInt(id), accessHash: bigInt(999), title: TITLE, broadcast: true, megagroup: false,
  creator: true, left: false, date: 0, photo: new Api.ChatPhotoEmpty(), ...overrides,
});
const user = (id, username, overrides = {}) => new Api.User({
  id: bigInt(id), accessHash: bigInt(123), firstName: "Test person", username,
  phone: "test-private-phone", ...overrides,
});
const peerId = (entity) => Number(utils.getPeerId(entity));
const updates = (chats = []) => new Api.Updates({ updates: [], chats, users: [], date: 0, seq: 0 });

// The real driver operates on schema constructors from the installed SDK; no transport is created.
function harness(options = {}) {
  const target = channel(1234567890, options.target);
  const origin = channel(222222222, { title: "Public origin", broadcast: false, megagroup: true, creator: false, username: "public_origin" });
  const self = user(100, "barros_felipe");
  const other = user(200, "invited_person", options.user);
  const selected = options.own ? self : other;
  const members = new Set(options.already ? [200] : []);
  const calls = [];
  let meCalls = 0;
  const driver = Object.create(TelegramDriver.prototype);
  driver.client = {
    getMe: async () => { meCalls++; return self; },
    getDialogs: async () => options.dialogs || [{ entity: origin }, { entity: target }],
    iterParticipants: async function* (source, params) {
      assert.equal(source, origin);
      assert.equal(params.limit, 500);
      yield Object.assign(other, { participant: new Api.ChannelParticipant({ userId: other.id, date: 0 }) });
    },
    invoke: async (request, dcId, callOptions) => {
      calls.push({ request, name: request.className, dcId, options: callOptions });
      if (request instanceof Api.channels.CreateChannel) {
        assert.equal(request.title, TITLE);
        assert.equal(request.about, "");
        assert.equal(request.broadcast, true);
        assert.equal(request.megagroup, false);
        assert.deepEqual(callOptions, mutationOptions);
        if (options.createError) throw options.createError;
        return updates(options.createdChats || [target]);
      }
      if (request instanceof Api.channels.GetFullChannel) {
        assert.equal(peerId(request.channel), peerId(target));
        return {
          fullChat: new Api.ChannelFull({ id: options.fullId || target.id, about: "", participantsCount: 1, adminsCount: 1, ...options.full }),
          chats: options.freshChats || [target], users: [],
        };
      }
      if (request instanceof Api.contacts.ResolveUsername) {
        assert.equal(request.username, options.own ? "barros_felipe" : "invited_person");
        return {
          peer: options.resolvedPeer || new Api.PeerUser({ userId: selected.id }),
          users: options.resolvedUsers || [self, selected], chats: [],
        };
      }
      if (request instanceof Api.channels.GetParticipant) {
        if (request.channel === origin) return { participant: new Api.ChannelParticipant({ userId: request.participant.userId, date: 0 }) };
        assert.equal(peerId(request.channel), peerId(target));
        if (request.participant instanceof Api.InputPeerSelf) {
          return { participant: options.selfParticipant || new Api.ChannelParticipantCreator({ userId: self.id, adminRights: new Api.ChatAdminRights({}) }) };
        }
        assert.ok(request.participant instanceof Api.InputUser);
        const requestedId = Number(request.participant.userId.toString());
        if (!members.has(requestedId)) throw { errorMessage: "USER_NOT_PARTICIPANT" };
        return { participant: options.memberParticipant || new Api.ChannelParticipant({ userId: bigInt(requestedId), date: 0 }) };
      }
      if (request instanceof Api.channels.InviteToChannel) {
        assert.equal(peerId(request.channel), peerId(target));
        assert.equal(request.users.length, 1);
        assert.equal(request.users[0].userId.toString(), "200");
        assert.deepEqual(callOptions, mutationOptions);
        if (options.inviteError) throw options.inviteError;
        if (!options.missing && !options.unconfirmed) members.add(200);
        return new Api.messages.InvitedUsers({ updates: updates(), missingInvitees: options.missing ? [new Api.MissingInvitee({ userId: bigInt(200) })] : [] });
      }
      if (request instanceof Api.messages.ToggleNoForwards) {
        assert.equal(peerId(request.peer), peerId(target));
        target.noforwards = true;
        return updates();
      }
      assert.fail(`Unexpected RPC, including publishing/protection/admin changes: ${request.className}`);
    },
  };
  return { driver, target, origin, self, other, selected, members, calls, meCalls: () => meCalls, names: () => calls.map((call) => call.name) };
}

test("broadcast channels are listed as destinations and remain blocked as collection sources", async () => {
  const h = harness();
  const groups = await h.driver.groups();
  assert.deepEqual(groups.map((group) => group.kind), ["group", "channel"]);
  assert.equal(groups[0].supergroup, true);
  assert.equal(groups[1].supergroup, false);
  assert.equal(await h.driver.group(peerId(h.target), true), h.target);
  assert.equal(await h.driver.group(peerId(h.target), false, true), h.target);
  await assert.rejects(h.driver.group(peerId(h.target)), (error) => error.code === "permission");
  await assert.rejects(h.driver.collect(peerId(h.target), peerId(h.origin)), (error) => error.code === "permission");
  const contacts = await h.driver.collect(peerId(h.origin), peerId(h.target));
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].user_id, 200);
});

test("privacy/protect accept a broadcast destination and never toggle hidden participants on it", async () => {
  const h = harness();
  const privacy = await h.driver.privacy(peerId(h.target));
  assert.equal(privacy.kind, "channel");
  assert.equal(privacy.private, true);
  assert.equal(privacy.owner, true);
  assert.equal(privacy.supergroup, false);
  const protectedState = await h.driver.protect(peerId(h.target));
  assert.equal(protectedState.content_protected, true);
  assert.equal(h.names().includes("channels.ToggleParticipantsHidden"), false);
});

test("private creation confirms creator/private/broadcast/self and no discussion without any extra mutation", async () => {
  const h = harness();
  let guarded = 0;
  const result = await h.driver.createPrivateChannel(TITLE, async () => { guarded++; });
  assert.equal(guarded, 1);
  assert.equal(result.channel.id, peerId(h.target));
  assert.equal(result.channel.kind, "channel");
  assert.equal(result.channel.owner, true);
  assert.equal(result.channel.private, true);
  assert.equal(result.channel.supergroup, false);
  assert.equal(result.privacy.kind, "channel");
  assert.equal(result.privacy.group_id, peerId(h.target));
  assert.deepEqual(result.privacy.notes, []);
  assert.equal(result.privacy.content_protected, false, "creation does not change unrelated protections");
  assert.deepEqual(h.names(), ["channels.CreateChannel", "channels.GetFullChannel", "channels.GetParticipant"]);
});

test("invalid title or a rejected create guard never sends CreateChannel", async () => {
  for (const title of ["", " ", "x".repeat(129), "title\nline", undefined]) {
    const h = harness();
    await assert.rejects(h.driver.createPrivateChannel(title), (error) => error.code === "input");
    assert.deepEqual(h.names(), []);
    assert.equal(h.meCalls(), 0);
  }
  const h = harness();
  await assert.rejects(h.driver.createPrivateChannel(TITLE, async () => { throw new Error("cancelled before creation"); }), /cancelled before creation/);
  assert.deepEqual(h.names(), []);
});

test("creation never claims success for ambiguous, public, nonowned or nonbroadcast updates", async () => {
  for (const createdChats of [
    [],
    [channel(1), channel(2)],
    [channel(1, { username: "public_channel" })],
    [channel(1, { creator: false })],
    [channel(1, { broadcast: false, megagroup: true })],
  ]) {
    const h = harness({ createdChats });
    await assert.rejects(h.driver.createPrivateChannel(TITLE), (error) => error.code === "uncertain");
    assert.deepEqual(h.names(), ["channels.CreateChannel"]);
  }
});

test("post-create verification refuses linked discussion, foreign IDs, other admins or unconfirmed creator membership", async () => {
  for (const options of [
    { full: { linkedChatId: bigInt(333) } },
    { full: { adminsCount: 2 } },
    { fullId: bigInt(999) },
    { freshChats: [channel(1234567890, { creator: false })] },
    { freshChats: [channel(1234567890, { username: "public_channel" })] },
    { selfParticipant: new Api.ChannelParticipantCreator({ userId: bigInt(999), adminRights: new Api.ChatAdminRights({}) }) },
    { selfParticipant: new Api.ChannelParticipantSelf({ userId: bigInt(100), inviterId: bigInt(1), date: 0 }) },
  ]) {
    const h = harness(options);
    await assert.rejects(h.driver.createPrivateChannel(TITLE), (error) => error.code === "uncertain");
    assert.equal(h.calls.filter((call) => call.name === "channels.CreateChannel").length, 1);
    assert.equal(h.names().some((name) => /Delete|UpdateUsername|EditAdmin|SendMessage|Toggle/.test(name)), false);
  }
});

test("a create RPC error is preserved and never retried", async () => {
  const raw = { errorMessage: "FLOOD_WAIT_90", seconds: 90 };
  const h = harness({ createError: raw });
  await assert.rejects(h.driver.createPrivateChannel(TITLE), (error) => error === raw && mapError(error).code === "flood_wait");
  assert.deepEqual(h.names(), ["channels.CreateChannel"]);
});

test("testing @barros_felipe as creator returns already/owner without an invitation", async () => {
  const h = harness({ own: true });
  let guarded = 0;
  const result = await h.driver.testChannelAccount(peerId(h.target), "@barros_felipe", async () => { guarded++; });
  assert.equal(result.state, "already");
  assert.match(result.message, /proprietária/);
  assert.deepEqual(result.user, { id: 100, name: "Test person", username: "barros_felipe" });
  assert.equal(guarded, 0);
  assert.equal(h.meCalls(), 1);
  assert.deepEqual(h.names(), ["contacts.ResolveUsername", "channels.GetParticipant"]);
  const text = JSON.stringify(result);
  for (const privateValue of ["phone", "test-private-phone", "accessHash", "credentials", "apiHash"])
    assert.equal(text.includes(privateValue), false);
});

test("a different account is added only after target/self checks and a post-invite membership confirmation", async () => {
  const h = harness();
  let guarded = 0;
  const result = await h.driver.testChannelAccount(peerId(h.target), "@invited_person", async () => { guarded++; });
  assert.equal(result.state, "added");
  assert.equal(result.user.id, 200);
  assert.equal(guarded, 1);
  assert.equal(h.members.has(200), true);
  assert.deepEqual(h.names(), ["contacts.ResolveUsername", "channels.GetParticipant", "channels.InviteToChannel", "channels.GetParticipant"]);
  const confirmation = h.calls.at(-1).request;
  assert.equal(peerId(confirmation.channel), peerId(h.target));
  assert.equal(confirmation.participant.userId.toString(), "200");
});

test("already present accounts skip beforeInvite and InviteToChannel", async () => {
  const h = harness({ already: true });
  const result = await h.driver.testChannelAccount(peerId(h.target), "invited_person", async () => assert.fail("already must not dispatch"));
  assert.equal(result.state, "already");
  assert.equal(h.names().includes("channels.InviteToChannel"), false);
});

test("missing invitees and explicit privacy failures are returned as privacy, never added", async () => {
  for (const options of [
    { missing: true },
    { inviteError: { errorMessage: "USER_PRIVACY_RESTRICTED" } },
    { inviteError: { errorMessage: "USER_NOT_MUTUAL_CONTACT" } },
  ]) {
    const h = harness(options);
    const result = await h.driver.testChannelAccount(peerId(h.target), "invited_person");
    assert.equal(result.state, "privacy");
    assert.equal(h.members.has(200), false);
    assert.equal(h.calls.filter((call) => call.name === "channels.InviteToChannel").length, 1);
  }
});

test("a request with no membership confirmation or the wrong user ID remains uncertain", async () => {
  for (const options of [
    { unconfirmed: true },
    { memberParticipant: new Api.ChannelParticipant({ userId: bigInt(999), date: 0 }) },
    { memberParticipant: {} },
  ]) {
    const h = harness(options);
    await assert.rejects(h.driver.testChannelAccount(peerId(h.target), "invited_person"), (error) => error.code === "uncertain");
    assert.equal(h.calls.filter((call) => call.name === "channels.InviteToChannel").length, 1);
  }
});

test("a rejected beforeInvite guard does not dispatch and raw flood errors remain visible", async () => {
  const h = harness();
  await assert.rejects(h.driver.testChannelAccount(peerId(h.target), "invited_person", async () => { throw new Error("expired caller"); }), /expired caller/);
  assert.equal(h.names().includes("channels.InviteToChannel"), false);
  const raw = { errorMessage: "FLOOD_WAIT_15", seconds: 15 };
  const flooded = harness({ inviteError: raw });
  await assert.rejects(flooded.driver.testChannelAccount(peerId(flooded.target), "invited_person"), (error) => error === raw);
});

test("invalid users, bots, deleted accounts and auxiliary resolved users are never invited", async () => {
  for (const options of [
    { user: { bot: true } },
    { user: { deleted: true } },
    { user: { accessHash: undefined } },
    { resolvedPeer: new Api.PeerChannel({ channelId: bigInt(1) }) },
    { resolvedUsers: [user(999, "unrelated_user")] },
  ]) {
    const h = harness(options);
    await assert.rejects(h.driver.testChannelAccount(peerId(h.target), "invited_person"), (error) => error.code === "input");
    assert.equal(h.names().includes("channels.InviteToChannel"), false);
  }
});

test("testing requires an exact private broadcast target with creator or invite permission", async () => {
  for (const target of [
    { username: "public_channel" },
    { creator: false },
    { left: true },
    { broadcast: false, megagroup: true },
  ]) {
    const h = harness({ target });
    await assert.rejects(h.driver.testChannelAccount(peerId(h.target), "invited_person"), (error) => ["permission", "target_kind"].includes(error.code));
    assert.equal(h.names().includes("contacts.ResolveUsername"), false);
  }
  const admin = harness({ target: { creator: false, adminRights: new Api.ChatAdminRights({ inviteUsers: true }) } });
  assert.equal((await admin.driver.testChannelAccount(peerId(admin.target), "invited_person")).state, "added");
});

test("the ordinary queue invite path shares channel verification while still validating a group source", async () => {
  const h = harness();
  const result = await h.driver.invite(peerId(h.origin), peerId(h.target), h.driver.person(h.other));
  assert.equal(result.state, "added");
  assert.equal(h.members.has(200), true);
  const wrongSource = harness();
  await assert.rejects(wrongSource.driver.invite(peerId(wrongSource.target), peerId(wrongSource.origin), wrongSource.driver.person(wrongSource.other)), (error) => error.code === "permission");
  assert.deepEqual(wrongSource.names(), []);
});
