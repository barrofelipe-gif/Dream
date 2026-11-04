import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { transformSync } from "esbuild";

const native = createRequire(import.meta.url), cache = new Map();
function load(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const compiled = { exports: {} };
  cache.set(file, compiled);
  const code = transformSync(readFileSync(file, "utf8"), { loader: "ts", format: "cjs", target: "node20" }).code;
  new Function("require", "module", "exports", code)((name) => {
    if (name === "server-only") return {};
    if (name.startsWith(".")) {
      let target = path.resolve(path.dirname(file), name);
      if (!existsSync(target)) target += ".ts";
      return load(target);
    }
    return native(name);
  }, compiled, compiled.exports);
  return compiled.exports;
}
const { Api, utils } = native("teleproto"), bigInt = native("big-integer");
const { TelegramDriver } = load("src/lib/telegram/driver.ts");
const id = (entity) => Number(utils.getPeerId(entity));
function role(kind, userId = 7, basic = false) {
  const args = { userId: bigInt(userId), date: 0, inviterId: bigInt(99), promotedBy: bigInt(99), adminRights: new Api.ChatAdminRights({}), creator: false };
  if (kind === "admin") return basic ? new Api.ChatParticipantAdmin(args) : new Api.ChannelParticipantAdmin(args);
  if (kind === "owner") return basic ? new Api.ChatParticipantCreator(args) : new Api.ChannelParticipantCreator(args);
  if (kind === "unknown") return undefined;
  return basic ? new Api.ChatParticipant(args) : new Api.ChannelParticipant(args);
}
function person(userId, participant, extra = {}) {
  return Object.assign(new Api.User({ id: bigInt(userId), accessHash: bigInt(userId + 1000), firstName: `Test person ${userId}`, ...extra }), { participant });
}
function harness({ basic = false, currentRole = "member", people } = {}) {
  const source = basic
    ? new Api.Chat({ id: bigInt(10), title: "Source", photo: new Api.ChatPhotoEmpty(), participantsCount: 3, date: 0, version: 1 })
    : new Api.Channel({ id: bigInt(10), accessHash: bigInt(10), title: "Source", megagroup: true, broadcast: false, left: false, photo: new Api.ChatPhotoEmpty(), date: 0 });
  const target = new Api.Channel({ id: bigInt(20), accessHash: bigInt(20), title: "Private destination", megagroup: false, broadcast: true, creator: true, left: false, photo: new Api.ChatPhotoEmpty(), date: 0 });
  const calls = [], members = new Set(), state = { currentRole, denied: null, malformed: false, beforeGuard: 0 };
  const driver = Object.create(TelegramDriver.prototype);
  driver.client = {
    getDialogs: async () => [{ entity: source }, { entity: target }],
    iterParticipants: async function* () {
      for (const user of people || [person(7, role("member", 7, basic)), person(8, role("admin", 8, basic)), person(9, role("owner", 9, basic))]) yield user;
    },
    invoke: async (request) => {
      calls.push(request.className);
      if (request instanceof Api.channels.GetParticipant && request.channel === target) {
        if (!members.has(Number(request.participant.userId.toString()))) throw { errorMessage: "USER_NOT_PARTICIPANT" };
        return { participant: role("member", Number(request.participant.userId.toString())) };
      }
      if ((request instanceof Api.channels.GetParticipant && request.channel === source) || request instanceof Api.messages.GetFullChat) {
        if (state.denied) throw state.denied;
        const participant = role(state.currentRole, state.malformed ? 999 : 7, basic);
        return basic ? { fullChat: new Api.ChatFull({ id: source.id, participants: new Api.ChatParticipants({ chatId: source.id, participants: participant ? [participant] : [], version: 1 }), chatPhoto: new Api.PhotoEmpty({ id: bigInt(0) }), notifySettings: new Api.PeerNotifySettings({}), botInfo: [] }) } : { participant };
      }
      if (request instanceof Api.channels.InviteToChannel) {
        members.add(Number(request.users[0].userId.toString()));
        return { missingInvitees: [] };
      }
      assert.fail(`Unexpected RPC: ${request.className}`);
    },
  };
  const candidate = driver.person(person(7, role("member", 7, basic)));
  return { driver, source, target, calls, state,
    collect: () => driver.collect(id(source), id(target)),
    invite: () => driver.invite(id(source), id(target), candidate, async () => { state.beforeGuard++; }),
  };
}

for (const basic of [false, true]) {
  test(`collection includes only ordinary members of a ${basic ? "basic group" : "supergroup"}`, async () => {
    const h = harness({ basic });
    assert.deepEqual((await h.collect()).map((person) => person.user_id), [7]);
    assert.equal(h.calls.includes("channels.InviteToChannel"), false);
  });
  for (const currentRole of ["admin", "owner"]) test(`an old collected contact promoted to ${currentRole} in a ${basic ? "basic group" : "supergroup"} is skipped before sending`, async () => {
    const h = harness({ basic, currentRole });
    const outcome = await h.invite();
    assert.equal(outcome.state, "excluded_admin");
    assert.equal(h.state.beforeGuard, 0);
    assert.equal(h.calls.includes("channels.InviteToChannel"), false);
  });
  test(`an ordinary ${basic ? "basic group" : "supergroup"} member is rechecked before the guarded invitation`, async () => {
    const h = harness({ basic });
    assert.equal((await h.invite()).state, "added");
    assert.equal(h.state.beforeGuard, 1);
    assert.equal(h.calls.filter((name) => name === "channels.InviteToChannel").length, 1);
    const roleMethod = basic ? "messages.GetFullChat" : "channels.GetParticipant";
    assert.ok(h.calls.indexOf(roleMethod) < h.calls.indexOf("channels.InviteToChannel"));
  });
}

test("collection never treats missing or mismatched participant metadata as an ordinary member", async () => {
  for (const participant of [undefined, role("member", 999)]) {
    const h = harness({ people: [person(7, participant)] });
    await assert.rejects(h.collect(), (error) => error.code === "source_role");
    assert.deepEqual(h.calls, []);
  }
});
test("an unknown source role, unavailable role query or a FloodWait never falls back to inviting", async () => {
  for (const failure of ["unknown", "mismatch", "denied", "wait"]) {
    const h = harness({ currentRole: failure === "unknown" ? "unknown" : "member" });
    h.state.malformed = failure === "mismatch";
    if (failure === "denied") h.state.denied = { errorMessage: "CHAT_ADMIN_REQUIRED" };
    if (failure === "wait") h.state.denied = { errorMessage: "FLOOD_WAIT_60", seconds: 60 };
    await assert.rejects(h.invite());
    assert.equal(h.calls.includes("channels.InviteToChannel"), false);
    assert.equal(h.state.beforeGuard, 0);
  }
});
test("a person no longer in the source is skipped without an invitation", async () => {
  const h = harness();
  h.state.denied = { errorMessage: "USER_NOT_PARTICIPANT" };
  assert.equal((await h.invite()).state, "not_in_source");
  assert.equal(h.calls.includes("channels.InviteToChannel"), false);
});
