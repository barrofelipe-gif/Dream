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
    function require(name) {
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
    }
    new Function("require", "module", "exports", code)(require, compiled, compiled.exports);
    return compiled.exports;
  };
}

const { initialData, enqueue } = loader()("src/lib/telegram/domain.ts");
const { summarize } = loader()("src/lib/telegram/growth-domain.ts");
// Only infrastructure boundaries are replaced; no database, account or token is read.
const { finishConnection } = loader({
  "@prisma/client": { Prisma: {} },
  "@/lib/prisma": { prisma: {} },
  "@/lib/crypto": { encrypt: () => "encrypted-test-session" },
})("src/lib/telegram/store.ts");
const NOW = new Date("2026-11-02T15:00:00.000Z");
const source = { id: -1, name: "Origem A", private: false, owner: false, can_invite: false, supergroup: true };
const target = { ...source, id: -2, name: "Comunidade BFF", private: true, can_invite: true };
const account = (id) => ({ id, name: `Conta ${id}`, username: "" });
function data() {
  return initialData({
    sources: [{ ...source }], targets: [{ ...target }],
    groups: [{ ...source }, { ...target }],
    contacts: [{ user_id: 7, name: "Pessoa de teste", username: "pessoa_teste", accessHash: "test-only-hash", source_id: source.id, selected: true }],
    authorizedIds: [7], privacy: { group_id: target.id, private: true },
    discovery: { groups: [], query: "fitness", at: NOW.getTime() },
    prospects: [{ id: -3, name: "Público salvo", history: [{ at: NOW.toISOString(), members: 20, delta: null }] }],
    collectionRuns: [{ id: "collection-test", sourceId: source.id, targetId: target.id, collectedAt: NOW.toISOString(), received: 1, newContacts: 1, knownContacts: 0, totalKnown: 1 }],
  });
}
function completedAcquisition(d) {
  d.account ||= account(1);
  const job = enqueue(d, source.id, target.id, [7]);
  job.state = "completed";
  d.results[0].state = "added";
  d.results[0].updated_at = NOW.getTime() / 1000;
  return job;
}
function metric(d, origin = "") {
  return summarize([], [], [], d, 30, origin, NOW);
}

test("connecting without a previous identity clears actionable selection but retains collected and saved history", () => {
  const d = data();
  const original = structuredClone(d);
  const row = { parsed: d, authAttempt: "new-attempt" };
  finishConnection(row, "new-attempt", account(2), "test-session");
  assert.deepEqual(d.contacts, original.contacts.map((contact) => ({ ...contact, selected: false })));
  for (const key of ["sources", "targets", "groups", "authorizedIds"]) assert.deepEqual(d[key], []);
  assert.equal(d.privacy, undefined);
  assert.equal(d.discovery, undefined);
  for (const key of ["collectionRuns", "prospects", "jobs", "results"]) assert.deepEqual(d[key], original[key]);
  assert.deepEqual(d.account, account(2));
  assert.equal(row.authState, "connected");
});

test("a changed identity clears selection, while restoring the same identity preserves the configured selection", () => {
  for (const previous of [1, 2]) {
    const d = data();
    d.account = account(previous);
    const before = structuredClone(d);
    finishConnection({ parsed: d, authAttempt: "attempt" }, "attempt", account(2), "test-session");
    if (previous === 2) {
      for (const key of ["contacts", "sources", "targets", "groups", "privacy", "discovery", "account"])
        assert.deepEqual(d[key], before[key]);
    }
    else {
      assert.equal(d.contacts[0].selected, false);
      assert.deepEqual(d.sources, []);
      assert.equal(d.discovery, undefined);
      assert.deepEqual(d.collectionRuns, before.collectionRuns);
      assert.deepEqual(d.prospects, before.prospects);
    }
  }
});

test("a cancelled connection cannot clear selection or replace an account", () => {
  const d = data();
  d.account = account(1);
  const before = structuredClone(d);
  assert.throws(() => finishConnection({ parsed: d, authAttempt: "valid-attempt" }, "stale-attempt", account(2), "test-session"), (error) => error.code === "cancelled");
  assert.deepEqual(d, before);
});

test("a queued job keeps its acquisition origin and filter after reconfiguration, rename and reconnection", () => {
  const d = data();
  d.account = account(1);
  const job = completedAcquisition(d);
  assert.equal(job.source_name, "Origem A");
  assert.equal(metric(d, "Origem A").totals.audience, 1);
  d.sources = [{ ...source, id: -4, name: "Origem B" }];
  d.groups[0].name = "Origem A renomeada";
  assert.equal(metric(d, "Origem A").totals.audience, 1);
  assert.equal(metric(d, "Origem A renomeada").totals.audience, 0);
  // Models disconnect clearing identity before a different account is connected.
  delete d.account;
  finishConnection({ parsed: d, authAttempt: "next" }, "next", account(2), "test-session");
  assert.equal(metric(d, "Origem A").totals.audience, 1);
  assert.deepEqual(metric(d).sources, ["Origem A"]);
  assert.equal(d.jobs[0].source_name, "Origem A");
});

test("legacy jobs resolve only known origin names and otherwise retain an honest ID fallback", () => {
  for (const knownVia of ["sources", "groups", "prospects", "none"]) {
    const d = data();
    const job = completedAcquisition(d);
    delete job.source_name;
    d.sources = [];
    d.groups = [];
    d.prospects = [];
    if (knownVia !== "none") d[knownVia] = [{ ...source }];
    const name = knownVia === "none" ? "Grupo -1" : "Origem A";
    assert.deepEqual(metric(d).sources, [name]);
    assert.equal(metric(d, name).totals.audience, 1);
    if (knownVia === "none") assert.equal(metric(d, "Origem A").totals.audience, 0);
    assert.equal(job.source_name, undefined);
  }
});
