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
const accounts = loader({ "./domain": domain })("src/lib/telegram/accounts.ts");
const codec = {
  seal: (value) => `test-codec:${JSON.stringify(value)}`,
  secret: (value) => value ? JSON.parse(value.slice("test-codec:".length)) : undefined,
};
const realStore = loader({
  "./domain": domain,
  "@/lib/prisma": { prisma: {} },
  "@/lib/crypto": { encrypt: (value) => `test-codec:${value}`, decrypt: (value) => value.slice("test-codec:".length) },
})("src/lib/telegram/store.ts");
function harness({ registry = true, queued = true, people = [7] } = {}) {
  const account = { id: 101, name: "Account A", username: "account_a" };
  const parsed = domain.initialData({
    account,
    sources: [{ id: -1, name: "Origin", kind: "group" }],
    targets: [{ id: -2, name: "Destination", kind: "channel" }],
    contacts: people.map((id) => ({ user_id: id, name: `Person ${id}`, username: `person${id}`, accessHash: `hash-A-${id}`, accountId: 101, source_id: -1, selected: true })),
    ...(registry ? { accounts: { activeId: "slot-a", generation: 4, profiles: [{ id: "slot-a", label: "A", account }] } } : {}),
  });
  let row = {
    userId: "owner", parsed, authState: "connected", authAttempt: "attempt-A", authExpiresAt: null,
    credentialsEnc: codec.seal({ apiId: 1, apiHash: "test-only-key" }), sessionEnc: codec.seal("session-A"), loginEnc: null,
    busyToken: null, busyUntil: null,
  };
  const job = queued ? domain.enqueue(row.parsed, -1, -2, people) : null;
  const counters = { constructed: 0, connected: 0, invites: 0, logOut: [], closed: 0, signIns: 0 };
  const settings = { allowed: true, remoteId: 101, authorizedId: 303, authorizedKey: "session-new", skipGuard: false };
  const hooks = {
    mutation: async () => {}, connect: async () => {}, preflight: async () => {}, signIn: async () => {},
    invite: async () => ({ state: "added", message: "Membership confirmed by SDK boundary" }),
  };
  let mutationCount = 0, leaseCount = 0;
  const store = {
    ...codec,
    load: async () => structuredClone(row),
    mutate: async (_userId, change) => {
      await hooks.mutation(++mutationCount, row);
      const draft = structuredClone(row), result = await change(draft);
      row = draft;
      return result;
    },
    lease: async (_userId, milliseconds = 90000) => {
      if (!settings.allowed) throw new domain.TelegramError("permission", "Revoked", 0, 403);
      realStore.notBusy(row);
      row.busyToken = `lease-${++leaseCount}`;
      row.busyUntil = new Date(Date.now() + milliseconds);
      return { token: row.busyToken, row: structuredClone(row) };
    },
    release: async (_userId, token) => { if (row.busyToken === token) { row.busyToken = null; row.busyUntil = null; } },
    finishConnection: realStore.finishConnection,
    isAdministrator: async () => settings.allowed,
  };
  class Driver {
    constructor(_credentials, saved) {
      counters.constructed++;
      this.saved = saved || "draft-key";
      this.client = {
        checkAuthorization: async () => false,
        logOut: async () => { counters.logOut.push(this.saved); },
        signInUserWithQrCode: async (_key, params) => {
          counters.signIns++;
          await params.qrCode({ token: Buffer.from("test-only-qr"), expires: Date.now() / 1000 + 30 });
          await hooks.signIn(params, this);
          this.saved = settings.authorizedKey;
        },
      };
    }
    async connect() { counters.connected++; await hooks.connect(this); }
    async close() { counters.closed++; }
    save() { return this.saved; }
    async me() { return { id: row.authState === "qr" ? settings.authorizedId : settings.remoteId, name: "SDK account", username: "sdk_account" }; }
    async invite(_source, _target, _person, beforeInvite) {
      await hooks.preflight(this);
      if (!settings.skipGuard) await beforeInvite();
      if (!settings.skipGuard) counters.invites++;
      return hooks.invite(this);
    }
  }
  const steps = loader({
    "./domain": domain, "./accounts": accounts, "./store": store,
    "./driver": { TelegramDriver: Driver, deadline: async (promise) => promise, mapError: (error) => error },
    "qrcode": { toDataURL: async () => "data:image/png;base64,test-only-image" },
  })("src/lib/telegram/steps.ts");
  return {
    row: () => row, job, steps, counters, settings, hooks,
    qr() {
      const draft = accounts.addDraft(row, "Second account", codec);
      row.authState = "qr";
      row.authAttempt = "qr-attempt";
      row.authExpiresAt = new Date(Date.now() + 60000);
      return draft;
    },
  };
}

