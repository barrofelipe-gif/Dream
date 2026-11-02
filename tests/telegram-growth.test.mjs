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
    const loaded = { exports: {} };
    cache.set(file, loaded);
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
      loaded,
      loaded.exports,
      mocks.$fetch || globalThis.fetch,
    );
    return loaded.exports;
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
    "./tracker-install": {
      verifyStorefrontTracker: async () => ({ installed: false }),
    },
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

test("internal tracking validation is signed, short-lived, and excluded from Telegram analytics", () => {
  const now = Date.now(),
    slug = "abcdefgh1234",
    token = domain.validationToken(slug, now);
  assert.equal(domain.verifyValidation(slug, token, now), true);
  assert.equal(domain.verifyValidation("another12345", token, now), false);
  assert.equal(domain.verifyValidation(slug, token, now + 901000), false);
  const target = new URL(
    domain.trackedDestination(
      {
        destination: "https://www.bfffitnessatacado.com.br/",
        campaign: "test",
        sourceName: "BFF",
        slug,
      },
      "signed",
      true,
    ),
  );
  assert.equal(target.searchParams.get("utm_source"), "bff_validation");
  assert.equal(target.searchParams.get("bff_validation"), "1");
});

test("QA redirect records only an internal event and rejects an invalid validation signature", async () => {
  const { NextRequest } = native("next/server");
  let captured = null;
  const link = {
    id: "l",
    slug: "abcdefgh1234",
    active: true,
    destination: "https://www.bfffitnessatacado.com.br/",
    campaign: "BFF",
    sourceName: "BFF",
  };
  const prisma = {
    telegramGrowthLink: { findUnique: async () => link },
    telegramGrowthClick: {
      count: async () => 0,
      create: async ({ data }) => {
        captured = data;
        return { id: "89cf5990-82fb-4437-aef9-2f6add0220dc" };
      },
    },
  };
  const route = loader({
    "@/lib/prisma": { prisma },
    "@/lib/telegram/growth": { checkGrowthStorage: async () => {} },
  })("src/app/t/[slug]/route.ts");
  const context = { params: Promise.resolve({ slug: link.slug }) };
  const request = (token) =>
    new NextRequest(
      `https://app.bfffitnessatacado.com.br/t/${link.slug}?bff_test=${token}`,
      { headers: { "user-agent": "Mozilla/5.0" } },
    );
  assert.equal((await route.GET(request("invalid"), context)).status, 400);
  assert.equal(captured, null);
  const response = await route.GET(
    request(domain.validationToken(link.slug)),
    context,
  );
  assert.equal(response.status, 302);
  assert.match(captured.visitorHash, /^test:/);
  const target = new URL(response.headers.get("location"));
  assert.equal(target.searchParams.get("utm_source"), "bff_validation");
  assert.equal(target.searchParams.get("bff_validation"), "1");
  assert.ok(domain.verifyClick(target.searchParams.get("bff_tg")));
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
    {
      id: "qa",
      linkId: "l1",
      visitorHash: "test:validation",
      createdAt: at,
      visitedAt: at,
    },
  ];
  const sales = [
    { clickId: "qa", status: "paid", amountCents: 10000000, placedAt: at },
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
  let writes = 0;
  const qa = {
    ...context,
    window: { crypto: context.window.crypto },
    location: {
      ...context.location,
      href: context.location.href + "&bff_validation=1",
    },
    localStorage: {
      getItem: () => null,
      setItem: () => {
        writes++;
      },
    },
  };
  runInNewContext(source, qa);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(sent.length, 2);
  assert.equal(writes, 0);
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

test("sync confirms a paid GA4-referenced order without a native session, deduplicates it, and rechecks cancellations", async () => {
  const gaModule = loader({ googleapis: { google: {} } })(
    "src/lib/telegram/ga-attribution.ts",
  );
  const placedAt = new Date(Date.now() - 3600000);
  const local = new Date(placedAt.getTime() - 3 * 3600000).toISOString();
  let order = {
    id: "123",
    date: local.slice(0, 10),
    hour: local.slice(11, 19),
    total: "500.50",
    has_payment: "1",
    status: "PAGO",
  };
  const click = {
    id: "89cf5990-82fb-4437-aef9-2f6add0220dc",
    linkId: "l1",
    createdAt: new Date(placedAt.getTime() - 3600000),
    link: { slug: "abcdefgh1234" },
  };
  const config = {},
    conversions = new Map();
  let detailRequests = 0;
  const evidence = [
    {
      orderId: "123",
      clickId: click.id,
      slug: click.link.slug,
      purchaseMinute: new Date(Math.floor(placedAt.getTime() / 60000) * 60000),
    },
  ];
  const prisma = {
    $queryRaw: async () => [1, 2, 3].map(() => ({ safe: true })),
    telegramGrowthClick: {
      findMany: async ({ where }) => (where.id ? [click] : []),
    },
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
    telegramGrowthLink: { findMany: async () => [{ userId: "owner" }] },
    trayConnection: { findFirst: async () => ({ storeId: "1270558" }) },
  };
  const service = loader({
    "@/lib/prisma": { prisma },
    "@/lib/traySales": {
      fetchOrdersSince: async () => ({ orders: [], truncated: false }),
    },
    "@/lib/tray": {
      trayGet: async (resource) => {
        assert.equal(resource, "orders/123");
        detailRequests++;
        return { Order: order };
      },
    },
    "./ga-attribution": {
      ...gaModule,
      readGaPurchases: async () => ({
        status: "ready",
        connected: true,
        configured: true,
        checkedAt: new Date().toISOString(),
        timeZone: "America/Rio_Branco",
        partial: false,
        evidence,
        linkOnly: 0,
        invalid: 0,
      }),
    },
    "./store": { mutate: async (_id, fn) => fn({ parsed: config }) },
    "./access": {},
  })("src/lib/telegram/growth.ts");
  await service.syncSales("owner");
  await service.syncSales("owner");
  assert.equal(conversions.size, 1);
  assert.equal(conversions.get("1270558:123").clickId, click.id);
  assert.equal(conversions.get("1270558:123").amountCents, 50050);
  assert.equal(conversions.get("1270558:123").status, "paid");
  assert.equal(config.growth.gaAttribution.status, "ready");
  assert.equal(config.growth.gaAttribution.matched, 1);
  order = { ...order, status: "CANCELADO" };
  await service.syncSales("owner");
  assert.equal(conversions.get("1270558:123").status, "cancelled");
  assert.equal(detailRequests, 3); // one detail read per sync, including old-order review
});

function boundedSyncFixture({ historical = 0, ga = 0, native = 0, fail = [], invalid = [] } = {}) {
  const gaModule = loader({ googleapis: { google: {} } })("src/lib/telegram/ga-attribution.ts");
  const placedAt = new Date(Date.now() - 3600000);
  const older = new Date(placedAt.getTime() - 40 * 86400000);
  const local = (date) => new Date(date.getTime() - 3 * 3600000).toISOString();
  const orderAt = (id, date, extra = {}) => ({
    id, date: local(date).slice(0, 10), hour: local(date).slice(11, 19),
    total: "10.00", has_payment: "1", status: "PAGO", ...extra,
  });
  const conversions = new Map(), fullOrders = new Map(), listedOrders = [];
  const gaClicks = [], nativeClicks = [], evidence = [], calls = [], writes = [];
  const savedConfig = {};
  for (let i = 0; i < historical; i++) {
    const id = String(1000 + i);
    fullOrders.set(id, orderAt(id, older));
    conversions.set(`1270558:${id}`, {
      orderId: id, orderKey: `1270558:${id}`, clickId: `old-click-${i}`,
      amountCents: 1000, status: "paid", placedAt: older, checkedAt: older,
    });
  }
  const addListed = (order) => {
    fullOrders.set(order.id, order);
    const stub = { ...order };
    delete stub.hour;
    listedOrders.push(stub);
  };
  for (let i = 0; i < ga; i++) {
    const orderId = String(2000 + i);
    const click = {
      id: `89cf5990-82fb-4437-aef9-${String(i + 1).padStart(12, "0")}`,
      linkId: "ga-link", link: { slug: "abcdefgh1234" },
      createdAt: new Date(placedAt.getTime() - 3600000),
    };
    gaClicks.push(click);
    evidence.push({ orderId, clickId: click.id, slug: click.link.slug,
      purchaseMinute: new Date(Math.floor(placedAt.getTime() / 60000) * 60000) });
    addListed(orderAt(orderId, placedAt));
  }
  for (let i = 0; i < native; i++) {
    const session = `store-session-${i}`;
    nativeClicks.push({
      id: `native-click-${i}`, sessionHash: domain.hash(`session:${domain.digest(session)}`),
      createdAt: new Date(placedAt.getTime() - 3600000),
      visitedAt: new Date(placedAt.getTime() - 1800000),
    });
    addListed(orderAt(String(3000 + i), placedAt, { session_id: session }));
  }
  const prisma = {
    $queryRaw: async () => [1, 2, 3].map(() => ({ safe: true })),
    trayConnection: { findFirst: async () => ({ storeId: "1270558" }) },
    telegramGrowthClick: { findMany: async ({ where }) => where.id ? gaClicks : nativeClicks },
    telegramGrowthConversion: {
      findMany: async () => [...conversions.values()].sort((a, b) => a.checkedAt - b.checkedAt),
      upsert: async ({ where, create, update }) => {
        writes.push(where.orderKey);
        const prior = conversions.get(where.orderKey);
        conversions.set(where.orderKey, prior ? { ...prior, ...update } : create);
      },
    },
    telegramGrowthLink: { findMany: async () => [{ userId: "owner" }] },
  };
  const growth = loader({
    "@/lib/prisma": { prisma },
    "@/lib/tray": { trayGet: async (resource) => {
      const id = resource.split("/")[1];
      calls.push(id);
      if (fail.includes(id)) throw new Error("Isolated order read failed");
      if (invalid.includes(id)) return { Order: { ...fullOrders.get(id), id: "other-order" } };
      assert.ok(fullOrders.has(id), "tests never request a live order");
      return { Order: fullOrders.get(id) };
    } },
    "@/lib/traySales": { fetchOrdersSince: async () => ({ orders: listedOrders.map((order) => ({ ...order })), truncated: false }) },
    "./ga-attribution": { ...gaModule, readGaPurchases: async () => ({
      status: "ready", configured: true, connected: true, checkedAt: new Date().toISOString(),
      timeZone: "America/Rio_Branco", partial: false, evidence, linkOnly: 0, invalid: 0,
    }) },
    "./store": { mutate: async (_id, fn) => fn({ parsed: savedConfig }) },
    "./access": {},
  })("src/lib/telegram/growth.ts");
  return { growth, conversions, savedConfig, calls, writes };
}

test("a failed or wrong-identity historical read preserves its conversion and does not block recent paid orders", async () => {
  const fixture = boundedSyncFixture({ historical: 2, native: 1, fail: ["1000"], invalid: ["1001"] });
  const before = structuredClone([...fixture.conversions.entries()]);
  const result = await fixture.growth.syncSales("owner");
  for (const [key, value] of before) assert.deepEqual(fixture.conversions.get(key), value);
  assert.equal(fixture.conversions.get("1270558:3000").status, "paid");
  assert.equal(fixture.conversions.get("1270558:3000").amountCents, 1000);
  assert.deepEqual(fixture.writes, ["1270558:3000"]);
  assert.equal(result.truncated, true);
  assert.equal(fixture.savedConfig.growth.truncated, true);
  assert.ok(fixture.savedConfig.growth.syncedAt);
});

test("forty historical conversions cannot starve new GA and native paid attribution", async () => {
  const fixture = boundedSyncFixture({ historical: 40, ga: 1, native: 1 });
  const result = await fixture.growth.syncSales("owner");
  assert.equal(fixture.conversions.get("1270558:2000").status, "paid");
  assert.equal(fixture.conversions.get("1270558:3000").status, "paid");
  assert.equal(fixture.calls.filter((id) => id.startsWith("1")).length, 20);
  assert.equal(fixture.savedConfig.growth.gaAttribution.matched, 1);
  assert.equal(result.truncated, true, "remaining historical reviews are explicitly partial");
});

test("historical, GA and native detail requests share a strict total budget while each new path can progress", async () => {
  const fixture = boundedSyncFixture({ historical: 50, ga: 30, native: 60 });
  const result = await fixture.growth.syncSales("owner");
  assert.equal(fixture.calls.length, 80);
  assert.equal(new Set(fixture.calls).size, 80, "no order is fetched twice in one sync");
  assert.equal(fixture.calls.filter((id) => id.startsWith("1")).length, 20);
  assert.equal(fixture.calls.filter((id) => id.startsWith("2")).length, 20);
  assert.equal(fixture.calls.filter((id) => id.startsWith("3")).length, 40);
  assert.equal(fixture.writes.filter((key) => key.startsWith("1270558:2")).length, 20);
  assert.equal(fixture.writes.filter((key) => key.startsWith("1270558:3")).length, 40);
  assert.equal(result.truncated, true);
  assert.equal(fixture.savedConfig.growth.truncated, true);
});

test("failed detail attempts count against the same budget and do not abort the rest of the sync", async () => {
  const fail = [
    ...Array.from({ length: 50 }, (_, i) => String(1000 + i)),
    ...Array.from({ length: 30 }, (_, i) => String(2000 + i)),
    ...Array.from({ length: 60 }, (_, i) => String(3000 + i)),
  ];
  const fixture = boundedSyncFixture({ historical: 50, ga: 30, native: 60, fail });
  const result = await fixture.growth.syncSales("owner");
  assert.equal(fixture.calls.length, 80);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.conversions.size, 50, "all existing financial records remain unchanged");
  assert.equal(result.truncated, true);
  assert.ok(fixture.savedConfig.growth.syncedAt);
});
