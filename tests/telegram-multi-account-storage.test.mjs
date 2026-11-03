import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const native = createRequire(import.meta.url);
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
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
    new Function("require", "module", "exports", code)(require, loaded, loaded.exports);
    return loaded.exports;
  }
  return load;
}
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
process.env.DATABASE_URL = "postgresql://fake:fake@localhost/fake?schema=isolated";
const load = loader({ "@/lib/prisma": { prisma: {} } });
const accounts = load("src/lib/telegram/accounts.ts");
const domain = load("src/lib/telegram/domain.ts");
const store = load("src/lib/telegram/store.ts");
const collection = load("src/lib/telegram/collection-history.ts");
const requestContext = load("src/lib/telegram/request-context.ts");
const codec = { seal: store.seal, secret: store.secret };
const a = { id: 11, name: "Conta A de teste", username: "account_a" };
const b = { id: 22, name: "Conta B de teste", username: "account_b" };
const source = { id: -1, name: "Origem", private: false, owner: false, can_invite: false, supergroup: true };
const target = { ...source, id: -2, name: "Canal BFF", private: true, can_invite: true, kind: "channel" };
const person = (user_id = 7, accessHash = "hash-a") => ({ user_id, name: "Contato", username: "contact", accessHash });
function fixture() {
  const parsed = domain.initialData({ account: a, sources: [source], targets: [target], groups: [source, target] });
  collection.recordCollection(parsed, -1, -2, [person()], Date.parse("2026-11-01T12:00:00Z"), "run-a");
  parsed.contacts[0].selected = true;
  return { userId: "operator", parsed, credentialsEnc: codec.seal({ apiId: 1, apiHash: "a".repeat(32) }),
    sessionEnc: codec.seal("session-a"), loginEnc: null, authState: "connected", authAttempt: null,
    authExpiresAt: null, busyToken: null, busyUntil: null };
}
function connectB(row) {
  const draft = accounts.addDraft(row, "Conta B", codec);
  row.authState = "qr";
  row.authAttempt = "attempt-b";
  store.finishConnection(row, "attempt-b", b, "session-b");
  return draft.id;
}

test("legacy primary is a virtual roster using its real Telegram name without inventing another account", () => {
  const row = fixture(), before = structuredClone(row);
  assert.deepEqual(accounts.publicAccountRoster(row), [{ id: "primary", label: a.name, account: a, state: "connected", active: true }]);
  assert.equal(accounts.activeProfileId(row.parsed), "primary");
  assert.equal(requestContext.accountContext(row.parsed), "primary:0");
  assert.deepEqual(row, before);
});

test("adding a draft encrypts the established context, inherits credentials and starts with no Telegram session or contacts", () => {
  const row = fixture(), priorCredentials = row.credentialsEnc;
  const draft = accounts.addDraft(row, "Conta B", codec);
  assert.notEqual(draft.id, "primary");
  assert.equal(row.credentialsEnc, priorCredentials);
  assert.equal(row.sessionEnc, null);
  assert.deepEqual(row.parsed.contacts, []);
  assert.equal(row.parsed.account, undefined);
  assert.equal(row.parsed.accounts.generation, 1);
  const rawRegistry = JSON.stringify(row.parsed.accounts);
  for (const sensitive of ["session-a", "hash-a", "accessHash", "credentialsEnc"]) assert.ok(!rawRegistry.includes(sensitive));
  assert.deepEqual(accounts.retainedSessionEncs(row, codec).map((value) => codec.secret(value)), ["session-a"]);
});

