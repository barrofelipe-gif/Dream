import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext, createContext, runInContext } from "node:vm";
import { transformSync } from "esbuild";

// Execute the actual TypeScript modules with explicit, isolated boundary fakes.
// No Telegram, database, Workflow or account credentials are contacted by tests.
const root = process.cwd();
const native = createRequire(import.meta.url);
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(root, file);
    if (cache.has(file)) return cache.get(file).exports;
    const loaded = { exports: {} };
    cache.set(file, loaded);
    const code = transformSync(readFileSync(file, "utf8"), {
      loader: "ts",
      format: "cjs",
      target: "node20",
    }).code;
    const localRequire = (name) => {
      if (name in mocks) return mocks[name];
      if (name === "server-only") return {};
      if (name.startsWith(".") || name.startsWith("@/")) {
        let resolved = name.startsWith("@/")
          ? path.join(root, "src", name.slice(2))
          : path.resolve(path.dirname(file), name);
        if (!existsSync(resolved)) resolved += ".ts";
        return load(resolved);
      }
      return native(name);
    };
    new Function("require", "module", "exports", code)(
      localRequire,
      loaded,
      loaded.exports,
    );
    return loaded.exports;
  }
  return load;
}
const domain = loader()("src/lib/telegram/domain.ts");
test("only the Telegram panel can be framed by the same app; global framing protection remains", async () => {
  const config = loader({
    "workflow/next": { withWorkflow: (config) => config },
  })("next.config.ts").default;
  const rules = await config.headers();
  const panel = rules.find((r) => r.source === "/api/telegram/painel");
  assert.ok(panel);
  assert.equal(
    panel.headers.find((h) => h.key === "X-Frame-Options").value,
    "SAMEORIGIN",
  );
  assert.match(
    panel.headers.find((h) => h.key === "Content-Security-Policy").value,
    /frame-ancestors 'self'/,
  );
  const global = rules[0].headers;
  assert.equal(global.find((h) => h.key === "X-Frame-Options").value, "DENY");
  assert.equal(
    global.find((h) => h.key === "Content-Security-Policy").value,
    "frame-ancestors 'none'",
  );
});
test("group search accepts topics, exact handles and public links", () => {
  assert.deepEqual(domain.groupSearch("  biquíni   atacado  "), {
    text: "biquíni atacado",
  });
  assert.equal(
    domain.groupSearch("@fitness_atacado").username,
    "fitness_atacado",
  );
  assert.equal(
    domain.groupSearch("https://t.me/fitness_atacado/").username,
    "fitness_atacado",
  );
  assert.equal(domain.groupSearch("t.me/moda_praia").username, "moda_praia");
});
test("group search rejects private invites, malformed links and excessive input", () => {
  for (const input of [
    null,
    123,
    "ab",
    "a".repeat(101),
    "https://t.me/+private",
    "https://t.me/joinchat/private",
    "https://evil.test/group",
    "https://t.me/name?next=evil",
    "@<script>",
    "abc\u0000def",
  ])
    assert.throws(() => domain.groupSearch(input));
});
test("slow cloud responses render and polling does not overlap requests", async () => {
  const elements = new Map(),
    timers = new Map();
  let now = 0,
    nextTimer = 0,
    calls = 0;
  const pending = [];
  const getElementById = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        dataset: {},
        open: false,
        addEventListener() {},
      });
    return elements.get(id);
  };
  const schedule = (fn, ms, repeat = false) => {
    const id = ++nextTimer;
    timers.set(id, { fn, due: now + ms, ms, repeat });
    return id;
  };
  const drain = async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  };
  const advance = async (time) => {
    while (true) {
      const entry = [...timers]
        .filter(([, t]) => t.due <= time)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry) break;
      const [id, t] = entry;
      timers.delete(id);
      now = t.due;
      if (t.repeat) timers.set(id, { ...t, due: now + t.ms });
      t.fn();
      await drain();
    }
    now = time;
  };
  runInNewContext(readFileSync("public/telegram-assets/app.js", "utf8"), {
    document: { hidden: false, getElementById },
    AbortController,
    URL,
    fetch: () => {
      calls++;
      return new Promise((resolve) => pending.push(resolve));
    },
    setTimeout: (fn, ms) => schedule(fn, ms),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (fn, ms) => schedule(fn, ms, true),
  });
  await advance(5000);
  assert.equal(
    calls,
    1,
    "one pending slow request must not be superseded by polling",
  );
  const d = domain.initialData();
  pending.shift()({
    ok: true,
    redirected: false,
    json: async () => ({
      ...domain.publicSnapshot(d),
      sources: [],
      targets: [],
      mode: "live",
      connection: { state: "disconnected", configured: false },
    }),
  });
  await drain();
  assert.equal(elements.get("mode").textContent, "CONECTE SUA CONTA");
  await advance(8000);
  assert.equal(calls, 2);
});
const group = (id) => ({
  id,
  name: String(id),
  private: true,
  owner: true,
  can_invite: true,
  supergroup: true,
});
function data() {
  const d = domain.initialData();
  d.sources = [group(-1)];
  d.targets = [group(-2), group(-3)];
  d.contacts = [7, 8].map((id) => ({
    user_id: id,
    name: "Pessoa " + id,
    username: "user" + id,
    accessHash: "PRIVATE-HASH",
    source_id: -1,
    selected: true,
  }));
  return d;
}
test("selected contacts can be queued without consent records or a manual allowlist", () => {
  const d = data();
  assert.deepEqual(d.authorizations, []);
  assert.deepEqual(d.authorizedIds, []);
  assert.equal(domain.enqueue(d, -1, -2, [7]).total, 1);
  const other = data();
  other.contacts[0].selected = false;
  assert.throws(() => domain.enqueue(other, -1, -2, [7]));
  assert.throws(() => domain.enqueue(data(), -99, -2, [7]));
});
test("confirmed participants cannot be queued again for same destination", () => {
  const d = data(),
    j = domain.enqueue(d, -1, -2, [7, 7]);
  assert.equal(j.total, 1);
  d.results[0].state = "added";
  j.state = "completed";
  assert.throws(() => domain.enqueue(d, -1, -2, [7]));
  assert.equal(domain.enqueue(d, -1, -3, [7]).total, 1);
});
test("active jobs and Telegram restrictions block new jobs", () => {
  for (const state of domain.activeStates) {
    const d = data();
    d.jobs.push({ state });
    assert.throws(() => domain.enqueue(d, -1, -2, [7]));
  }
  for (const limits of [
    { restricted: true, not_before: 0 },
    { restricted: false, not_before: Date.now() / 1000 + 60 },
  ]) {
    const d = data();
    d.limits = limits;
    assert.throws(() => domain.enqueue(d, -1, -2, [7]));
  }
});
test("invalid and unsafe IDs never pass validation", () => {
  for (const id of ["7", 0, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => domain.numeric(id, true));
  assert.throws(() => domain.pair(data(), -1, -1));
  assert.throws(() => domain.pair(data(), -99, -2));
});
test("public snapshot omits internal access hashes and worker leases", () => {
  const d = data(),
    j = domain.enqueue(d, -1, -2, [7]);
  j.lease = "PRIVATE-LEASE";
  j.lease_until = 123;
  const json = JSON.stringify(domain.publicSnapshot(d));
  assert.ok(!json.includes("PRIVATE-"));
  assert.ok(!json.includes("lease_until"));
});
test("result totals distinguish confirmed, uncertain and waiting", () => {
  const d = data(),
    j = domain.enqueue(d, -1, -2, [7, 8]);
  d.results[0].state = "uncertain";
  domain.recount(d, j);
  assert.equal(j.failed, 1);
  assert.equal(j.processed, 1);
  assert.equal(j.success, 0);
});
test("CSV neutralizes spreadsheet formulas and quotes embedded delimiters", () => {
  for (const text of ["=1+1", " +1", "@SUM(A1)", "-4", "\t=cmd"])
    assert.ok(domain.csvCell(text).startsWith("\"'"));
  assert.equal(domain.csvCell('a"b,c'), '"a""b,c"');
});
test("legacy authorization records never filter a new selection", () => {
  const d = data();
  d.authorizedIds = [8];
  d.authorizations = [
    { user_id: 8, target_id: -3, evidence: "Old record", authorized_at: 1 },
  ];
  assert.equal(domain.enqueue(d, -1, -2, [7, 8]).total, 2);
  assert.ok(!("authorizations" in domain.publicSnapshot(d)));
});

let session = { user: { id: "owner" } },
  role = "admin";
const access = loader({
  "@/auth": { auth: async () => session },
  "@/lib/prisma": {
    prisma: {
      user: { findUnique: async () => (role ? { id: "owner", role } : null) },
    },
  },
})("src/lib/telegram/access.ts");
process.env.AUTH_SECRET = "TEST-ONLY-SECRET";
process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
test("access requires both a session and a current admin database role", async () => {
  assert.equal(await access.operator(), "owner");
  role = "member";
  await assert.rejects(access.operator(), (e) => e.status === 403);
  role = "admin";
  session = null;
  await assert.rejects(access.operator(), (e) => e.status === 401);
  session = { user: { id: "owner" } };
});
function post(
  token = access.csrf("owner"),
  origin = "https://bff.test",
  body = "{}",
) {
  return new Request("https://bff.test/api/telegram/collect", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/json",
      "x-csrf-token": token,
    },
    body,
  });
}
test("CSRF is origin, user and time bound", () => {
  access.checkPost(post(), "owner");
  assert.throws(() =>
    access.checkPost(post(undefined, "https://evil.test"), "owner"),
  );
  assert.throws(() => access.checkPost(post(access.csrf("other")), "owner"));
  assert.throws(() => access.checkPost(post("😃".repeat(43)), "owner"));
  const today = Math.floor(Date.now() / 86400000);
  access.checkPost(post(access.csrf("owner", today - 1)), "owner");
  assert.throws(() =>
    access.checkPost(post(access.csrf("owner", today - 2)), "owner"),
  );
});
test("body reader rejects large, malformed and non-object bodies", async () => {
  for (const text of ["[]", "null", "invalid", '"text"', " ".repeat(65537)])
    await assert.rejects(access.body(post(undefined, undefined, text)));
  assert.deepEqual(
    await access.body(post(undefined, undefined, '{"value":1}')),
    { value: 1 },
  );
});
const store = loader({ "@/lib/prisma": { prisma: {} } })(
  "src/lib/telegram/store.ts",
);
test("session encryption authenticates ciphertext and does not reuse IVs", () => {
  const a = store.seal("SESSION-TEST"),
    b = store.seal("SESSION-TEST");
  assert.notEqual(a, b);
  assert.ok(!a.includes("SESSION"));
  assert.equal(store.secret(a), "SESSION-TEST");
  const parts = a.split(".");
  parts[1] = Buffer.alloc(16).toString("base64");
  assert.throws(() => store.secret(parts.join(".")));
});
test("changing Telegram accounts clears actionable configuration and selection", () => {
  const row = { parsed: data(), authAttempt: "attempt" };
  row.parsed.account = { id: 1 };
  store.finishConnection(
    row,
    "attempt",
    { id: 2, name: "Conta B", username: "" },
    "SESSION-TEST",
  );
  assert.equal(row.authState, "connected");
  assert.deepEqual(row.parsed.authorizedIds, []);
  assert.equal(row.parsed.contacts.length, 2);
  assert.ok(row.parsed.contacts.every((p) => !p.selected));
  assert.throws(() =>
    store.finishConnection(row, "cancelled", { id: 3 }, "SESSION-TEST"),
  );
});
test("storage protection checks the configured PostgreSQL schema and refuses public grants", async () => {
  process.env.DATABASE_URL =
    "postgresql://test:test@127.0.0.1/test?schema=painel_bff";
  let upserts = 0;
  for (const unsafe of [false, true]) {
    const guarded = loader({
      "@/lib/prisma": {
        prisma: {
          $queryRaw: async (_sql, schema) => {
            assert.equal(schema, "painel_bff");
            return [{ rls: true, anon: unsafe, authenticated: false }];
          },
          telegramWorkspace: {
            upsert: async (args) => {
              upserts++;
              assert.deepEqual(args.where, { userId: "owner" });
              return { data: {} };
            },
          },
        },
      },
    })("src/lib/telegram/store.ts");
    if (unsafe)
      await assert.rejects(guarded.load("owner"), (e) => e.code === "storage");
    else await guarded.load("owner");
  }
  assert.equal(upserts, 1);
});
const driver = loader()("src/lib/telegram/driver.ts");
test("SDK error translation preserves waits while omitting raw secrets", () => {
  assert.equal(
    driver.mapError({ errorMessage: "FLOOD_WAIT_120", seconds: 120 }).wait,
    120,
  );
  assert.equal(
    driver.mapError({ errorMessage: "SESSION_PASSWORD_NEEDED" }).code,
    "password_required",
  );
  assert.equal(
    driver.mapError({ errorMessage: "AUTH_KEY_UNREGISTERED" }).code,
    "auth_required",
  );
  assert.ok(
    !driver.mapError(new Error("SECRET-CODE")).message.includes("SECRET"),
  );
  assert.throws(() =>
    driver.credentials({ api_id: 0, api_hash: "a".repeat(32) }),
  );
});
test("driver never reports added if Telegram returns a missing invitee", async () => {
  const { Api } = native("teleproto"),
    bigInt = native("big-integer");
  const d = new driver.TelegramDriver({ apiId: 1, apiHash: "a".repeat(32) });
  const target = new Api.Channel({
    id: bigInt(2),
    title: "private",
    photo: new Api.ChatPhotoEmpty(),
    date: 0,
    megagroup: true,
    creator: true,
  });
  d.group = async () => target;
  d.member = async () => false;
  d.client.invoke = async () => ({ missingInvitees: [{ userId: bigInt(7) }] });
  assert.equal(
    (await d.invite(-1, -2, { ...data().contacts[0], accessHash: "123" }))
      .state,
    "privacy",
  );
  await d.close();
});

