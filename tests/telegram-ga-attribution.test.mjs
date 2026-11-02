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
    const module = { exports: {} };
    cache.set(file, module);
    const code = transformSync(readFileSync(file, "utf8"), {
      loader: "ts",
      format: "cjs",
      target: "node20",
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
    new Function("require", "module", "exports", code)(
      require,
      module,
      module.exports,
    );
    return module.exports;
  }
  return load;
}
process.env.AUTH_SECRET = "local-only-ga-attribution-test";
const load = loader({ googleapis: { google: {} } });
const attribution = load("src/lib/telegram/ga-attribution.ts");
const { signClick } = load("src/lib/telegram/growth-domain.ts");
const clickId = "89cf5990-82fb-4437-aef9-2f6add0220dc";
const secondId = "a2141480-77fa-4be5-8887-44ee37a0ff6b";
const slug = "EnlNTArrsAbq";
const otherSlug = "another12345";
function report(rows) {
  return {
    dimensionHeaders: [
      "transactionId",
      "landingPagePlusQueryString",
      "sessionManualAdContent",
      "dateHourMinute",
    ].map((name) => ({ name })),
    metricHeaders: [{ name: "ecommercePurchases" }],
    rows,
    rowCount: rows.length,
    metadata: { timeZone: "America/Rio_Branco" },
  };
}
function row(values = {}) {
  const landing =
    values.landing ??
    `/?utm_source=telegram&utm_content=${slug}&bff_tg=${signClick(clickId)}`;
  return {
    dimensionValues: [
      values.transactionId ?? "T_12345",
      landing,
      values.adContent ?? slug,
      values.minute ?? "202611021430",
    ].map((value) => ({ value })),
    metricValues: [{ value: values.purchases ?? "1" }],
  };
}

test("GA4 request is restricted to the BFF property context, Telegram sources and purchase events", () => {
  const request = attribution.gaPurchaseRequest(30);
  assert.equal(request.dateRanges[0].startDate, "30daysAgo");
  assert.equal(request.dateRanges[0].endDate, "today");
  assert.deepEqual(
    request.dimensions.map((d) => d.name),
    [
      "transactionId",
      "landingPagePlusQueryString",
      "sessionManualAdContent",
      "dateHourMinute",
    ],
  );
  const filters = request.dimensionFilter.andGroup.expressions.map(
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
  assert.equal(request.metricFilter.filter.fieldName, "ecommercePurchases");
  assert.throws(() => attribution.gaPurchaseRequest(0));
  assert.throws(() => attribution.gaPurchaseRequest(1000));
});

test("GA minute respects the actual Rio Branco property timezone and rejects ambiguous or invalid local times", () => {
  assert.equal(
    attribution.gaMinute("202611021430", "America/Rio_Branco").toISOString(),
    "2026-11-02T19:30:00.000Z",
  );
  assert.equal(
    attribution.gaMinute("202611021430", "America/Sao_Paulo").toISOString(),
    "2026-11-02T17:30:00.000Z",
  );
  assert.equal(
    attribution.gaMinute("202602300100", "America/Rio_Branco"),
    null,
  );
  assert.equal(attribution.gaMinute("202611010130", "America/New_York"), null); // DST repeated minute
  assert.equal(attribution.gaMinute("202603080230", "America/New_York"), null); // DST missing minute
  assert.equal(
    attribution.gaMinute("202611021461", "America/Rio_Branco"),
    null,
  );
  assert.equal(attribution.gaMinute("202611021430", "Invalid/Zone"), null);
});

test("transaction normalization uses only the BFF T_<Tray ID> format verified against real orders", () => {
  assert.equal(attribution.transactionOrderId("T_12345"), "12345");
  for (const value of [
    "12345",
    "T_0012345",
    "payment_12345",
    "prefixT_12345",
    "T_12345-extra",
    "T_-12",
    "T_0",
  ])
    assert.equal(attribution.transactionOrderId(value), null);
});

test("report parser returns signed click evidence without exposing the landing URL or signature", () => {
  const result = attribution.parseGaPurchases(report([row()]));
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].orderId, "12345");
  assert.equal(result.evidence[0].clickId, clickId);
  assert.equal(result.evidence[0].slug, slug);
  assert.equal(
    result.evidence[0].purchaseMinute.toISOString(),
    "2026-11-02T19:30:00.000Z",
  );
  assert.equal(result.timeZone, "America/Rio_Branco");
  assert.equal(result.partial, false);
  assert.ok(!JSON.stringify(result).includes("bff_tg"));
  assert.ok(!JSON.stringify(result).includes(signClick(clickId)));
});

test("missing nonce remains link-only; forged, contradictory, duplicated and cross-host parameters are rejected", () => {
  const result = attribution.parseGaPurchases(
    report([
      row({ landing: `/?utm_source=telegram&utm_content=${slug}` }),
      row({
        landing: `/?utm_content=${slug}&bff_tg=${signClick(clickId).slice(0, -1)}z`,
      }),
      row({ adContent: otherSlug }),
      row({
        landing: `/?utm_content=${slug}&bff_tg=${signClick(clickId)}&bff_tg=${signClick(secondId)}`,
      }),
      row({
        landing: `//evil.example/?utm_content=${slug}&bff_tg=${signClick(clickId)}`,
      }),
      row({ transactionId: "other_12345" }),
    ]),
  );
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].clickId, null);
  assert.equal(result.linkOnly, 1);
  assert.equal(result.invalid, 5);
  assert.equal(
    attribution.reconcileGaPurchases(result.evidence, [], []).conversions
      .length,
    0,
  );
});