test("a correctly pinned queue verifies its SDK account and dispatches once", async () => {
  const h = harness();
  assert.equal(await h.steps.queueStep("owner", h.job.id), false);
  assert.equal(h.counters.invites, 1);
  assert.equal(h.row().parsed.results[0].state, "added");
  assert.equal(h.row().parsed.jobs[0].accountId, 101);
  assert.equal(h.row().parsed.jobs[0].accountProfileId, "slot-a");
  assert.equal(h.row().parsed.jobs[0].accountGeneration, 4);
});

for (const field of ["accountId", "accountProfileId", "accountGeneration"]) {
  test(`a mismatched pinned ${field} refuses the queue before constructing the SDK`, async () => {
    const h = harness();
    h.job[field] = field === "accountProfileId" ? "slot-other" : field === "accountId" ? 202 : 5;
    assert.equal(await h.steps.queueStep("owner", h.job.id), false);
    assert.equal(h.counters.constructed, 0);
    assert.equal(h.counters.invites, 0);
    assert.equal(h.row().parsed.jobs[0].state, "interrupted");
    assert.equal(h.row().parsed.results[0].state, "waiting");
  });
}

test("a legacy job with unknown account identity never inherits the selected account", async () => {
  const h = harness({ registry: false });
  delete h.job.accountId;
  delete h.job.accountProfileId;
  delete h.job.accountGeneration;
  await h.steps.queueStep("owner", h.job.id);
  assert.equal(h.counters.constructed, 0);
  assert.equal(h.row().parsed.jobs[0].state, "interrupted");
});

test("a known legacy account may run only in virtual primary, never after registry migration", async () => {
  const safe = harness({ registry: false });
  delete safe.job.accountProfileId;
  delete safe.job.accountGeneration;
  delete safe.row().parsed.contacts[0].accountId;
  await safe.steps.queueStep("owner", safe.job.id);
  assert.equal(safe.counters.invites, 1);
  const migrated = harness({ registry: false });
  delete migrated.job.accountProfileId;
  delete migrated.job.accountGeneration;
  migrated.row().parsed.accounts = { activeId: "primary", generation: 0, profiles: [{ id: "primary", label: "Primary", account: migrated.row().parsed.account }] };
  await migrated.steps.queueStep("owner", migrated.job.id);
  assert.equal(migrated.counters.constructed, 0);
  assert.equal(migrated.row().parsed.jobs[0].state, "interrupted");
});

for (const accountId of [202, undefined]) {
  test(`a ${accountId === undefined ? "missing" : "foreign"} contact account is refused before connection`, async () => {
    const h = harness();
    h.row().parsed.contacts[0].accountId = accountId;
    await h.steps.queueStep("owner", h.job.id);
    assert.equal(h.counters.constructed, 0);
    assert.equal(h.row().parsed.jobs[0].state, "interrupted");
  });
}

for (const field of ["session", "generation", "profile", "attempt"]) {
  test(`a changed ${field} before connection cannot use the leased credentials`, async () => {
    const h = harness();
    h.hooks.mutation = async (count, row) => {
      if (count !== 2) return;
      if (field === "session") row.sessionEnc = codec.seal("replacement-session");
      if (field === "generation") row.parsed.accounts.generation++;
      if (field === "profile") row.parsed.accounts.activeId = "slot-other";
      if (field === "attempt") row.authAttempt = "replacement-attempt";
    };
    await h.steps.queueStep("owner", h.job.id);
    assert.equal(h.counters.constructed, 0);
    assert.equal(h.counters.invites, 0);
    assert.equal(h.row().parsed.jobs[0].state, "interrupted");
  });
}

test("the actual authenticated SDK account must match the queue account", async () => {
  const h = harness();
  h.settings.remoteId = 202;
  await h.steps.queueStep("owner", h.job.id);
  assert.equal(h.counters.connected, 1);
  assert.equal(h.counters.invites, 0);
  assert.equal(h.row().parsed.jobs[0].state, "interrupted");
  assert.deepEqual(h.counters.logOut, [], "a mismatched session may belong to a retained account");
});

for (const phase of ["connect", "preflight"]) {
  test(`an account switch during SDK ${phase} blocks the mutating invitation`, async () => {
    const h = harness();
    h.hooks[phase] = async () => { h.row().parsed.accounts.generation++; };
    await h.steps.queueStep("owner", h.job.id);
    assert.equal(h.counters.invites, 0);
    assert.equal(h.row().parsed.jobs[0].state, "interrupted");
    assert.equal(h.row().parsed.results[0].state, "waiting");
  });
}