function harness(options = {}) {
  const row = {
    userId: "owner",
    parsed: data(),
    authState: "connected",
    authAttempt: "a",
    authExpiresAt: new Date(Date.now() + 60000),
    credentialsEnc: "key",
    sessionEnc: "session",
  };
  const job = domain.enqueue(row.parsed, -1, -2, [7, 8]);
  let calls = 0,
    released = 0,
    loggedOut = 0;
  const boundary = {
    load: async () => row,
    mutate: async (id, fn) => {
      assert.equal(id, "owner");
      return fn(row);
    },
    lease: async () => {
      if (options.busy) throw new domain.TelegramError("busy", "ocupado");
      return { token: "token", row: structuredClone(row) };
    },
    release: async () => {
      released++;
    },
    secret: (v) => (v === "key" ? { apiId: 1, apiHash: "fake" } : v),
    seal: (v) => JSON.stringify(v),
    finishConnection: (r, a, account) => {
      if (a !== r.authAttempt)
        throw new domain.TelegramError("cancelled", "cancelado");
      r.authState = "connected";
      r.parsed.account = account;
    },
    isAdministrator: async () => options.admin !== false,
  };
  class FakeDriver {
    constructor() {
      this.client = {
        checkAuthorization: async () => false,
        logOut: async () => {
          loggedOut++;
        },
        signInUserWithQrCode: async (_key, params) => {
          await params.qrCode({
            token: Buffer.from("FAKE"),
            expires: Date.now() / 1000 + 30,
          });
          if (options.qrCancel) {
            row.authAttempt = null;
            row.authState = "disconnected";
            return;
          }
          if (options.qrExpired) {
            row.authState = "qr_error";
            return;
          }
          if (options.twoFactor) await params.password();
        },
      };
    }
    async connect() {
      if (options.connect) await options.connect(row);
    }
    async invite() {
      calls++;
      if (options.invite) return options.invite(row);
      return { state: "added", message: "confirmado" };
    }
    async close() {}
    save() {
      return "FAKE-SESSION";
    }
    async me() {
      return { id: 99, name: "Teste", username: "" };
    }
  }
  const steps = loader({
    "./domain": domain,
    "./store": boundary,
    "./driver": {
      TelegramDriver: FakeDriver,
      deadline: async (p) => p,
      mapError: (e) =>
        e instanceof domain.TelegramError
          ? e
          : new domain.TelegramError("uncertain", "incerto"),
    },
  })("src/lib/telegram/steps.ts");
  return {
    row,
    job,
    steps,
    calls: () => calls,
    released: () => released,
    loggedOut: () => loggedOut,
  };
}
test("queue confirms each participant once and stops at completion", async () => {
  const h = harness();
  assert.equal(await h.steps.queueStep("owner", h.job.id), true);
  assert.equal(await h.steps.queueStep("owner", h.job.id), false);
  assert.equal(await h.steps.queueStep("owner", h.job.id), false);
  assert.equal(h.calls(), 2);
  assert.equal(h.job.success, 2);
});
test("concurrent duplicate worker waits without failing the active job", async () => {
  const h = harness({ busy: true });
  assert.equal(await h.steps.queueStep("owner", h.job.id), true);
  assert.equal(h.job.state, "queued");
  assert.equal(h.calls(), 0);
});
test("orphaned in-progress item is marked uncertain and never resent", async () => {
  const h = harness();
  h.row.parsed.results[0].state = "in_progress";
  assert.equal(await h.steps.queueStep("owner", h.job.id), false);
  assert.equal(h.row.parsed.results[0].state, "uncertain");
  assert.equal(h.job.state, "interrupted");
  assert.equal(h.calls(), 0);
});
test("deselection during connection prevents the actual invitation", async () => {
  const h = harness({
    connect: (r) => {
      r.parsed.contacts[0].selected = false;
    },
  });
  await h.steps.queueStep("owner", h.job.id);
  assert.equal(h.calls(), 0);
  assert.equal(h.row.parsed.results[0].state, "revoked");
});
for (const state of ["paused", "cancelled"])
  test(state + " before dispatch preserves remaining participant", async () => {
    const h = harness({
      connect: (r) => {
        r.parsed.jobs[0].state = state;
      },
    });
    assert.equal(await h.steps.queueStep("owner", h.job.id), false);
    assert.equal(h.calls(), 0);
    assert.equal(h.row.parsed.results[0].state, "waiting");
    assert.equal(h.job.state, state);
  });
