import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { transformSync } from "esbuild";
const native = createRequire(import.meta.url);
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = transformSync(readFileSync(file, "utf8"), {
      loader: "ts",
      format: "cjs",
      target: "node20",
    }).code;
    function localRequire(name) {
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
    new Function("require", "module", "exports", "fetch", code)(
      localRequire,
      module,
      module.exports,
      mocks.$fetch || globalThis.fetch,
    );
    return module.exports;
  }
  return load;
}
process.env.AUTH_SECRET = "test-only-telegram-growth";
process.env.DATABASE_URL =
  "postgresql://test:test@127.0.0.1:5432/test?schema=painel_bff";
process.env.TOKEN_ENCRYPTION_KEY =
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const domain = loader()("src/lib/telegram/growth-domain.ts");
const initialData = loader()("src/lib/telegram/domain.ts").initialData;

test("Google Analytics filters only BFF hosts and Telegram and scopes an origin by tracked link slug", () => {
  const analytics = loader({
    googleapis: { google: {} },
    "@/lib/prisma": { prisma: {} },
  })("src/lib/telegram/analytics.ts");
  const query = analytics.analyticsRequest(7, ["abc123"]);
  const filters = query.dimensionFilter.andGroup.expressions.map(
    (e) => e.filter,
  );
  assert.deepEqual(
    filters.find((f) => f.fieldName === "hostName").inListFilter.values,
    ["www.bfffitnessatacado.com.br", "bfffitnessatacado.com.br"],
  );
  assert.ok(
    filters
      .find((f) => f.fieldName === "sessionSource")
      .inListFilter.values.includes("telegram"),
  );
  assert.deepEqual(
    filters.find((f) => f.fieldName === "sessionManualAdContent").inListFilter
      .values,
    ["abc123"],
  );
  const report = {
    dimensionHeaders: [{ name: "date" }],
    metricHeaders: [
      { name: "sessions" },
      { name: "ecommercePurchases" },
      { name: "purchaseRevenue" },
    ],
    rows: [
      {
        dimensionValues: [{ value: "20261101" }],
        metricValues: [
          { value: "50" },
          { value: "2" },
          { value: "100.989999" },
        ],
      },
    ],
    rowCount: 1,
  };
  const summary = analytics.analyticsSummary(report);
  assert.equal(summary.sessions, 50);
  assert.equal(summary.purchases, 2);
  assert.equal(summary.revenue, 100.99);
  assert.equal(summary.partial, false);
  assert.equal(
    analytics.analyticsSummary({
      ...report,
      metadata: { subjectToThresholding: true },
    }).partial,
    true,
  );
  assert.throws(() => analytics.analyticsSummary({ rows: [] }));
});
test("GA4 connection uses read-only scope, never returns credentials, and isolates a real zero from an API failure", async () => {
  let fail = false,
    calls = 0;
  process.env.BFF_GA_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: "service_account",
    client_email: "test@example.invalid",
    private_key: "never-output-this-key",
  });
  const analytics = loader({
    "@/lib/prisma": { prisma: {} },
    googleapis: {
      google: {
        auth: {
          GoogleAuth: class {
            constructor(options) {
              assert.deepEqual(options.scopes, [
                "https://www.googleapis.com/auth/analytics.readonly",
              ]);
            }
            async getClient() {
              return {
                request: async (options) => {
                  calls++;
                  assert.match(options.url, /properties\/419011003:runReport$/);
                  if (fail) throw Error("credential secret details");
                  return {
                    data: {
                      dimensionHeaders: [{ name: "date" }],
                      metricHeaders: [
                        { name: "sessions" },
                        { name: "ecommercePurchases" },
                        { name: "purchaseRevenue" },
                      ],
                      rows: [],
                      rowCount: 0,
                    },
                  };
                },
              };
            }
          },
        },
      },
    },
  })("src/lib/telegram/analytics.ts");
  try {
    const ok = await analytics.googleAnalytics(7);
    assert.equal(ok.connected, true);
    assert.equal(ok.sessions, 0);
    await analytics.googleAnalytics(7);
    assert.equal(calls, 1);
    fail = true;
    const failed = await analytics.googleAnalytics(7, undefined, true);
    assert.equal(failed.connected, false);
    assert.ok(failed.error);
    assert.ok(!JSON.stringify(failed).includes("secret"));
    assert.ok(!JSON.stringify(ok).includes("never-output-this-key"));
  } finally {
    delete process.env.BFF_GA_SERVICE_ACCOUNT_JSON;
  }
});
test("restoring the BFF Tray grant validates the store, encrypts tokens, and preserves an existing connection", async () => {
  const plain = "test_token_for_bff_only_12345";
  let saved,
    probes = 0;
  const conn = {
    findFirst: async () => (saved ? { id: "existing" } : null),
    create: async ({ data }) => {
      saved = data;
    },
  };
  const config = {
    apiAddress: "https://www.bfffitnessatacado.com.br/web_api",
    storeId: "1270558",
    accessToken: plain,
    refreshToken: plain + "_refresh",
    accessExpiresAt: new Date(Date.now() + 3600000).toISOString(),
    refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  process.env.BFF_TRAY_CONNECTION_BOOTSTRAP = JSON.stringify(config);
  const analytics = loader({
    googleapis: { google: {} },
    "@/lib/prisma": {
      prisma: {
        trayConnection: conn,
        $transaction: async (fn) =>
          fn({
            $queryRaw: async () => [{ locked: true }],
            trayConnection: conn,
          }),
      },
    },
    $fetch: async () => {
      probes++;
      return { ok: true, json: async () => ({ Orders: [] }) };
    },
  })("src/lib/telegram/analytics.ts");
  try {
    const result = await analytics.restoreTray("owner");
    assert.equal(result.restored, true);
    assert.equal(saved.connectedByUserId, "owner");
    assert.notEqual(saved.accessToken, plain);
    assert.ok(!saved.accessToken.includes(plain));
    assert.equal((await analytics.restoreTray("owner")).restored, false);
    assert.equal(probes, 1);
    saved = null;
    process.env.BFF_TRAY_CONNECTION_BOOTSTRAP = JSON.stringify({
      ...config,
      apiAddress: "https://wrong.example/web_api",
    });
    await assert.rejects(analytics.restoreTray("owner"));
    assert.equal(probes, 1);
  } finally {
    delete process.env.BFF_TRAY_CONNECTION_BOOTSTRAP;
  }
});

test("tracker installation serializes concurrent calls and leaves other store scripts untouched", async () => {
  const scripts = [
    {
      ExternalScript: {
        id: "other",
        source: "https://other.example/existing.js",
      },
    },
  ];
  let locked = false,
    creations = 0;
  const state = {};
  const prisma = {
    $queryRaw: async () => [1, 2, 3].map(() => ({ safe: true })),
    $transaction: async (fn) => {
      let owns = false;
      try {
        return await fn({
          $queryRaw: async () => {
            if (locked) return [{ locked: false }];
            locked = true;
            owns = true;
            return [{ locked: true }];
          },
        });
      } finally {
        if (owns) locked = false;
      }
    },
  };
  const growth = loader({
    "@/lib/prisma": { prisma },
    "@/lib/tray": {
      trayGet: async () => ({ ExternalScripts: [...scripts] }),
      getValidAccessToken: async () => ({
        apiAddress: "https://tray.example/web_api",
        accessToken: "local-test-token",
      }),
    },
    "@/lib/traySales": {},
    "./access": {},
    "./store": { mutate: async (_id, fn) => fn({ parsed: state }) },
    $fetch: async (_url, request) => {
      creations++;
      const payload = JSON.parse(request.body);
      assert.equal(
        payload.ExternalScript.source,
        "https://app.bfffitnessatacado.com.br/api/telegram-growth/tracker.js",
      );
      scripts.push({
        ExternalScript: { id: "ours", source: payload.ExternalScript.source },
      });
      return { ok: true, json: async () => ({ id: "ours", code: 201 }) };
    },
  })("src/lib/telegram/growth.ts");
  const result = await Promise.allSettled([
    growth.installTracker("owner", "https://app.bfffitnessatacado.com.br"),
    growth.installTracker("owner", "https://app.bfffitnessatacado.com.br"),
  ]);
  assert.equal(result.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(creations, 1);
  assert.equal(
    scripts[0].ExternalScript.source,
    "https://other.example/existing.js",
  );
  await growth.installTracker("owner", "https://app.bfffitnessatacado.com.br");
  assert.equal(creations, 1);
  assert.ok(state.growth.installedAt);
});

test("tracked links preserve product queries and restrict destinations to the BFF storefront", () => {
  for (const bad of [
    "javascript:alert(1)",
    "http://www.bfffitnessatacado.com.br",
    "https://bfffitnessatacado.com.br.evil.com",
    "https://user:password@www.bfffitnessatacado.com.br",
    "https://www.bfffitnessatacado.com.br:8888",
    "https://www.bfffitnessatacado.com.br/checkout",
  ])
    assert.throws(() => domain.destination(bad));
  const url = new URL(
    domain.trackedDestination(
      {
        destination:
          "https://www.bfffitnessatacado.com.br/colecao?foo=1&parceiro=4273",
        campaign: "Verão & fitness",
        sourceName: "BFF",
        slug: "abc",
      },
      "signed",
    ),
  );
  assert.equal(url.searchParams.get("foo"), "1");
  assert.equal(url.searchParams.get("parceiro"), "4273");
  assert.equal(url.searchParams.get("utm_source"), "telegram");
  assert.equal(url.searchParams.get("utm_campaign"), "Verão & fitness");
  assert.equal(url.searchParams.get("bff_tg"), "signed");
});
test("click signatures reject tampering; previews and speculative requests never count", () => {
  const id = "89cf5990-82fb-4437-aef9-2f6add0220dc";
  assert.equal(domain.verifyClick(domain.signClick(id)), id);
  assert.equal(
    domain.verifyClick(domain.signClick(id).slice(0, -1) + "z"),
    null,
  );
  assert.equal(domain.verifyClick("../../bad"), null);
  for (const headers of [
    { "user-agent": "TelegramBot (like TwitterBot)" },
    { "sec-purpose": "prefetch;prerender" },
    { purpose: "prefetch" },
  ])
    assert.equal(domain.isPreview(new Headers(headers)), true);
  assert.equal(
    domain.isPreview(new Headers({ "user-agent": "Mozilla/5.0" })),
    false,
  );
});
test("public redirect records a click, previews and HEAD do not; paused links and logging failure still open the store", async () => {
  const { NextRequest } = native("next/server");
  const link = {
    id: "l1",
    slug: "abcdefgh1234",
    active: true,
    destination: "https://www.bfffitnessatacado.com.br/",
    campaign: "Fitness",
    sourceName: "BFF",
  };
  let created = 0,
    fail = false;
  const prisma = {
    telegramGrowthLink: { findUnique: async () => link },
    telegramGrowthClick: {
      count: async () => 0,
      create: async () => {
        if (fail) throw Error("test");
        created++;
        return { id: "89cf5990-82fb-4437-aef9-2f6add0220dc" };
      },
    },
  };
  const route = loader({
    "@/lib/prisma": { prisma },
    "@/lib/telegram/growth": { checkGrowthStorage: async () => {} },
  })("src/app/t/[slug]/route.ts");
  const ctx = { params: Promise.resolve({ slug: link.slug }) };
  const req = (ua) =>
    new NextRequest(`https://app.bfffitnessatacado.com.br/t/${link.slug}`, {
      headers: { "user-agent": ua },
    });
  const first = await route.GET(req("Mozilla/5.0"), ctx);
  assert.equal(first.status, 302);
  assert.equal(created, 1);
  assert.ok(new URL(first.headers.get("location")).searchParams.get("bff_tg"));
  assert.match(first.headers.get("set-cookie"), /HttpOnly/);
  assert.match(first.headers.get("cache-control"), /no-store/);
  const preview = await route.GET(req("TelegramBot"), ctx);
  assert.equal(created, 1);
  assert.equal(
    new URL(preview.headers.get("location")).searchParams.has("bff_tg"),
    false,
  );
  await route.HEAD(req("Mozilla/5.0"), ctx);
  assert.equal(created, 1);
  link.active = false;
  await route.GET(req("Mozilla/5.0"), ctx);
  assert.equal(created, 1);
  link.active = true;
  fail = true;
  assert.equal((await route.GET(req("Mozilla/5.0"), ctx)).status, 302);
});
test("periods use Brasília midnight and separate new acquisitions, clicks, confirmed visits and paid orders", () => {
  const now = new Date("2026-11-02T02:30:00Z"); // still November 1 in Brasília
  assert.equal(domain.day(now), "2026-11-01");
  const range = domain.period(7, now);
  assert.equal(range.start.toISOString(), "2026-10-26T03:00:00.000Z");
  const at = new Date("2026-11-01T15:00:00-03:00");
  const data = initialData({
    sources: [{ id: -1, name: "Fitness" }],
    jobs: [{ id: "j", source_id: -1, target_id: -2 }],
    results: [
      {
        user_id: 1,
        job_id: "j",
        state: "added",
        updated_at: at.getTime() / 1000,
      },
      {
        user_id: 1,
        job_id: "j",
        state: "added",
        updated_at: at.getTime() / 1000 + 1,
      },
      {
        user_id: 2,
        job_id: "j",
        state: "already",
        updated_at: at.getTime() / 1000,
      },
      {
        user_id: 3,
        job_id: "j",
        state: "uncertain",
        updated_at: at.getTime() / 1000,
      },
    ],
  });
  const links = [
    { id: "l1", sourceName: "Fitness", createdAt: at },
    { id: "l2", sourceName: "Praia", createdAt: at },
  ];
  const clicks = [
    { id: "c1", linkId: "l1", visitorHash: "v1", createdAt: at, visitedAt: at },
    {
      id: "c2",
      linkId: "l1",
      visitorHash: "v1",
      createdAt: at,
      visitedAt: null,
    },
    { id: "c3", linkId: "l2", visitorHash: "v2", createdAt: at, visitedAt: at },
  ];
  const sales = [
    { clickId: "c1", status: "paid", amountCents: 12345, placedAt: at },
    { clickId: "c2", status: "pending", amountCents: 555, placedAt: at },
    { clickId: "c1", status: "cancelled", amountCents: 999, placedAt: at },
    { clickId: "c3", status: "paid", amountCents: 5000, placedAt: at },
  ];
  const summary = domain.summarize(
    links,
    clicks,
    sales,
    data,
    7,
    "Fitness",
    new Date("2026-11-02T00:00:00Z"),
  );
  assert.equal(summary.totals.audience, 1);
  assert.equal(summary.totals.clicks, 2);
  assert.equal(summary.totals.visitors, 1);
  assert.equal(summary.totals.visits, 1);
  assert.equal(summary.totals.sales, 1);
  assert.equal(summary.totals.pending, 1);
  assert.equal(summary.totals.revenue, 123.45);
  assert.equal(summary.daily.length, 7);
  assert.equal(
    summary.daily.reduce((n, d) => n + d.revenue, 0),
    123.45,
  );
  assert.equal(summary.previous.sales, 0);
});
test("payment confirmation uses Tray has_payment, never a payment date or pending status", () => {
  assert.equal(
    domain.orderStatus({
      status: "AGUARDANDO PAGAMENTO",
      payment_date: "2026-11-01",
      has_payment: "0",
    }),
    "pending",
  );
  assert.equal(
    domain.orderStatus({ status: "FINALIZADO", has_payment: "1" }),
    "paid",
  );
  assert.equal(
    domain.orderStatus({ status: "CANCELADO", has_payment: "1" }),
    "cancelled",
  );
  assert.equal(domain.cents("1234.56"), 123456);
  assert.throws(() => domain.cents("1.234,56"));
  assert.throws(() => domain.cents("-1"));
});
function visitHarness() {
  const click = {
    id: "89cf5990-82fb-4437-aef9-2f6add0220dc",
    createdAt: new Date(),
    visitedAt: null,
    sessionHash: null,
  };
  const prisma = {
    telegramGrowthClick: {
      findUnique: async () => click,
      updateMany: async ({ where, data }) => {
        const matches =
          (where.visitedAt === null
            ? click.visitedAt === null
            : !!click.visitedAt) &&
          (where.sessionHash !== null || click.sessionHash === null);
        if (matches) Object.assign(click, data);
        return { count: matches ? 1 : 0 };
      },
    },
  };
  const route = loader({
    "@/lib/prisma": { prisma },
    "@/lib/telegram/growth": { checkGrowthStorage: async () => {} },
    "@/lib/telegram/access": { body: async (req) => req.json() },
  })("src/app/api/telegram-growth/[action]/route.ts");
  const request = (data, origin = "https://www.bfffitnessatacado.com.br") =>
    new Request(
      "https://app.bfffitnessatacado.com.br/api/telegram-growth/visit",
      {
        method: "POST",
        headers: { origin, "Content-Type": "text/plain" },
        body: JSON.stringify(data),
      },
    );
  return {
    click,
    route,
    request,
    ctx: { params: Promise.resolve({ action: "visit" }) },
  };
}
test("visit beacon requires approved origin and signed click, is idempotent, and cannot replace attached session", async () => {
  const { click, route, request, ctx } = visitHarness();
  const token = domain.signClick(click.id);
  assert.equal(
    (await route.POST(request({ token }, "https://evil.com"), ctx)).status,
    403,
  );
  assert.equal(
    (await route.POST(request({ token: "forged" }), ctx)).status,
    400,
  );
  assert.equal(click.visitedAt, null);
  assert.equal(
    (await route.POST(request({ token, session: "a".repeat(64) }), ctx)).status,
    204,
  );
  const first = click.visitedAt,
    hash = click.sessionHash;
  assert.equal(
    (await route.POST(request({ token, session: "b".repeat(64) }), ctx)).status,
    204,
  );
  assert.equal(click.visitedAt, first);
  assert.equal(click.sessionHash, hash);
  assert.notEqual(hash, "a".repeat(64));
});
test("unconfirmed clicks older than one day cannot be retroactively turned into visits", async () => {
  const { click, route, request, ctx } = visitHarness();
  click.createdAt = new Date(Date.now() - 2 * 86400000);
  await route.POST(
    request({ token: domain.signClick(click.id), session: "a".repeat(64) }),
    ctx,
  );
  assert.equal(click.visitedAt, null);
  assert.equal(click.sessionHash, null);
});
test("store tracker confirms only signed referrals, hashes session before sending, and tolerates unavailable storage", async () => {
  const source = readFileSync("public/telegram-assets/tracker.js", "utf8");
  const sent = [];
  const context = {
    URL,
    TextEncoder,
    Uint8Array,
    Array,
    Date,
    setTimeout: () => {},
    location: {
      hostname: "www.bfffitnessatacado.com.br",
      href: `https://www.bfffitnessatacado.com.br/?bff_tg=${domain.signClick("89cf5990-82fb-4437-aef9-2f6add0220dc")}`,
    },
    localStorage: {
      setItem: () => {
        throw Error("blocked");
      },
      getItem: () => null,
    },
    document: {
      currentScript: {
        src: "https://app.bfffitnessatacado.com.br/api/telegram-growth/tracker.js",
      },
      visibilityState: "visible",
      documentElement: {
        getAttribute: () => "never-transmit-raw-session",
        addEventListener() {},
      },
      addEventListener() {},
    },
    fetch: async (url, data) => {
      sent.push({ url, data: JSON.parse(data.body) });
      return { ok: true };
    },
  };
  context.window = { crypto: native("node:crypto").webcrypto };
  runInNewContext(source, context);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(sent.length, 1);
  assert.equal(
    sent[0].url,
    "https://app.bfffitnessatacado.com.br/api/telegram-growth/visit",
  );
  assert.equal(
    sent[0].data.session,
    domain.digest("never-transmit-raw-session"),
  );
  assert.ok(!JSON.stringify(sent).includes("never-transmit-raw-session"));
  const blank = {
    ...context,
    location: {
      hostname: "www.bfffitnessatacado.com.br",
      href: "https://www.bfffitnessatacado.com.br/",
    },
    window: { crypto: context.window.crypto },
  };
  runInNewContext(source, blank);
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(sent.length, 1);
});
test("order sync attributes last eligible click once and revalidates cancellation without contact data", async () => {
  const conversions = new Map(),
    savedConfig = {};
  const sessionHash = domain.hash(`session:${domain.digest("store-session")}`);
  const clicks = [
    {
      id: "last",
      sessionHash,
      createdAt: new Date("2026-11-01T14:00:00-03:00"),
      visitedAt: new Date("2026-11-01T14:01:00-03:00"),
    },
    {
      id: "first",
      sessionHash,
      createdAt: new Date("2026-11-01T13:00:00-03:00"),
      visitedAt: new Date("2026-11-01T13:01:00-03:00"),
    },
  ];
  let order = {
    id: "123",
    session_id: "store-session",
    date: "2026-11-01",
    hour: "15:00:00",
    status: "PAGO",
    has_payment: "1",
    total: "150.99",
  };
  const prisma = {
    $queryRaw: async () =>
      [1, 2, 3].map((i) => ({ name: String(i), safe: true })),
    telegramGrowthClick: { findMany: async () => clicks },
    telegramGrowthLink: { findMany: async () => [{ userId: "owner" }] },
    telegramGrowthConversion: {
      findMany: async () => [...conversions.values()],
      upsert: async ({ where, create, update }) =>
        conversions.set(
          where.orderKey,
          conversions.has(where.orderKey)
            ? { ...conversions.get(where.orderKey), ...update }
            : create,
        ),
    },
    trayConnection: { findFirst: async () => ({ storeId: "bff" }) },
  };
  const growth = loader({
    "@/lib/prisma": { prisma },
    "@/lib/tray": { trayGet: async () => ({ Order: order }) },
    "@/lib/traySales": {
      fetchOrdersSince: async () => ({ orders: [order], truncated: false }),
    },
    "./store": { mutate: async (_id, fn) => fn({ parsed: savedConfig }) },
    "./access": {},
  })("src/lib/telegram/growth.ts");
  await growth.syncSales("owner");
  await growth.syncSales("owner");
  assert.equal(conversions.size, 1);
  assert.equal(conversions.get("bff:123").clickId, "last");
  assert.equal(conversions.get("bff:123").amountCents, 15099);
  order = { ...order, status: "CANCELADO" };
  await growth.syncSales("owner");
  assert.equal(conversions.get("bff:123").status, "cancelled");
  assert.ok(savedConfig.growth.syncedAt);
  assert.ok(
    !JSON.stringify([...conversions.values()]).includes("store-session"),
  );
});