test("switching restores each account's session, contact hashes, selections and limits while keeping global history", () => {
  const row = fixture();
  row.parsed.limits.not_before = Date.now() / 1000 + 600;
  row.parsed.growth = { syncedAt: "2026-11-01T00:00:00Z" };
  row.parsed.prospects = [{ id: -77, name: "Monitored" }];
  row.parsed.jobs = [{ id: "done", state: "completed" }];
  row.parsed.results = [{ job_id: "done", user_id: 7, state: "added" }];
  const global = structuredClone({ jobs: row.parsed.jobs, results: row.parsed.results, prospects: row.parsed.prospects, growth: row.parsed.growth });
  const idB = connectB(row);
  collection.recordCollection(row.parsed, -1, -2, [person(7, "hash-b"), person(8, "hash-b8")], Date.parse("2026-11-02T12:00:00Z"), "run-b");
  accounts.activateAccount(row, "primary", codec);
  assert.equal(codec.secret(row.sessionEnc), "session-a");
  assert.equal(row.parsed.contacts[0].accessHash, "hash-a");
  assert.equal(row.parsed.contacts[0].accountId, a.id);
  assert.equal(row.parsed.contacts[0].selected, true);
  assert.ok(row.parsed.limits.not_before > Date.now() / 1000);
  assert.deepEqual({ jobs: row.parsed.jobs, results: row.parsed.results, prospects: row.parsed.prospects, growth: row.parsed.growth }, global);
  accounts.activateAccount(row, idB, codec);
  assert.equal(codec.secret(row.sessionEnc), "session-b");
  assert.equal(row.parsed.contacts[0].accessHash, "hash-b");
  assert.equal(row.parsed.contacts[0].accountId, b.id);
  assert.equal(row.parsed.limits.not_before, 0);
  const summary = collection.collectionSummary(row.parsed, -1);
  assert.equal(summary.totalContacts, 2, "same Telegram user collected by two accounts is counted once");
  assert.equal(summary.runs.length, 2);
  const metadata = JSON.stringify(row.parsed.collectionContacts);
  assert.ok(!/accessHash|hash-a|hash-b|Contato/.test(metadata));
});

test("queued, paused, restricted, pending authentication and live leases block changing accounts", () => {
  for (const state of ["queued", "running", "paused", "paused_restriction"]) {
    const row = fixture(); row.parsed.jobs = [{ id: "job", state }];
    assert.equal(accounts.accountsLocked(row), true);
    assert.throws(() => accounts.addDraft(row, "B", codec), (error) => error.code === "busy");
  }
  for (const authState of ["qr", "code", "password"]) {
    const row = fixture(); row.authState = authState;
    assert.throws(() => accounts.addDraft(row, "B", codec), (error) => error.code === "busy");
  }
  const row = fixture(); row.busyToken = "lease"; row.busyUntil = new Date(Date.now() + 60000);
  assert.equal(accounts.accountsLocked(row), true);
  row.busyUntil = new Date(0); row.parsed.channelSetup = { activeRequest: { requestId: "old", leaseToken: "lease" }, creations: [], tests: [], audit: [] };
  assert.equal(accounts.accountsLocked(row), false, "an orphaned old channel attempt cannot lock all accounts forever");
});

test("cancelled drafts can switch away; parked keys are retained and active pending keys are excluded", () => {
  const row = fixture(), draft = accounts.addDraft(row, "B", codec);
  row.authState = "password"; row.sessionEnc = codec.seal("pending-new-key");
  assert.deepEqual(accounts.retainedSessionEncs(row, codec).map((value) => codec.secret(value)), ["session-a"]);
  row.authState = "disconnected"; row.sessionEnc = null;
  accounts.activateAccount(row, "primary", codec);
  assert.equal(codec.secret(row.sessionEnc), "session-a");
  assert.ok(accounts.publicAccountRoster(row).some((profile) => profile.id === draft.id && profile.state === "disconnected"));
});

test("duplicate identity and corrupted encrypted contexts cannot overwrite a saved account", () => {
  const row = fixture(); accounts.addDraft(row, "duplicate", codec);
  row.authState = "qr"; row.authAttempt = "duplicate-attempt";
  const parked = row.parsed.accounts.profiles[0].contextEnc;
  assert.throws(() => store.finishConnection(row, "duplicate-attempt", a, "new-duplicate-key"), (error) => error.code === "account_exists");
  assert.equal(row.parsed.accounts.profiles[0].contextEnc, parked);
  row.authState = "disconnected";
  row.parsed.accounts.profiles[0].contextEnc = "tampered";
  const before = structuredClone(row);
  assert.throws(() => accounts.activateAccount(row, "primary", codec), (error) => error.code === "account_vault");
  assert.deepEqual(row, before);
});