test("role revocation prevents dispatch even if connection already started", async () => {
  const h = harness({ admin: false });
  assert.equal(await h.steps.queueStep("owner", h.job.id), false);
  assert.equal(h.calls(), 0);
});
test("FloodWait pauses queue with persisted server deadline and no automatic resend", async () => {
  const h = harness({
    invite: () => {
      throw new domain.TelegramError("flood_wait", "aguarde", 60);
    },
  });
  assert.equal(await h.steps.queueStep("owner", h.job.id), false);
  assert.equal(h.job.state, "paused_restriction");
  assert.ok(h.row.parsed.limits.not_before > Date.now() / 1000 + 59);
  await h.steps.queueStep("owner", h.job.id);
  assert.equal(h.calls(), 1);
});
test("network ambiguity is recorded once and stops the job", async () => {
  const h = harness({
    invite: () => {
      throw new Error("timeout");
    },
  });
  assert.equal(await h.steps.queueStep("owner", h.job.id), false);
  await h.steps.queueStep("owner", h.job.id);
  assert.equal(h.calls(), 1);
  assert.equal(h.row.parsed.results[0].state, "uncertain");
});
test("cancellation during an already dispatched call remains cancelled", async () => {
  const h = harness({
    invite: (r) => {
      r.parsed.jobs[0].state = "cancelled";
      throw new Error("network");
    },
  });
  await h.steps.queueStep("owner", h.job.id);
  assert.equal(h.job.state, "cancelled");
  assert.equal(h.calls(), 1);
});
for (const mode of ["success", "twoFactor", "qrCancel"])
  test("QR lifecycle: " + mode, async () => {
    const h = harness({ [mode]: true });
    h.row.authState = "qr";
    h.row.parsed.jobs = [];
    await h.steps.qrStep("owner", "a");
    assert.equal(
      h.row.authState,
      mode === "success"
        ? "connected"
        : mode === "twoFactor"
          ? "password"
          : "disconnected",
    );
    assert.equal(h.released(), 1);
    if (mode === "qrCancel") assert.equal(h.loggedOut(), 1);
  });
