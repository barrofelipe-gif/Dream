import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createHash } from "node:crypto";
import {
  buildOfficialInsights,
  officialPeriod,
  OrbitaInsightsError,
  selectOfficialAccount,
  usernameOf,
  type StoredAccountDay,
  type StoredPost,
} from "../src/lib/orbita-insights";

const now = new Date("2026-11-03T15:00:00Z"),
  account = { id: "account-a", username: "qa.test", loja: "moranga" };
const value = (name: string, n: unknown) => ({
  name,
  period: "day",
  total_value: { value: n },
});
const day = (
  date: string,
  items: unknown[],
  at = "2026-11-03T12:00:00Z",
): StoredAccountDay => ({
  contaId: account.id,
  data: date,
  bruto: JSON.stringify(items),
  coletadoEm: at,
});
const post = (
  metrics: unknown[],
  more: Partial<StoredPost> = {},
): StoredPost => ({
  contaId: account.id,
  externoId: "post-1",
  tipo: "reel",
  legenda: "QA publicação",
  permalink: "https://www.instagram.com/reel/qa123/?tracking=discarded",
  publicadoEm: "2026-11-02T15:00:00Z",
  bruto: JSON.stringify({ midia: { id: "post-1" }, insights: metrics }),
  coletadoEm: "2026-11-03T10:00:00Z",
  ...more,
});
const result = (
  days: StoredAccountDay[] = [],
  posts: StoredPost[] = [],
  start = "2026-11-01",
  end = "2026-11-02",
) =>
  buildOfficialInsights({
    account,
    username: "qa.test",
    start,
    end,
    days,
    posts,
    now,
  });

