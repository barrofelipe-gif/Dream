import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";

const compiled = { exports: {} };
const code = transformSync(readFileSync("src/lib/telegram/collection-history.ts", "utf8"), {
  loader: "ts", format: "cjs", target: "node20",
}).code;
new Function("require", "module", "exports", code)(createRequire(import.meta.url), compiled, compiled.exports);
const { recordCollection, collectionSummary } = compiled.exports;
const first = Date.parse("2026-11-01T10:00:00.000Z");
const second = first + 86_400_000;
const iso = (time) => new Date(time).toISOString();
const person = (id, name = `Person ${id}`) => ({ user_id: id, name, username: `person${id}`, accessHash: `private-hash-${id}` });
const data = () => ({ contacts: [], jobs: [], results: [], account: { id: 123, name: "Account", username: "account" } });

test("repeat collection updates real participant data, preserves selection and records new versus known", () => {
  const d = data();
  const a = recordCollection(d, -1, -2, [person(1), person(2)], first, "first");
  d.contacts[0].selected = true;
  const updated = { ...person(1, "Updated name"), username: "new_handle", accessHash: "new-real-hash" };
  const b = recordCollection(d, -1, -3, [updated, person(2), person(3)], second, "second");
  assert.deepEqual([a.received, a.newContacts, a.knownContacts, a.totalKnown], [2, 2, 0, 2]);
  assert.deepEqual([b.received, b.newContacts, b.knownContacts, b.totalKnown], [3, 1, 2, 3]);
  assert.equal(b.accountId, 123);
  assert.equal(d.contacts.length, 3);
  assert.deepEqual(d.contacts[0], {
    ...updated, source_id: -1, selected: true,
    firstCollectedAt: iso(first), lastCollectedAt: iso(second),
  });
  assert.equal(d.contacts[2].selected, false);
  assert.equal(d.contacts[2].firstCollectedAt, iso(second));
  assert.deepEqual(d.jobs, []);
  assert.deepEqual(d.results, []);
});

test("the same participant is distinct per source and re-querying either source does not duplicate it", () => {
  const d = data();
  recordCollection(d, -1, -2, [person(1)], first, "a");
  recordCollection(d, -3, -2, [person(1)], second, "b");
  const third = recordCollection(d, -1, -2, [person(1)], second, "c");
  assert.equal(d.contacts.length, 2);
  assert.equal(third.newContacts, 0);
  assert.equal(third.knownContacts, 1);
  assert.equal(collectionSummary(d, -1).totalContacts, 1);
  assert.equal(collectionSummary(d, -3).runs.length, 1);
});

test("undated legacy contacts retain an unknown first date and only receive a real last observation", () => {
  const d = data();
  d.contacts.push({ ...person(1), source_id: -1, selected: true });
  assert.deepEqual(collectionSummary(d, -1), {
    firstCollectedAt: null, lastCollectedAt: null, totalContacts: 1, runs: [],
  });
  const run = recordCollection(d, -1, -2, [person(1)], first, "legacy");
  assert.equal(d.contacts[0].firstCollectedAt, undefined);
  assert.equal(d.contacts[0].lastCollectedAt, iso(first));
  assert.equal(d.contacts[0].selected, true);
  assert.equal(run.newContacts, 0);
  assert.equal(run.knownContacts, 1);
  assert.equal(collectionSummary(d, -1).firstCollectedAt, iso(first));
});

test("summaries use recorded runs including zero-result calls and real contact dates only as a fallback", () => {
  const d = data();
  d.contacts.push({ ...person(1), source_id: -1, selected: false, firstCollectedAt: iso(first), lastCollectedAt: iso(second) });
  assert.equal(collectionSummary(d, -1).firstCollectedAt, iso(first));
  assert.equal(collectionSummary(d, -1).lastCollectedAt, iso(second));
  const empty = recordCollection(d, -1, -2, [], second, "empty");
  assert.deepEqual([empty.received, empty.newContacts, empty.knownContacts, empty.totalKnown], [0, 0, 0, 1]);
  assert.equal(collectionSummary(d, -1).firstCollectedAt, iso(second));
  const other = recordCollection(d, -3, -2, [], first, "other-empty");
  assert.equal(other.totalKnown, 0);
  assert.equal(collectionSummary(d, -3).runs.length, 1);
  assert.equal(collectionSummary(d, -3).firstCollectedAt, iso(first));
});

