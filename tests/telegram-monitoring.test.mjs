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
    const code = transformSync(readFileSync(file, "utf8"), {
      loader: "ts", format: "cjs", target: "node20",
    }).code;
    const require = (name) => {
      if (name in mocks) return mocks[name];
      if (name === "server-only") return {};
      if (name.startsWith(".") || name.startsWith("@/")) {
        let resolved = name.startsWith("@/")
          ? path.resolve("src", name.slice(2))
          : path.resolve(path.dirname(file), name);
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
const { recordCollection } = loader()("src/lib/telegram/collection-history.ts");
const BASE = Date.parse("2026-11-01T10:00:00.000Z");
const DAY = 86_400_000;
const PUBLIC_ID = -10012345;
const iso = (milliseconds) => new Date(milliseconds).toISOString();
const group = (members = 100) => ({
  id: PUBLIC_ID, name: "Fitness wholesale", username: "fitness_wholesale",
  url: "https://t.me/fitness_wholesale", members, sponsored: false, kind: "channel",
});

// Execute real service/domain/prospect helpers. Fake only persistence, SDK and workflow boundaries.
function harness(t) {
  const clock = { now: BASE };
  t.mock.method(Date, "now", () => clock.now);
  const rows = new Map(["A", "B"].map((userId) => [userId, {
    userId,
    parsed: domain.initialData(),
    authState: "connected", authAttempt: `attempt-${userId}`,
    credentialsEnc: `test-key-${userId}`, sessionEnc: `test-session-${userId}`,
    busyToken: null,
  }]));
  const calls = { constructed: [], inspected: [], connected: [], closed: [], leased: [], released: [], mutated: [] };
  let inspect = async () => group(140);
  class Driver {
    constructor(key) {
      this.userId = key.apiId === 1 ? "A" : "B";
      calls.constructed.push(this.userId);
    }
    async connect(required) { calls.connected.push({ userId: this.userId, required }); }
    async close() { calls.closed.push(this.userId); }
    save() { return `test-refreshed-session-${this.userId}`; }
    async inspectPublicGroup(username, id) {
      calls.inspected.push({ userId: this.userId, username, id });
      return inspect(username, id, this.userId);
    }
  }
  const store = {
    load: async (userId) => structuredClone(rows.get(userId)),
    mutate: async (userId, fn) => {
      calls.mutated.push(userId);
      const draft = structuredClone(rows.get(userId));
      const result = await fn(draft);
      rows.set(userId, draft);
      return result;
    },
    lease: async (userId) => {
      calls.leased.push(userId);
      const row = rows.get(userId);
      assert.equal(row.busyToken, null);
      const token = `test-lease-${userId}-${calls.leased.length}`;
      row.busyToken = token;
      return { token, row: structuredClone(row) };
    },
    release: async (userId, token) => {
      calls.released.push(userId);
      const row = rows.get(userId);
      if (row.busyToken === token) row.busyToken = null;
    },
    secret: (value) => value === "test-key-A" ? { apiId: 1, apiHash: "test-only-A" }
      : value === "test-key-B" ? { apiId: 2, apiHash: "test-only-B" } : value,
    seal: (value) => value,
    notBusy: () => {},
  };
  const service = loader({
    "teleproto": { Api: {} },
    "./access": { csrf: () => "test-csrf" },
    "./driver": {
      TelegramDriver: Driver,
      deadline: async (promise) => promise,
      mapError: (error) => error,
    },
    "./store": store,
    "workflow/api": { start: async () => { throw new Error("Unexpected workflow launch"); } },
    "@/workflows/telegram": {},
  })("src/lib/telegram/service.ts");
  return {
    service, clock, calls,
    row: (userId) => rows.get(userId),
    inspect: (fn) => { inspect = fn; },
    discover(userId, publicGroup = group()) {
      rows.get(userId).parsed.discovery = {
        groups: [publicGroup], query: `fitness query ${userId}`, at: clock.now,
      };
    },
  };
}

test("refresh updates A's real history while preserving savedAt and B's same-ID prospect", async (t) => {
  const h = harness(t);
  h.discover("A", group(100));
  await h.service.saveProspect("A", { id: PUBLIC_ID });
  h.clock.now += 60_000;
  h.discover("B", group(900));
  await h.service.saveProspect("B", { id: PUBLIC_ID });
  const beforeA = structuredClone(h.row("A").parsed.prospects[0]);
  const beforeB = structuredClone(h.row("B"));
  h.row("A").parsed.prospects[0].lastError = "Old temporary error";
  h.clock.now = BASE + DAY;
  h.inspect(async (username, id, userId) => {
    assert.deepEqual([username, id, userId], ["fitness_wholesale", PUBLIC_ID, "A"]);
    return { ...group(140), name: "Updated public name" };
  });
  assert.deepEqual(await h.service.refreshProspect("A", { id: PUBLIC_ID }), { checked: 1, failed: 0 });
  const saved = h.row("A").parsed.prospects[0];
  assert.equal(saved.savedAt, beforeA.savedAt);
  assert.equal(saved.discoveredAt, beforeA.discoveredAt);
  assert.equal(saved.name, "Updated public name");
  assert.equal(saved.members, 140);
  assert.deepEqual(saved.history, [
    { at: iso(BASE), members: 100, delta: null },
    { at: iso(BASE + DAY), members: 140, delta: 40 },
  ]);
  assert.equal(saved.lastCheckedAt, iso(BASE + DAY));
  assert.equal(saved.nextCheckAt, "2026-12-02T10:00:00.000Z");
  assert.equal(saved.lastError, undefined);
  assert.deepEqual(h.row("B"), beforeB);
  assert.deepEqual(h.calls.constructed, ["A"]);
  assert.deepEqual(h.calls.closed, ["A"]);
  assert.deepEqual(h.calls.released, ["A"]);

  // Saving a newer discovery of an existing ID must not reset its monitoring history.
  h.clock.now += 60_000;
  h.discover("A", group(1));
  const successful = structuredClone(saved);
  await h.service.saveProspect("A", { id: PUBLIC_ID });
  assert.deepEqual(h.row("A").parsed.prospects[0], successful);
});

test("a prospect saved only by B is refused for A before leasing or constructing a client", async (t) => {
  const h = harness(t);
  h.discover("B");
  await h.service.saveProspect("B", { id: PUBLIC_ID });
  await assert.rejects(h.service.refreshProspect("A", { id: PUBLIC_ID }), (error) => error.code === "input" && error.status === 404);
  assert.deepEqual(h.calls.leased, []);
  assert.deepEqual(h.calls.constructed, []);
  assert.deepEqual(h.calls.connected, []);
  assert.deepEqual(h.calls.inspected, []);
  assert.equal(h.row("B").parsed.prospects.length, 1);
});

test("saveProspect requires the current user's own fresh discovery and does not open Telegram", async (t) => {
  const h = harness(t);
  h.discover("B");
  await assert.rejects(h.service.saveProspect("A", { id: PUBLIC_ID }), (error) => error.code === "input");
  assert.equal(h.row("A").parsed.prospects, undefined);
  h.discover("A");
  h.clock.now += DAY + 1;
  await assert.rejects(h.service.saveProspect("A", { id: PUBLIC_ID }), (error) => error.code === "input");
  assert.equal(h.row("A").parsed.prospects, undefined);
  h.discover("A");
  assert.deepEqual(await h.service.saveProspect("A", { id: PUBLIC_ID }), { ok: true });
  assert.equal(h.row("A").parsed.prospects[0].query, "fitness query A");
  assert.deepEqual(h.calls.constructed, []);
});

test("failed inspections retain the last successful count, history and schedule, then recover cleanly", async (t) => {
  const h = harness(t);
  h.discover("A");
  await h.service.saveProspect("A", { id: PUBLIC_ID });
  const success = structuredClone(h.row("A").parsed.prospects[0]);
  h.clock.now += DAY;
  h.inspect(async () => { throw new domain.TelegramError("group", "Canal temporariamente indisponível.", 0, 502); });
  assert.deepEqual(await h.service.refreshProspect("A", { id: PUBLIC_ID }), { checked: 0, failed: 1 });
  const failed = h.row("A").parsed.prospects[0];
  assert.equal(failed.lastError, "Canal temporariamente indisponível.");
  assert.equal(failed.lastAttemptAt, iso(BASE + DAY));
  for (const key of ["members", "history", "savedAt", "discoveredAt", "lastCheckedAt", "nextCheckAt"])
    assert.deepEqual(failed[key], success[key], key);
  h.clock.now += DAY;
  h.inspect(async () => group(120));
  await h.service.refreshProspect("A", { id: PUBLIC_ID });
  const recovered = h.row("A").parsed.prospects[0];
  assert.equal(recovered.lastError, undefined);
  assert.deepEqual(recovered.history, [
    { at: iso(BASE), members: 100, delta: null },
    { at: iso(BASE + 2 * DAY), members: 120, delta: 20 },
  ]);
  assert.equal(recovered.nextCheckAt, "2026-12-03T10:00:00.000Z");
  assert.deepEqual(h.calls.closed, ["A", "A"]);
  assert.deepEqual(h.calls.released, ["A", "A"]);
});

test("removing a saved prospect during inspect does not resurrect it after the response", async (t) => {
  const h = harness(t);
  for (const userId of ["A", "B"]) {
    h.discover(userId);
    await h.service.saveProspect(userId, { id: PUBLIC_ID });
  }
  const beforeB = structuredClone(h.row("B"));
  h.clock.now += DAY;
  let inspected = false;
  h.inspect(async () => {
    inspected = true;
    await h.service.saveProspect("A", { id: PUBLIC_ID, remove: true });
    assert.deepEqual(h.row("A").parsed.prospects, []);
    return group(999);
  });
  await assert.rejects(h.service.refreshProspect("A", { id: PUBLIC_ID }), (error) => error.code === "input" && error.status === 404);
  assert.equal(inspected, true);
  assert.deepEqual(h.row("A").parsed.prospects, []);
  assert.deepEqual(h.row("B"), beforeB);
  assert.deepEqual(h.calls.closed, ["A"]);
  assert.deepEqual(h.calls.released, ["A"]);
  assert.equal(h.row("A").busyToken, null);
});

function csvRows(text) {
  assert.equal(text[0], "\uFEFF");
  return text.slice(1).split("\r\n").map((line) =>
    [...line.matchAll(/"((?:[^"]|"")*)"(?:;|$)/g)].map((match) => match[1].replaceAll('""', '"')));
}

test("contacts CSV exports the actual first/last collection and leaves unknown legacy dates blank", async (t) => {
  const h = harness(t);
  const d = h.row("A").parsed;
  const person = { user_id: 7, name: "Collected contact", username: "collected", accessHash: "never-export-this-hash" };
  recordCollection(d, -1, -2, [person], BASE, "csv-first");
  recordCollection(d, -1, -2, [person], BASE + DAY, "csv-second");
  d.contacts.push({ user_id: 8, name: "Undated legacy", username: "legacy", accessHash: "never-export-legacy-hash", source_id: -1, selected: false });
  const before = structuredClone(d);
  const exported = await h.service.csv("A", false);
  const [header, current, legacy] = csvRows(exported);
  assert.deepEqual(header, ["participante_id", "nome", "usuario", "origem", "selecionado", "primeira_coleta_em", "ultima_coleta_em"]);
  assert.equal(current[0], "7");
  assert.equal(current[5], iso(BASE));
  assert.equal(current[6], iso(BASE + DAY));
  assert.equal(legacy[0], "8");
  assert.equal(legacy[5], "");
  assert.equal(legacy[6], "");
  assert.equal(exported.includes("never-export"), false);
  assert.deepEqual(h.row("A").parsed, before);
  assert.deepEqual(h.calls.constructed, []);
});

test("result CSV includes atualizado_em from the recorded seconds and keeps undated legacy results blank", async (t) => {
  const h = harness(t);
  h.row("A").parsed.results = [
    { job_id: "operation-1", user_id: 7, name: "Actual result", state: "added", message: "Confirmed", updated_at: (BASE + DAY) / 1000 },
    { job_id: "legacy", user_id: 8, name: "Legacy result", state: "already", message: "Existing", updated_at: 0 },
    { job_id: "undated", user_id: 9, name: "Missing timestamp", state: "uncertain", message: "Unknown" },
  ];
  const before = structuredClone(h.row("A").parsed.results);
  const [header, current, legacy, undated] = csvRows(await h.service.csv("A", true));
  assert.deepEqual(header, ["operacao", "participante_id", "nome", "estado", "detalhes", "atualizado_em"]);
  assert.equal(current[5], iso(BASE + DAY));
  assert.equal(legacy[5], "");
  assert.equal(undated[5], "");
  assert.deepEqual(h.row("A").parsed.results, before);
  assert.deepEqual(h.calls.constructed, []);
});