test("re-authentication invalidates old hashes but keeps dates and history; restoring an existing key preserves them", () => {
  const row = fixture(), dates = row.parsed.contacts[0].firstCollectedAt;
  row.authState = "saved";
  store.finishConnection(row, null, a, "session-a");
  assert.equal(row.parsed.contacts[0].accessHash, "hash-a");
  row.authState = "code"; row.authAttempt = "again";
  store.finishConnection(row, "again", a, "new-key-a");
  assert.equal(row.parsed.contacts[0].accessHash, "");
  assert.equal(row.parsed.contacts[0].firstCollectedAt, dates);
  assert.equal(row.parsed.collectionRuns.length, 1);
  assert.equal(domain.publicSnapshot(row.parsed).contacts[0].can_use, false);
});

test("DTO omits vault and hashes, marks unusable legacy contacts, and new jobs are pinned to the active account context", () => {
  const row = fixture();
  accounts.addDraft(row, "B", codec);
  accounts.activateAccount(row, "primary", codec);
  row.parsed.contacts.push({ ...person(9), source_id: -1, selected: true });
  const snapshot = domain.publicSnapshot(row.parsed);
  assert.equal(snapshot.contacts.find((contact) => contact.user_id === 9).can_use, false);
  assert.equal(snapshot.contacts.find((contact) => contact.user_id === 9).selected, false);
  assert.ok(!/contextEnc|sessionEnc|credentialsEnc|accessHash/.test(JSON.stringify([snapshot, accounts.publicAccountRoster(row)])));
  const job = domain.enqueue(row.parsed, -1, -2, [7]);
  assert.equal(job.accountId, a.id);
  assert.equal(job.accountProfileId, "primary");
  assert.equal(job.accountGeneration, row.parsed.accounts.generation);
  assert.equal(row.parsed.results[0].accountId, a.id);
});

function databaseHarness() {
  const base = fixture();
  let committed = { ...base, data: base.parsed }; delete committed.parsed;
  let failCommit = false, commits = 0;
  const prisma = {
    $queryRaw: async () => [{ rls: true, anon: false, authenticated: false }],
    telegramWorkspace: { upsert: async () => structuredClone(committed) },
    $transaction: async (fn) => {
      let staged = structuredClone(committed);
      const value = await fn({ $queryRaw: async () => [], telegramWorkspace: {
        findUniqueOrThrow: async () => structuredClone(staged),
        update: async ({ data }) => { staged = { ...staged, ...data }; },
      } });
      if (failCommit) throw new Error("simulated rollback");
      committed = staged; commits++; return value;
    },
  };
  const loaded = loader({ "@/lib/prisma": { prisma } });
  return { store: loaded("src/lib/telegram/store.ts"), context: loaded("src/lib/telegram/request-context.ts"),
    fail: () => { failCommit = true; }, commits: () => commits, row: () => committed };
}

test("storage checks the expected account context inside the row lock before running an action", async () => {
  const h = databaseHarness(); let acted = false;
  await h.context.withRequestContext("other:1", async () => {
    await assert.rejects(h.store.mutate("operator", () => { acted = true; }), (error) => error.code === "account_changed");
  });
  assert.equal(acted, false); assert.equal(h.commits(), 0);
});

test("only a committed switch advances its own request; A to B to A rejects the old context", async () => {
  const h = databaseHarness();
  await h.context.withRequestContext("primary:0", async () => {
    await h.store.mutate("operator", (row) => accounts.addDraft(row, "B", { seal: h.store.seal, secret: h.store.secret }));
    h.context.assertRequestContext(h.row().data);
    await h.store.mutate("operator", (row) => accounts.activateAccount(row, "primary", { seal: h.store.seal, secret: h.store.secret }));
    h.context.assertRequestContext(h.row().data);
  });
  assert.equal(h.row().data.accounts.generation, 2);
  await h.context.withRequestContext("primary:0", async () => {
    await assert.rejects(h.store.mutate("operator", () => {}), (error) => error.code === "account_changed");
  });
});

test("a failed database commit cannot advance the request context or persist a half-switched session", async () => {
  const h = databaseHarness(); h.fail();
  await h.context.withRequestContext("primary:0", async () => {
    await assert.rejects(h.store.mutate("operator", (row) => accounts.addDraft(row, "B", { seal: h.store.seal, secret: h.store.secret })), /rollback/);
    h.context.assertRequestContext({});
  });
  assert.equal(h.row().data.accounts, undefined);
  assert.equal(h.store.secret(h.row().sessionEnc), "session-a");
  assert.equal(h.commits(), 0);
});