test("duplicate participants in a batch count once and the final real data is retained", () => {
  const d = data();
  const a = recordCollection(d, -1, -2, [person(1), person(1, "Latest"), person(2)], first, "duplicates");
  assert.deepEqual([a.received, a.newContacts, a.knownContacts, a.totalKnown], [2, 2, 0, 2]);
  assert.equal(d.contacts[0].name, "Latest");
  const b = recordCollection(d, -1, -2, [person(1), person(1)], second, "again");
  assert.deepEqual([b.received, b.newContacts, b.knownContacts, b.totalKnown], [1, 0, 1, 2]);
  assert.equal(d.contacts.length, 2);
});

test("old duplicate rows are consolidated per source without losing selection or inventing dates", () => {
  const d = data();
  const unrelated = { ...person(1), source_id: -3, selected: false };
  d.contacts.push(
    { ...person(1), source_id: -1, selected: false, firstCollectedAt: iso(first) },
    { ...person(1), source_id: -1, selected: true },
    unrelated,
  );
  const run = recordCollection(d, -1, -2, [person(1)], second, "dedupe");
  assert.equal(d.contacts.length, 2);
  assert.equal(d.contacts[0].selected, true);
  assert.equal(d.contacts[0].firstCollectedAt, undefined);
  assert.equal(d.contacts[1], unrelated);
  assert.equal(run.totalKnown, 1);
});

test("run snapshots are independent of later collections, caller edits and DTO edits", () => {
  const d = data();
  const a = recordCollection(d, -1, -2, [person(1)], first, "snapshot");
  const storedBefore = structuredClone(d.collectionRuns[0]);
  a.totalKnown = 999;
  recordCollection(d, -1, -2, [person(1), person(2)], second, "later");
  assert.deepEqual(d.collectionRuns[0], storedBefore);
  const summary = collectionSummary(d, -1);
  assert.deepEqual(summary.runs.map((run) => run.id), ["later", "snapshot"]);
  summary.runs[0].received = 999;
  assert.equal(d.collectionRuns[1].received, 2);
  assert.equal(summary.firstCollectedAt, iso(first));
  assert.equal(summary.lastCollectedAt, iso(second));
  assert.equal(d.collectionRuns[0].totalKnown, 1);
  assert.equal(d.collectionRuns[1].totalKnown, 2);
});

test("a repeated server run ID is idempotent and does not change contacts or history", () => {
  const d = data();
  const a = recordCollection(d, -1, -2, [person(1)], first, "retry-id");
  const before = structuredClone(d);
  const b = recordCollection(d, -1, -2, [person(1, "Ignored retry"), person(2)], second, "retry-id");
  assert.deepEqual(b, a);
  assert.deepEqual(d, before);
  b.totalKnown = 123;
  assert.equal(d.collectionRuns[0].totalKnown, 1);
});

test("public summaries project only metadata and never return participant or unknown run fields", () => {
  const d = data();
  recordCollection(d, -1, -2, [person(1, "PRIVATE PARTICIPANT")], first, "safe");
  d.collectionRuns[0].accessHash = "private-run-extra";
  d.collectionRuns[0].name = "PRIVATE RUN NAME";
  const summary = collectionSummary(d, -1);
  const text = JSON.stringify(summary);
  assert.equal(text.includes("private"), false);
  assert.equal(text.includes("PRIVATE"), false);
  assert.equal(text.includes("username"), false);
  assert.equal(text.includes("accessHash"), false);
  assert.equal("contacts" in summary, false);
  assert.deepEqual(collectionSummary(d, -99), { firstCollectedAt: null, lastCollectedAt: null, totalContacts: 0, runs: [] });
});