test("QR refuses to commit a session if administrator access was removed", async () => {
  const h = harness({ admin: false });
  h.row.authState = "qr";
  await h.steps.qrStep("owner", "a");
  assert.equal(h.row.authState, "qr_error");
  assert.equal(h.loggedOut(), 1);
});
test("QR expiry during final confirmation logs out the discarded Telegram session", async () => {
  const h = harness({ qrExpired: true });
  h.row.authState = "qr";
  await h.steps.qrStep("owner", "a");
  assert.equal(h.row.authState, "qr_error");
  assert.equal(h.loggedOut(), 1);
});
test("failed workflow start returns resumed job to paused instead of leaving it stuck", async () => {
  const row = { parsed: data() };
  const job = domain.enqueue(row.parsed, -1, -2, [7]);
  job.state = "paused";
  const service = loader({
    "./domain": domain,
    "./access": { csrf: () => "" },
    "./store": { mutate: async (_id, fn) => fn(row) },
    "workflow/api": {
      start: async () => {
        throw new Error("Unavailable");
      },
    },
    "@/workflows/telegram": {
      runTelegramQueue: () => {},
      connectTelegramQR: () => {},
    },
  })("src/lib/telegram/service.ts");
  await assert.rejects(
    service.control("owner", { job_id: job.id, action: "resume" }),
    (e) => e.code === "workflow",
  );
  assert.equal(job.state, "paused");
});