test("thresholds, sampling and truncated report coverage are explicit and an empty successful report stays empty", () => {
  const empty = attribution.parseGaPurchases(report([]));
  assert.equal(empty.evidence.length, 0);
  assert.equal(empty.partial, false);
  assert.equal(
    attribution.parseGaPurchases({ ...report([row()]), rowCount: 50 }).partial,
    true,
  );
  assert.equal(
    attribution.parseGaPurchases({
      ...report([row()]),
      metadata: { timeZone: "America/Rio_Branco", subjectToThresholding: true },
    }).partial,
    true,
  );
  assert.throws(() => attribution.parseGaPurchases({ rows: [] }));
});

function fixture() {
  const evidence = attribution.parseGaPurchases(report([row()])).evidence;
  const clicks = [
    {
      id: clickId,
      linkId: "link",
      slug,
      createdAt: new Date("2026-11-02T18:30:00Z"),
      visitedAt: null,
    },
  ];
  const orders = [
    {
      id: "12345",
      date: "2026-11-02",
      hour: "16:30:20",
      total: "150.99",
      has_payment: "1",
      status: "FINALIZADO",
    },
  ];
  return { evidence, clicks, orders, now: new Date("2026-11-02T20:00:00Z") };
}
test("financial reconciliation uses real Tray payment, amount and timestamp, deduplicates repeated evidence, and never synthesizes a visit", () => {
  const { evidence, clicks, orders, now } = fixture();
  const result = attribution.reconcileGaPurchases(
    [...evidence, ...evidence],
    clicks,
    orders,
    now,
  );
  assert.equal(result.conversions.length, 1);
  const conversion = result.conversions[0];
  assert.equal(conversion.clickId, clickId);
  assert.equal(conversion.amountCents, 15099);
  assert.equal(conversion.status, "paid");
  assert.equal(conversion.placedAt.toISOString(), "2026-11-02T19:30:20.000Z");
  assert.equal(clicks[0].visitedAt, null);
  assert.ok(!("visitedAt" in conversion));
  assert.equal(
    attribution.reconcileGaPurchases(
      evidence,
      clicks,
      [{ ...orders[0], has_payment: "0" }],
      now,
    ).conversions[0].status,
    "pending",
  );
  assert.equal(
    attribution.reconcileGaPurchases(
      evidence,
      clicks,
      [{ ...orders[0], status: "CANCELADO" }],
      now,
    ).conversions[0].status,
    "cancelled",
  );
});

test("a conflicting signed click, link, order timestamp or attribution window never becomes a paid conversion", () => {
  const { evidence, clicks, orders, now } = fixture();
  const conflict = attribution.reconcileGaPurchases(
    [...evidence, { ...evidence[0], clickId: secondId }],
    [...clicks, { ...clicks[0], id: secondId }],
    orders,
    now,
  );
  assert.equal(conflict.conversions.length, 0);
  assert.equal(conflict.ambiguous, 1);
  for (const badClicks of [
    [],
    [{ ...clicks[0], slug: otherSlug }],
    [{ ...clicks[0], createdAt: new Date("2026-11-02T19:31:00Z") }],
    [{ ...clicks[0], createdAt: new Date("2026-09-01T18:30:00Z") }],
  ])
    assert.equal(
      attribution.reconcileGaPurchases(evidence, badClicks, orders, now)
        .conversions.length,
      0,
    );
  assert.equal(
    attribution.reconcileGaPurchases(
      evidence,
      clicks,
      [{ ...orders[0], hour: "10:00:00" }],
      now,
    ).conversions.length,
    0,
  );
  assert.equal(
    attribution.reconcileGaPurchases(
      evidence,
      clicks,
      [{ ...orders[0], date: "2026-11-30" }],
      now,
    ).conversions.length,
    0,
  );
  assert.equal(
    attribution.reconcileGaPurchases(
      evidence,
      clicks,
      [{ ...orders[0], total: "invalid" }],
      now,
    ).conversions.length,
    0,
  );
});

test("GA4 client is read-only and errors do not expose secret credentials", async () => {
  let fail = false;
  process.env.BFF_GA_SERVICE_ACCOUNT_JSON = JSON.stringify({
    type: "service_account",
    client_email: "test@example.invalid",
    private_key: "never-output-this-key",
  });
  const api = loader({
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
                  assert.match(options.url, /properties\/419011003:runReport$/);
                  if (fail) throw Error("never-output-this-key");
                  return { data: report([]) };
                },
              };
            }
          },
        },
      },
    },
  })("src/lib/telegram/ga-attribution.ts");
  try {
    const ready = await api.readGaPurchases(30);
    assert.equal(ready.status, "ready");
    assert.equal(ready.connected, true);
    assert.equal(ready.evidence.length, 0);
    fail = true;
    const error = await api.readGaPurchases(30);
    assert.equal(error.status, "unavailable");
    assert.equal(error.connected, false);
    assert.ok(error.error);
    assert.ok(!JSON.stringify(error).includes("never-output-this-key"));
  } finally {
    delete process.env.BFF_GA_SERVICE_ACCOUNT_JSON;
  }
  assert.equal((await api.readGaPurchases(30)).status, "unconfigured");
});