test("datas são reais, encerradas no calendário de Brasília e limitadas a 90 dias", () => {
  assert.equal(officialPeriod("2026-11-01", "2026-11-02", now).days, 2);
  for (const dates of [
    ["2026-02-30", "2026-03-01"],
    ["2026-11-02", "2026-11-01"],
    ["2026-08-01", "2026-11-02"],
    ["2026-11-03", "2026-11-03"],
  ])
    assert.throws(
      () => officialPeriod(dates[0], dates[1], now),
      OrbitaInsightsError,
    );
  // At 02:00 UTC, the current day in Brasília is still November 2.
  assert.throws(() =>
    officialPeriod(
      "2026-11-01",
      "2026-11-02",
      new Date("2026-11-03T02:00:00Z"),
    ),
  );
});
test("@ estrito e cadastro autoritativo impedem inferência de loja ou conta por nome", () => {
  assert.equal(usernameOf(" @QA.Test "), "qa.test");
  assert.equal(usernameOf("_qa_test_"), "_qa_test_");
  for (const input of [
    "https://instagram.com/qa.test",
    "qa test",
    "a/b",
    "a..b",
    "a".repeat(31),
    null,
  ])
    assert.throws(() => usernameOf(input));
  assert.equal(
    selectOfficialAccount([{ ...account, username: "bff.test" }], "bff.test")
      .loja,
    "moranga",
  );
  const both = [account, { ...account, id: "account-b", loja: "bff" }];
  assert.throws(
    () => selectOfficialAccount(both, "qa.test"),
    (e: unknown) => e instanceof OrbitaInsightsError && e.status === 409,
  );
  assert.equal(selectOfficialAccount(both, "qa.test", "account-b").loja, "bff");
  assert.throws(() => selectOfficialAccount(both, "another", "account-b"));
});
test("somente métricas brutas presentes em todos os dias são agregadas; únicos não são somados", () => {
  const out = result([
    day("2026-11-01", [
      value("views", 10),
      value("reach", 100),
      value("likes", 0),
      value("accounts_engaged", 40),
    ]),
    day("2026-11-02", [
      value("views", 20),
      value("reach", 100),
      value("likes", 2),
      value("accounts_engaged", 50),
    ]),
  ]);
  assert.equal(out.reports.length, 1);
  assert.deepEqual(out.reports[0].metrics, { views: 30, likes: 2 });
  assert.equal(out.reports[0].contentWindow, "period");
  assert.equal(out.reports[0].coverage, "unknown");
  assert.equal(out.source.loja, "moranga");
  assert.match(out.warnings.join(" "), /não foram somados/);
});
test("alcance e contas engajadas explícitos funcionam para um dia, inclusive zero", () => {
  const out = result(
    [day("2026-11-02", [value("reach", 0), value("accounts_engaged", 3)])],
    [],
    "2026-11-02",
  );
  assert.deepEqual(out.reports[0].metrics, { reach: 0, accounts_engaged: 3 });
});
test("zeros de colunas derivadas, JSON vazio, métricas ausentes e dias faltantes não viram valores", () => {
  const legacy = {
    ...day("2026-11-01", []),
    alcance: 0,
    interacoes: 0,
    bruto: "{}",
  };
  assert.equal(result([legacy]).reports.length, 0);
  const out = result([
    day("2026-11-01", [value("views", 10), value("likes", 4)]),
    day("2026-11-02", [value("views", 20)]),
  ]);
  assert.deepEqual(out.reports[0].metrics, { views: 30 });
  const partial = result([day("2026-11-01", [value("views", 10)])]);
  assert.equal(partial.reports.length, 0);
  assert.equal(partial.source.daysAvailable, 1);
  assert.match(partial.warnings.join(" "), /1 de 2/);
});
test("métrica duplicada, inválida ou com período incompatible fica ausente", () => {
  const out = result(
    [
      day("2026-11-02", [
        value("views", 10),
        value("views", 20),
        value("likes", -1),
        value("comments", "12"),
        { name: "reach", period: "lifetime", total_value: { value: 400 } },
        value("shares", 0),
      ]),
    ],
    [],
    "2026-11-02",
  );
  assert.deepEqual(out.reports[0].metrics, { shares: 0 });
});
test("revisões do mesmo dia não duplicam valores", () => {
  const old = day("2026-11-01", [value("views", 10)], "2026-11-02T10:00:00Z"),
    latest = day("2026-11-01", [value("views", 11)], "2026-11-03T10:00:00Z");
  assert.deepEqual(
    result([old, latest, day("2026-11-02", [value("views", 20)])]).reports[0]
      .metrics,
    { views: 31 },
  );
});
test("mídias mantêm lifetime, milissegundos são convertidos e nenhum total de publicações é inventado", () => {
  const out = result(
    [],
    [
      post([
        value("reach", 50),
        value("views", 80),
        value("ig_reels_avg_watch_time", 1234.5),
        value("ig_reels_video_view_total_time", 5000),
      ]),
    ],
  );
  const r = out.reports[0];
  assert.equal(r.contentWindow, "lifetime");
  assert.deepEqual(r.metrics, {});
  assert.equal(r.content[0].metrics.avg_watch_time_seconds, 1.2345);
  assert.equal(r.content[0].metrics.watch_time_seconds, 5);
  assert.equal(r.content[0].metrics.follows, undefined);
  assert.equal(r.content[0].url, "https://www.instagram.com/reel/qa123/");
});
test("likes/comments do payload oficial são aceitos; identificação de mídia divergente é recusada", () => {
  const p = post([], {
    bruto: JSON.stringify({
      midia: { id: "post-1", like_count: 0, comments_count: 2 },
      insights: [],
    }),
  });
  assert.deepEqual(result([], [p]).reports[0].content[0].metrics, {
    likes: 0,
    comments: 2,
  });
  assert.equal(
    result(
      [],
      [
        post([value("views", 10)], {
          bruto: JSON.stringify({
            midia: { id: "another" },
            insights: [value("views", 10)],
          }),
        }),
      ],
    ).reports.length,
    0,
  );
});
test("conta da linha é conferida e publicação é filtrada pelo calendário de Brasília", () => {
  assert.throws(
    () =>
      result([
        { ...day("2026-11-01", [value("views", 1)]), contaId: "another" },
      ]),
    /outra conta/,
  );
  assert.throws(
    () => result([], [{ ...post([value("views", 1)]), contaId: "another" }]),
    /outra conta/,
  );
  assert.equal(
    result(
      [],
      [post([value("views", 1)], { publicadoEm: "2026-11-02T02:59:59Z" })],
      "2026-11-02",
    ).reports.length,
    0,
  );
  assert.equal(
    result(
      [],
      [post([value("views", 1)], { publicadoEm: "2026-11-02T03:00:00Z" })],
      "2026-11-02",
    ).reports.length,
    1,
  );
});
test("a data da coleta da mídia não é renovada pela coleta mais recente da conta", () => {
  const out = result(
    [day("2026-11-02", [value("views", 10)], "2026-11-03T12:00:00Z")],
    [post([value("views", 1)])],
    "2026-11-02",
  );
  assert.equal(
    out.reports.find((r) => r.contentWindow === "lifetime")?.recordedAt,
    "2026-11-03T10:00:00.000Z",
  );
  assert.equal(out.source.lastCollectedAt, "2026-11-03T12:00:00.000Z");
});