test("confirmed results retain their original provenance without touching the replacement account's selection", async () => {
  const h = harness({ people: [7, 8] });
  h.hooks.invite = async () => {
    h.row().parsed.account = { id: 202, name: "Account B", username: "b" };
    h.row().parsed.accounts.activeId = "slot-b";
    h.row().parsed.accounts.generation++;
    h.row().parsed.contacts = [{ ...h.row().parsed.contacts[0], accountId: 202, selected: true }];
    return { state: "added", message: "Confirmed for original account A" };
  };
  assert.equal(await h.steps.queueStep("owner", h.job.id), false);
  assert.equal(h.counters.invites, 1);
  assert.equal(h.row().parsed.results[0].state, "added");
  assert.equal(h.row().parsed.results[0].accountId, 101);
  assert.equal(h.row().parsed.jobs[0].accountId, 101);
  assert.equal(h.row().parsed.jobs[0].state, "interrupted");
  assert.equal(h.row().parsed.contacts[0].accountId, 202);
  assert.equal(h.row().parsed.contacts[0].selected, true);
});

test("a driver returning added without executing its dispatch fence is never accepted as confirmed", async () => {
  const h = harness();
  h.settings.skipGuard = true;
  await h.steps.queueStep("owner", h.job.id);
  assert.equal(h.counters.invites, 0);
  assert.equal(h.row().parsed.results[0].state, "uncertain");
  assert.equal(h.row().parsed.jobs[0].state, "failed");
});

test("QR completion adopts only its active draft and preserves the parked account", async () => {
  const h = harness({ registry: false, queued: false });
  const draft = h.qr();
  const parked = h.row().parsed.accounts.profiles.find((profile) => profile.id === "primary").contextEnc;
  await h.steps.qrStep("owner", "qr-attempt");
  assert.equal(h.row().authState, "connected");
  assert.equal(h.row().parsed.accounts.activeId, draft.id);
  assert.equal(h.row().parsed.account.id, 303);
  assert.equal(h.row().parsed.accounts.profiles.find((profile) => profile.id === "primary").contextEnc, parked);
  assert.deepEqual(h.counters.logOut, []);
});

for (const reusedKey of [false, true]) {
  test(`QR duplicate account rejection ${reusedKey ? "retains the parked key" : "revokes only the discarded new key"}`, async () => {
    const h = harness({ registry: false, queued: false });
    h.qr();
    const parked = h.row().parsed.accounts.profiles.find((profile) => profile.id === "primary").contextEnc;
    h.settings.authorizedId = 101;
    h.settings.authorizedKey = reusedKey ? "session-A" : "session-new";
    await h.steps.qrStep("owner", "qr-attempt");
    assert.equal(h.row().authState, "qr_error");
    assert.equal(h.row().parsed.account, undefined);
    assert.equal(h.row().parsed.accounts.profiles.find((profile) => profile.id === "primary").contextEnc, parked);
    assert.deepEqual(h.counters.logOut, reusedKey ? [] : ["session-new"]);
  });
}

for (const activeState of ["connected", "saved"]) {
  test(`QR cleanup retains an authorized session adopted as ${activeState} by another attempt`, async () => {
    const h = harness({ registry: false, queued: false });
    h.qr();
    h.hooks.signIn = async () => {
      h.row().authState = activeState;
      h.row().authAttempt = "new-attempt";
      h.row().sessionEnc = codec.seal("session-new");
      h.row().parsed.account = { id: 303, name: "Adopted", username: "adopted" };
      h.row().parsed.accounts.generation++;
    };
    await h.steps.qrStep("owner", "qr-attempt");
    assert.equal(h.row().authState, activeState);
    assert.equal(h.row().authAttempt, "new-attempt");
    assert.equal(codec.secret(h.row().sessionEnc), "session-new");
    assert.deepEqual(h.counters.logOut, []);
  });
}

test("a changed generation fences stale QR images and authentication completion", async () => {
  const h = harness({ registry: false, queued: false });
  h.qr();
  let blocked = false;
  h.hooks.signIn = async (params) => {
    h.row().parsed.accounts.generation++;
    const before = h.row().loginEnc;
    await assert.rejects(params.qrCode({ token: Buffer.from("stale-token"), expires: Date.now() / 1000 + 60 }), (error) => error.code === "cancelled");
    blocked = true;
    assert.equal(h.row().loginEnc, before);
  };
  await h.steps.qrStep("owner", "qr-attempt");
  assert.equal(blocked, true);
  assert.notEqual(h.row().authState, "connected");
  assert.equal(h.row().parsed.account, undefined);
  assert.deepEqual(h.counters.logOut, ["session-new"]);
});

test("same-attempt two-factor authentication retains only its own draft session", async () => {
  const h = harness({ registry: false, queued: false });
  h.qr();
  h.hooks.signIn = async (params) => params.password();
  await h.steps.qrStep("owner", "qr-attempt");
  assert.equal(h.row().authState, "password");
  assert.equal(codec.secret(h.row().sessionEnc), "draft-key");
  assert.deepEqual(h.counters.logOut, []);
});