function searchDriver() {
  const { Api } = native("teleproto"),
    bigInt = native("big-integer");
  const driver = loader()("src/lib/telegram/driver.ts");
  const instance = new driver.TelegramDriver({
    apiId: 1,
    apiHash: "a".repeat(32),
  });
  const channel = (id, extra = {}) =>
    new Api.Channel({
      id: bigInt(id),
      accessHash: bigInt(987654321),
      title: "Grupo " + id,
      username: "grupo_" + id,
      photo: new Api.ChatPhotoEmpty(),
      date: 0,
      megagroup: true,
      left: true,
      ...extra,
    });
  const peer = (id) => new Api.PeerChannel({ channelId: bigInt(id) });
  return { Api, instance, channel, peer, driver, bigInt };
}
test("ordinary joined groups are listed and accepted as collection origins", async () => {
  const { instance, channel, Api, bigInt } = searchDriver();
  const source = channel(1, {
    left: false,
    creator: false,
    adminRights: undefined,
  });
  const target = channel(2, {
    left: false,
    creator: true,
    username: undefined,
  });
  instance.client.getDialogs = async () => [
    { entity: source },
    { entity: target },
    { entity: channel(3, { left: true }) },
    { entity: channel(4, { broadcast: true, megagroup: false }) },
  ];
  const groups = await instance.groups();
  assert.equal(groups.length, 2);
  assert.equal(groups[0].owner, false);
  assert.equal(await instance.group(groups[0].id), source);
  const user = (id) =>
    new Api.User({
      id: bigInt(id),
      accessHash: bigInt(123),
      firstName: "Pessoa " + id,
    });
  instance.client.iterParticipants = async function* () {
    yield user(7);
    yield new Api.User({ id: bigInt(9), bot: true });
    yield user(8);
  };
  const contacts = await instance.collect(groups[0].id, groups[1].id);
  assert.deepEqual(
    contacts.map((p) => p.user_id),
    [7, 8],
  );
  instance.member = async (group) => {
    assert.equal(
      group,
      target,
      "origin GetParticipant must not impose an admin-only API check",
    );
    return true;
  };
  assert.equal(
    (await instance.invite(groups[0].id, groups[1].id, contacts[0])).state,
    "already",
  );
  await instance.close();
});
test("platform refusal to list participants is surfaced without a bypass or fallback scrape", async () => {
  const { instance, channel } = searchDriver();
  instance.group = async () => channel(1, { left: false });
  let attempts = 0;
  instance.client.iterParticipants = async function* () {
    attempts++;
    throw { errorMessage: "CHAT_ADMIN_REQUIRED" };
  };
  await assert.rejects(
    instance.collect(-1, -2),
    (e) => e.errorMessage === "CHAT_ADMIN_REQUIRED",
  );
  assert.equal(attempts, 1);
  await instance.close();
});
test("configure, collect, bulk select and queue work without per-person authorization setup", async () => {
  const row = {
    parsed: domain.initialData(),
    authState: "connected",
    authAttempt: null,
    credentialsEnc: "key",
    sessionEnc: "saved",
    busyToken: "token",
  };
  row.parsed.authorizedIds = [999];
  let started = 0;
  const source = { ...group(-1), owner: false, can_invite: false },
    target = group(-2);
  class Driver {
    async connect() {}
    async close() {}
    save() {
      return "saved";
    }
    async groups() {
      return [source, target];
    }
    async privacy() {
      return { group_id: -2, private: true };
    }
    async collect(sourceId, targetId) {
      assert.equal(sourceId, -1);
      assert.equal(targetId, -2);
      return [7, 8].map((user_id) => ({
        user_id,
        name: "Pessoa " + user_id,
        username: "u" + user_id,
        accessHash: "hash",
      }));
    }
  }
  const service = loader({
    "./domain": domain,
    "./access": { csrf: () => "" },
    "./driver": {
      TelegramDriver: Driver,
      deadline: async (p) => p,
      mapError: (e) => e,
    },
    "./store": {
      load: async () => row,
      lease: async () => ({ token: "token", row: structuredClone(row) }),
      release: async () => {},
      mutate: async (_id, fn) => fn(row),
      secret: (value) =>
        value === "key" ? { apiId: 1, apiHash: "test" } : value,
      seal: (value) => value,
      notBusy: () => {},
    },
    "workflow/api": {
      start: async () => {
        started++;
      },
    },
    "@/workflows/telegram": { runTelegramQueue: () => {} },
  })("src/lib/telegram/service.ts");
  assert.deepEqual(
    await service.configure("owner", { source_id: -1, target_id: -2 }),
    { ok: true },
  );
  assert.deepEqual(
    await service.collect("owner", { source_id: -1, target_id: -2 }),
    { received: 2 },
  );
  assert.ok(row.parsed.contacts.every((p) => !p.selected));
  assert.equal(
    (
      await service.localAction("owner", "/selection/bulk", {
        source_id: -1,
        target_id: -2,
      })
    ).selected,
    2,
  );
  assert.equal(
    (
      await service.createJob("owner", {
        source_id: -1,
        target_id: -2,
        user_ids: [7, 8],
      })
    ).total,
    2,
  );
  assert.equal(started, 1);
});
test("public discovery returns only valid public groups, without membership changes or secrets", async () => {
  const { Api, instance, channel, peer } = searchDriver();
  const calls = [];
  const chats = [
    channel(1, { participantsCount: 123 }),
    channel(2, { username: undefined }),
    channel(3, { broadcast: true, megagroup: false }),
    channel(4, { scam: true }),
    channel(5, { username: "bad/username" }),
    channel(6, {
      username: undefined,
      usernames: [new Api.Username({ username: "collectible", active: true })],
    }),
  ];
  instance.client.invoke = async (request) => {
    calls.push(request);
    if (request instanceof Api.contacts.Search)
      return new Api.contacts.Found({
        myResults: [],
        results: [
          ...chats.map((_, i) => peer(i + 1)),
          peer(1),
          new Api.PeerUser({ userId: native("big-integer")(99) }),
        ],
        chats,
        users: [],
      });
    if (request instanceof Api.contacts.GetSponsoredPeers)
      return new Api.contacts.SponsoredPeersEmpty();
    throw new Error("Unexpected mutating call");
  };
  const groups = await instance.searchGroups(
    domain.groupSearch("fitness atacado"),
  );
  assert.deepEqual(
    groups.map((g) => g.username),
    ["grupo_1", "collectible"],
  );
  assert.equal(groups[0].members, 123);
  assert.equal(groups[1].members, null);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].limit, 30);
  assert.ok(!JSON.stringify(groups).includes("accessHash"));
  assert.ok(!JSON.stringify(groups).includes("987654321"));
  await instance.close();
});
test("discovery keeps Telegram result order and labels sponsored groups", async () => {
  const { Api, instance, channel, peer } = searchDriver();
  instance.client.invoke = async (request) =>
    request instanceof Api.contacts.Search
      ? new Api.contacts.Found({
          myResults: [peer(1)],
          results: [peer(3), peer(1)],
          chats: [channel(1), channel(3)],
          users: [],
        })
      : new Api.contacts.SponsoredPeers({
          peers: [
            new Api.SponsoredPeer({
              randomId: Buffer.from("fake"),
              peer: peer(2),
            }),
          ],
          chats: [channel(2)],
          users: [],
        });
  const groups = await instance.searchGroups({ text: "atacado" });
  assert.deepEqual(
    groups.map((g) => g.username),
    ["grupo_1", "grupo_2", "grupo_3"],
  );
  assert.deepEqual(
    groups.map((g) => g.sponsored),
    [false, true, false],
  );
  await instance.close();
});
test("exact lookup does not return auxiliary chats or turn users and channels into groups", async () => {
  const { Api, instance, channel, peer } = searchDriver();
  let calls = 0;
  instance.client.invoke = async (request) => {
    calls++;
    assert.ok(request instanceof Api.contacts.ResolveUsername);
    assert.equal(request.username, "grupo_exato");
    return new Api.contacts.ResolvedPeer({
      peer: peer(2),
      chats: [channel(1), channel(2)],
      users: [],
    });
  };
  assert.equal(
    (await instance.searchGroups(domain.groupSearch("@grupo_exato")))[0]
      .username,
    "grupo_2",
  );
  assert.equal(calls, 1);
  instance.client.invoke = async () =>
    new Api.contacts.ResolvedPeer({
      peer: new Api.PeerUser({ userId: native("big-integer")(2) }),
      chats: [channel(2)],
      users: [],
    });
  assert.deepEqual(
    await instance.searchGroups({ text: "@user", username: "user" }),
    [],
  );
  await instance.close();
});
test("discovery refuses a disconnected session before constructing a Telegram client", async () => {
  const row = {
    parsed: domain.initialData(),
    authState: "disconnected",
    sessionEnc: null,
    credentialsEnc: null,
  };
  let constructed = 0,
    released = 0;
  const service = loader({
    "./domain": domain,
    "./access": { csrf: () => "" },
    "./driver": {
      TelegramDriver: class {
        constructor() {
          constructed++;
        }
      },
      mapError: (e) => e,
    },
    "./store": {
      lease: async () => ({ token: "token", row }),
      mutate: async (_id, fn) => fn(row),
      release: async () => {
        released++;
      },
    },
    "workflow/api": { start: async () => {} },
    "@/workflows/telegram": {},
  })("src/lib/telegram/service.ts");
  await assert.rejects(
    service.discover("owner", { query: "fitness atacado" }),
    (e) => e.code === "auth_required",
  );
  assert.equal(constructed, 0);
  assert.equal(released, 1);
});
function discoveryUI(connected = true, contents = null) {
  const elements = new Map(),
    requests = [];
  const getElementById = (id) => {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        dataset: {},
        open: false,
        listeners: {},
        textContent: "",
        innerHTML: "",
        addEventListener(name, fn) {
          this.listeners[name] = fn;
        },
        setAttribute() {},
        removeAttribute() {},
        focus() {},
        reportValidity() {
          return true;
        },
      });
    return elements.get(id);
  };
  const d = contents || domain.initialData();
  const snapshot = {
    ...domain.publicSnapshot(d),
    csrf_token: "TEST-TOKEN",
    sources: d.sources,
    targets: d.targets,
    mode: "live",
    connection: {
      state: connected ? "connected" : "disconnected",
      account: { id: 1 },
      configured: !!d.sources.length && !!d.targets.length,
      enabled: true,
      groups: [...d.sources, ...d.targets],
      retry_at: 0,
      privacy: d.targets[0]
        ? { group_id: d.targets[0].id, private: true, owner: true }
        : null,
    },
  };
  const response = (body) => ({
    ok: true,
    redirected: false,
    json: async () => body,
  });
  let resolveSearch;
  const context = createContext({
    document: { hidden: false, getElementById, querySelectorAll: () => [] },
    AbortController,
    URL,
    setTimeout: () => 1,
    clearTimeout() {},
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/state")) return response(snapshot);
      return new Promise((resolve) => {
        resolveSearch = (body) => resolve(response(body));
      });
    },
  });
  runInContext(readFileSync("public/telegram-assets/app.js", "utf8"), context);
  runInContext(
    readFileSync("public/telegram-assets/discovery.js", "utf8"),
    context,
  );
  return {
    elements,
    getElementById,
    requests,
    resolve: (body) => resolveSearch(body),
    context,
    drain: async () => {
      for (let i = 0; i < 16; i++) await Promise.resolve();
    },
  };
}
test("discovery UI requires connection and never sends a search while disconnected", async () => {
  const ui = discoveryUI(false);
  await ui.drain();
  assert.equal(ui.getElementById("discovery-submit").disabled, true);
  await ui
    .getElementById("discovery-form")
    .listeners.submit({ preventDefault() {} });
  assert.equal(ui.requests.length, 1);
});
test("discovery UI shows real response, escapes names and builds only Telegram links", async () => {
  const ui = discoveryUI();
  await ui.drain();
  ui.getElementById("discovery-query").value = "fitness atacado";
  const pending = ui
    .getElementById("discovery-form")
    .listeners.submit({ preventDefault() {} });
  await ui.drain();
  assert.equal(ui.getElementById("collect").disabled, true);
  assert.equal(ui.requests[1].url, "/api/telegram/discover");
  assert.equal(ui.requests[1].options.headers["X-CSRF-Token"], "TEST-TOKEN");
  ui.resolve({
    query: "fitness atacado",
    groups: [
      {
        name: "<img src=x onerror=evil()>",
        username: "fitness_atacado",
        members: 200,
        url: "javascript:evil()",
      },
      { name: "Invalid", username: "bad/<script>", members: 2 },
    ],
  });
  await pending;
  const html = ui.getElementById("discovery-results").innerHTML;
  assert.ok(html.includes("&lt;img"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes('href="https://t.me/fitness_atacado"'));
  assert.ok(!html.includes("bad/"));
  assert.equal(ui.getElementById("discovery-submit").disabled, false);
});
test("discovery UI renders empty results honestly and discards results after account change", async () => {
  const ui = discoveryUI();
  await ui.drain();
  ui.getElementById("discovery-query").value = "biquíni atacado";
  let pending = ui
    .getElementById("discovery-form")
    .listeners.submit({ preventDefault() {} });
  await ui.drain();
  ui.resolve({ query: "biquíni atacado", groups: [] });
  await pending;
  assert.match(
    ui.getElementById("discovery-status").textContent,
    /Nenhum grupo público/,
  );
  pending = ui
    .getElementById("discovery-form")
    .listeners.submit({ preventDefault() {} });
  await ui.drain();
  runInContext("state.connection.account.id=2;render();", ui.context);
  ui.resolve({
    query: "old",
    groups: [{ name: "old", username: "old_group", members: 1 }],
  });
  await pending;
  assert.equal(ui.getElementById("discovery-results").innerHTML, "");
});
test("panel enables inclusion for selected contacts without consent records", async () => {
  const ui = discoveryUI(true, data());
  await ui.drain();
  ui.getElementById("source").value = "-1";
  ui.getElementById("target").value = "-2";
  runInContext("render();", ui.context);
  assert.equal(ui.getElementById("start").disabled, false);
  assert.equal(ui.getElementById("count-ready").textContent, 2);
  assert.ok(!ui.getElementById("contacts").innerHTML.includes("data-consent"));
  ui.getElementById("start").listeners.click();
  await ui.drain();
  const request = ui.requests.find((r) => r.url.endsWith("/jobs"));
  assert.deepEqual(JSON.parse(request.options.body), {
    source_id: -1,
    target_id: -2,
    user_ids: [7, 8],
  });
  ui.resolve({ ok: true });
  await ui.drain();
});
test("group setup has no manual participant list requirement", async () => {
  const ui = discoveryUI(true, data());
  await ui.drain();
  runInContext(
    readFileSync("public/telegram-assets/setup.js", "utf8"),
    ui.context,
  );
  runInContext("render();", ui.context);
  assert.equal(ui.getElementById("activate-live").disabled, false);
  assert.equal(ui.elements.has("setup-participants"), false);
  ui.getElementById("activate-live").listeners.click();
  await ui.drain();
  const request = ui.requests.find((r) =>
    r.url.endsWith("/connection/configure"),
  );
  assert.deepEqual(JSON.parse(request.options.body), {
    source_id: -1,
    target_id: -2,
  });
  ui.resolve({ ok: true });
  await ui.drain();
});