test("a nota preserva o timestamp de cada coleta sem ultrapassar 500 caracteres", () => {
  const out = buildOfficialInsights({
    account: { ...account, loja: "L".repeat(1000) },
    username: "qa.test",
    start: "2026-11-02",
    end: "2026-11-02",
    days: [day("2026-11-02", [value("views", 1)])],
    posts: [post([value("views", 2)])],
    now,
  });
  for (const report of out.reports) {
    assert.ok(report.note.length <= 500);
    assert.ok(report.note.includes(report.recordedAt));
  }
});

test("rota exige admin antes do banco, não seleciona tokens e escopa conta e erros ao usuário", async () => {
  type State = {
    session: unknown;
    accounts: unknown[];
    days: unknown[];
    posts: unknown[];
    calls: { table: string; query: unknown }[];
    fail?: boolean;
  };
  const key = Symbol.for("orbita-insights-route-tests");
  const holder = globalThis as unknown as Record<symbol, State>;
  const state: State = {
    session: null,
    accounts: [],
    days: [],
    posts: [],
    calls: [],
  };
  holder[key] = state;
  const bundled = await build({
    entryPoints: ["src/app/api/growth/orbita/insights/route.ts"],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    target: "node24",
    plugins: [
      {
        name: "isolated-server-fixtures",
        setup(b) {
          b.onResolve({ filter: /^@\/auth$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^@\/lib\/prisma$/ }, () => ({
            path: "prisma",
            namespace: "fixture",
          }));
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "js",
            contents:
              args.path === "auth"
                ? 'export async function auth(){return globalThis[Symbol.for("orbita-insights-route-tests")].session;}'
                : 'const s=()=>globalThis[Symbol.for("orbita-insights-route-tests")];function table(name,field){return {async findMany(query){s().calls.push({table:name,query});if(s().fail)throw Error("SECRET_TEST_SQL_MUST_NOT_LEAK");return s()[field]}}}export const prisma={socialConta:table("accounts","accounts"),socialMetricaConta:table("days","days"),socialMetricaPost:table("posts","posts")};',
          }));
        },
      },
    ],
  });
  const route = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`
  );
  const request = () =>
    new Request(
      "https://app.example/api/growth/orbita/insights?username=qa.test&start=2020-01-01&end=2020-01-02",
    );
  try {
    assert.equal((await route.GET(request())).status, 401);
    assert.equal(state.calls.length, 0);
    state.session = { user: { id: "admin-test", role: "member" } };
    assert.equal((await route.GET(request())).status, 403);
    assert.equal(state.calls.length, 0);
    state.session = { user: { id: "admin-test", role: "admin" } };
    const scope = createHash("sha256")
      .update("admin-test")
      .digest("hex")
      .slice(0, 32);
    let r = await route.GET(
      new Request("https://app.example/api/growth/orbita/insights"),
    );
    assert.equal(r.status, 400);
    assert.equal((await r.json()).userScope, scope);
    assert.equal(state.calls.length, 0);
    state.accounts = [account, { ...account, id: "account-b", loja: "bff" }];
    r = await route.GET(request());
    assert.equal(r.status, 409);
    const ambiguous = await r.json();
    assert.equal(ambiguous.userScope, scope);
    assert.equal(ambiguous.accounts.length, 2);
    assert.equal(state.calls.length, 1);
    state.calls = [];
    state.accounts = [account];
    state.days = [
      day("2020-01-01", [value("views", 2)]),
      day("2020-01-02", [value("views", 3)]),
    ];
    r = await route.GET(request());
    assert.equal(r.status, 200);
    const data = await r.json();
    assert.equal(data.userScope, scope);
    assert.equal(data.reports[0].metrics.views, 5);
    assert.equal(data.source.readOnly, true);
    assert.equal(
      r.headers.get("cache-control"),
      "private, no-store, max-age=0",
    );
    assert.equal(JSON.stringify(state.calls).includes("accessToken"), false);
    assert.equal(JSON.stringify(data).includes("bruto"), false);
    for (const call of state.calls.filter((c) => c.table !== "accounts"))
      assert.equal(
        (call.query as { where: { contaId: string } }).where.contaId,
        "account-a",
      );
    state.calls = [];
    r = await route.GET(new Request(request().url + "&accountId=unrelated"));
    assert.equal(r.status, 404);
    assert.equal(state.calls.length, 1);
    assert.equal((await r.json()).userScope, scope);
    state.fail = true;
    r = await route.GET(request());
    assert.equal(r.status, 503);
    const failure = await r.json();
    assert.equal(failure.userScope, scope);
    assert.equal(JSON.stringify(failure).includes("SECRET_TEST_SQL"), false);
  } finally {
    delete holder[key];
  }
});
