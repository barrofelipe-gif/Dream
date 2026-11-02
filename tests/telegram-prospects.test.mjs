import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const native = createRequire(import.meta.url);
function loader() {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const code = transformSync(readFileSync(file, "utf8"), {
      loader: "ts", format: "cjs", target: "node20",
    }).code;
    function require(name) {
      if (name === "server-only") return {};
      if (name.startsWith(".")) {
        let resolved = path.resolve(path.dirname(file), name);
        if (!existsSync(resolved)) resolved += ".ts";
        return load(resolved);
      }
      return native(name);
    }
    new Function("require", "module", "exports", code)(require, loaded, loaded.exports);
    return loaded.exports;
  }
  return load;
}
const load = loader();
const { normalizeProspect, saveProspectRecord, recordProspectCheck, nextProspectCheck } = load("src/lib/telegram/prospects.ts");
const { TelegramDriver } = load("src/lib/telegram/driver.ts");
const { Api, utils } = native("teleproto"), bigInt = native("big-integer");
const at = (value) => Date.parse(value);
const first = "2026-01-31T13:14:15.123Z";
const group = (extra = {}) => ({
  id: -1001234567890, name: "Fitness Atacado", username: "fitness_atacado",
  url: "https://t.me/fitness_atacado", members: 100, sponsored: false, kind: "channel", ...extra,
});
const saved = () => saveProspectRecord([], group(), "fitness atacado", at(first), at(first));
function freeze(value) {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

test("first discovery uses the search time, saving uses the save time, baseline is not audience acquired", () => {
  const saveAt = at("2026-02-01T10:00:00Z");
  const [record] = saveProspectRecord([], group(), "fitness atacado", at(first), saveAt);
  assert.equal(record.discoveredAt, first);
  assert.equal(record.savedAt, new Date(saveAt).toISOString());
  assert.equal(record.lastCheckedAt, first);
  assert.equal(record.nextCheckAt, "2026-02-28T13:14:15.123Z");
  assert.deepEqual(record.history, [{ at: first, members: 100, delta: null }]);
  assert.equal("acquired" in record, false);
});

test("legacy records migrate without inventing a prior observation or growth", () => {
  const legacy = group({ savedAt: first, query: "fornecedor" });
  const result = normalizeProspect(freeze(legacy));
  assert.equal(result.savedAt, first);
  assert.equal(result.discoveredAt, first);
  assert.equal(result.lastCheckedAt, first);
  assert.equal(result.nextCheckAt, "2026-02-28T13:14:15.123Z");
  assert.deepEqual(result.history, [{ at: first, members: 100, delta: null }]);
});

test("calendar scheduling clamps month ends in Brasília, handles leap years and retains local time", () => {
  for (const [date, expected] of [
    ["2026-01-31T13:14:15.123Z", "2026-02-28T13:14:15.123Z"],
    ["2024-01-31T13:14:15.123Z", "2024-02-29T13:14:15.123Z"],
    ["2026-03-31T13:14:15.123Z", "2026-04-30T13:14:15.123Z"],
    ["2026-12-31T13:14:15.123Z", "2027-01-31T13:14:15.123Z"],
    ["2026-12-01T01:00:00.000Z", "2026-12-31T01:00:00.000Z"],
    ["2018-10-31T15:00:00.000Z", "2018-11-30T14:00:00.000Z"],
  ]) assert.equal(nextProspectCheck(date), expected);
});

test("legacy data without any trustworthy timestamp is omitted instead of using today as a fabricated discovery", () => {
  assert.equal(normalizeProspect(group(), at(first)), undefined);
  assert.equal(normalizeProspect(group({ savedAt: "invalid", history: [{ at: "invalid", members: 100 }] }), at(first)), undefined);
  assert.equal(normalizeProspect(group({ savedAt: "2026-02-31T12:00:00Z" }), at(first)), undefined);
  assert.equal(normalizeProspect(group({ discoveredAt: first }), at(first)).savedAt, first);
  assert.equal(normalizeProspect(group({ history: [{ at: first, members: 100 }] }), at(first)).discoveredAt, first);
});

test("a delayed result cannot overwrite a newer successful observation or a later failed attempt", () => {
  const later = recordProspectCheck(saved(), group().id, group({ members: 140 }), undefined, at("2026-03-02T12:00:00Z"));
  assert.deepEqual(recordProspectCheck(later, group().id, group({ members: 120 }), undefined, at("2026-03-01T12:00:00Z")), later);
  const failed = recordProspectCheck(later, group().id, undefined, "indisponível", at("2026-03-04T12:00:00Z"));
  assert.deepEqual(recordProspectCheck(failed, group().id, group({ members: 150 }), undefined, at("2026-03-03T12:00:00Z")), failed);
});

test("re-saving the same ID is idempotent, preserves dates and query, and never masquerades as a live check", () => {
  const original = freeze(saved());
  const result = saveProspectRecord(original, group({ members: 500, username: "renamed_fitness" }), "outra pesquisa", at("2026-02-02T12:00Z"), at("2026-02-02T13:00Z"));
  assert.deepEqual(result, original);
  assert.notEqual(result, original);
  assert.notEqual(result[0], original[0]);
  assert.notEqual(result[0].history, original[0].history);
});

test("duplicate IDs merge their observation history and preserve first save and discovery", () => {
  const earlier = saved()[0];
  const newer = recordProspectCheck([earlier], earlier.id, group({ members: 125 }), undefined, at("2026-02-28T13:14:15.123Z"))[0];
  const duplicates = [newer, { ...earlier, savedAt: "2026-02-01T12:00:00.000Z" }];
  const result = saveProspectRecord(freeze(duplicates), group(), "again", at(first), at("2026-03-01T00:00:00Z"));
  assert.equal(result.length, 1);
  assert.equal(result[0].savedAt, first);
  assert.equal(result[0].discoveredAt, first);
  assert.equal(result[0].members, 125);
  assert.deepEqual(result[0].history.map((h) => h.delta), [null, 25]);
});

test("conflicting duplicate counts at the same instant are unknown, never zero-time growth", () => {
  const same = "2026-03-01T00:00:00.000Z";
  const a = group({ savedAt: first, lastCheckedAt: same, members: 100 });
  const b = group({ savedAt: first, lastCheckedAt: same, members: 160 });
  const [merged] = saveProspectRecord([a, b], group(), "fitness", at(first), at(same));
  assert.deepEqual(merged.history, [{ at: same, members: null, delta: null }]);
  assert.equal(merged.members, null);
  const original = saved();
  assert.deepEqual(recordProspectCheck(original, group().id, group({ members: 160 }), undefined, at(first)), original);
});

test("new discoveries cannot receive a fabricated timestamp by clamping future input", () => {
  const future = "2030-01-01T00:00:00.000Z";
  const now = at("2026-03-01T00:00:00Z");
  assert.throws(() => saveProspectRecord([], group(), "fitness", at(future), now));
});

test("a blank error still has a useful failure reason when no live observation exists", () => {
  const [result] = recordProspectCheck(saved(), group().id, undefined, " \n\t ", at("2026-03-01T00:00:00Z"));
  assert.match(result.lastError, /Não foi possível consultar/);
  assert.equal(result.lastCheckedAt, first);
});

test("live checks record positive, negative, zero and unknown deltas using only numeric counts", () => {
  let list = saved();
  const values = [125, 110, 110, null, 130, 140];
  for (let i = 0; i < values.length; i++)
    list = recordProspectCheck(list, group().id, group({ members: values[i] }), undefined, at(`2026-0${i + 2}-15T12:00:00Z`));
  assert.deepEqual(list[0].history.map((h) => h.delta), [null, 25, -15, 0, null, null, 10]);
  assert.equal(list[0].lastCheckedAt, "2026-07-15T12:00:00.000Z");
  assert.equal(list[0].nextCheckAt, "2026-08-15T12:00:00.000Z");
  assert.equal(list[0].savedAt, first);
  assert.equal(list[0].discoveredAt, first);
});

test("invalid numeric counts never become zero or coerce strings to a known size", () => {
  for (const members of [null, undefined, "120", -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const record = normalizeProspect(group({ savedAt: first, members }));
    assert.equal(record.members, null);
    assert.equal(record.history[0].members, null);
    assert.equal(record.history[0].delta, null);
  }
  assert.equal(normalizeProspect(group({ savedAt: first, members: 0 })).members, 0);
});

test("errors retain the latest success, its history and the pending monthly due date", () => {
  const original = freeze(saved());
  const retryAt = at("2026-03-02T12:00:00Z");
  const failed = recordProspectCheck(original, group().id, undefined, "Telegram indisponível", retryAt);
  assert.deepEqual(failed[0].history, original[0].history);
  assert.equal(failed[0].lastCheckedAt, original[0].lastCheckedAt);
  assert.equal(failed[0].nextCheckAt, original[0].nextCheckAt);
  assert.equal(failed[0].members, 100);
  assert.equal(failed[0].lastAttemptAt, "2026-03-02T12:00:00.000Z");
  assert.equal(failed[0].lastError, "Telegram indisponível");
  const success = recordProspectCheck(failed, group().id, group({ members: 120 }), undefined, retryAt + 1);
  assert.equal(success[0].lastError, undefined);
  assert.equal(success[0].history.at(-1).delta, 20);
  assert.equal(success[0].nextCheckAt, "2026-04-02T12:00:00.001Z");
});

test("a reused username cannot overwrite a saved identity or create a second identity implicitly", () => {
  const original = freeze(saved()), replacement = group({ id: -1009876543210, members: 9000 });
  const failed = recordProspectCheck(original, group().id, replacement, undefined, at("2026-03-02T12:00:00Z"));
  assert.equal(failed[0].id, group().id);
  assert.equal(failed[0].members, 100);
  assert.deepEqual(failed[0].history, original[0].history);
  assert.match(failed[0].lastError, /outro ID/);
  assert.throws(() => saveProspectRecord(original, replacement, "fitness", at(first), at(first)), (error) => error.code === "group_identity");
});

test("a confirmed ID can change its username without changing original dates or another saved record", () => {
  const original = saveProspectRecord(saved(), group({ id: -1002222222222, username: "outro_canal" }), "praia", at(first), at(first));
  freeze(original);
  const updated = recordProspectCheck(original, group().id, group({ name: "Nome novo", username: "novo_canal", url: "https://untrusted.test", members: 120 }), undefined, at("2026-03-01T00:00:00Z"));
  assert.deepEqual(updated[0], original[0]);
  assert.equal(updated[1].url, "https://t.me/novo_canal");
  assert.equal(updated[1].savedAt, first);
  assert.equal(updated[1].history.at(-1).delta, 20);
  updated[0].history.push({ at: "2099-01-01", members: 1, delta: null });
  assert.equal(original[0].history.length, 1, "records never share mutable history with their input");
});

test("normalization repairs legacy ordering/deltas, rejects invalid identities and preserves history length", () => {
  const history = Array.from({ length: 130 }, (_, i) => ({ at: new Date(at(first) + i * 86400000).toISOString(), members: 100 + i, delta: 999999 }));
  const result = normalizeProspect(group({ savedAt: first, history: [...history].reverse() }));
  assert.equal(result.history.length, 130);
  assert.equal(result.history[0].delta, null);
  assert.equal(result.history.at(-1).delta, 1);
  assert.equal(result.lastCheckedAt, history.at(-1).at);
  for (const invalid of [null, {}, group({ id: 2 }), group({ username: "+private" }), group({ name: "" })])
    assert.equal(normalizeProspect(invalid), undefined);
});

function inspector(options = {}) {
  const entity = new Api.Channel({
    id: bigInt(options.id ?? 1234567890), accessHash: bigInt(555),
    title: "Fornecedor Fitness", username: "fitness_atacado", date: 0,
    photo: new Api.ChatPhotoEmpty(), broadcast: true, left: true,
    participantsCount: 999, ...options.entity,
  });
  const expectedId = Number(utils.getPeerId(entity));
  const calls = [];
  const instance = Object.create(TelegramDriver.prototype);
  instance.client = { invoke: async (request) => {
    calls.push(request.className);
    if (request instanceof Api.contacts.ResolveUsername) {
      assert.equal(request.username, "fitness_atacado");
      return { peer: options.peer || new Api.PeerChannel({ channelId: entity.id }), chats: [entity] };
    }
    if (request instanceof Api.channels.GetFullChannel) {
      assert.equal(request.channel, entity);
      return {
        fullChat: new Api.ChannelFull({ id: options.fullId || entity.id, about: "", participantsCount: options.members }),
        chats: options.chats || (options.fresh ? [options.fresh] : [entity]), users: [],
      };
    }
    assert.fail("inspection must not join, message, search globally or enumerate participants");
  } };
  return { instance, calls, expectedId, entity };
}

test("inspection resolves the saved ID then reads the full count without joining or collecting participants", async () => {
  const { instance, calls, expectedId } = inspector({ members: 2514 });
  const result = await instance.inspectPublicGroup("@fitness_atacado", expectedId);
  assert.equal(result.id, expectedId);
  assert.equal(result.kind, "channel");
  assert.equal(result.members, 2514, "full count takes priority over the search entity's cached count");
  assert.deepEqual(calls, ["contacts.ResolveUsername", "channels.GetFullChannel"]);
});

test("inspection keeps an unavailable full count unknown and supports public supergroups", async () => {
  const { instance, expectedId } = inspector({ entity: { megagroup: true, broadcast: false } });
  const result = await instance.inspectPublicGroup("fitness_atacado", expectedId);
  assert.equal(result.members, null, "do not reuse a cached count when the full count is absent");
  assert.equal(result.kind, "group");
});

test("inspection rejects username identity reuse before GetFullChannel and rejects users/private or flagged chats", async () => {
  const { instance, calls, expectedId } = inspector({ members: 2514 });
  await assert.rejects(instance.inspectPublicGroup("fitness_atacado", expectedId - 1), (error) => error.code === "group_identity");
  assert.deepEqual(calls, ["contacts.ResolveUsername"]);
  for (const options of [
    { peer: new Api.PeerUser({ userId: bigInt(7) }) },
    { entity: { username: undefined } },
    { entity: { scam: true } },
    { entity: { fake: true } },
    { fullId: bigInt(444) },
    { chats: [] },
    { chats: [new Api.ChannelForbidden({ id: bigInt(1234567890), accessHash: bigInt(555), title: "Privado", broadcast: true })] },
  ]) {
    const harness = inspector(options);
    await assert.rejects(harness.instance.inspectPublicGroup("fitness_atacado", harness.expectedId), (error) => error.code === "group_identity");
  }
});
