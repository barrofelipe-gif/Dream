import "server-only";
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { trayGet, getValidAccessToken } from "@/lib/tray";
import { fetchOrdersSince, type TraySaleOrder } from "@/lib/traySales";
import { load, mutate } from "./store";
import { csrf } from "./access";
import { canRestoreTray, googleAnalytics } from "./analytics";
import {
  readGaPurchases,
  reconcileGaPurchases,
  type GaAttributionReport,
} from "./ga-attribution";
import { TelegramError, type Data } from "./domain";
import { verifyStorefrontTracker } from "./tracker-install";
import {
  ATTRIBUTION_DAYS,
  cents,
  day,
  digest,
  hash,
  linkInput,
  orderStatus,
  period,
  summarize,
  validationToken,
} from "./growth-domain";

type GrowthConfig = NonNullable<Data["growth"]>;
let checkedStorage = false;
export async function checkGrowthStorage() {
  if (checkedStorage) return;
  const schema =
    new URL(process.env.DATABASE_URL!).searchParams.get("schema") || "public";
  const rows = await prisma.$queryRaw<
    { name: string; safe: boolean }[]
  >`SELECT c.relname AS name, (c.relrowsecurity AND NOT has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AND NOT has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS safe FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname IN ('TelegramGrowthLink','TelegramGrowthClick','TelegramGrowthConversion')`;
  if (rows.length !== 3 || rows.some((r) => !r.safe))
    throw new TelegramError(
      "storage",
      "O armazenamento das métricas ainda está sendo preparado.",
      0,
      503,
    );
  checkedStorage = true;
}
export async function dashboard(userId: string, input: URLSearchParams) {
  await checkGrowthStorage();
  const days = [7, 30, 90].includes(Number(input.get("days")))
    ? Number(input.get("days"))
    : 30;
  const source = (input.get("source") || "").slice(0, 100);
  const range = period(days);
  const [workspace, links, clicks, sales, connection, lastVisit, lastTest] =
    await Promise.all([
      load(userId),
      prisma.telegramGrowthLink.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
      }),
      prisma.telegramGrowthClick.findMany({
        where: {
          link: { userId },
          NOT: { visitorHash: { startsWith: "test:" } },
          OR: [
            { createdAt: { gte: range.previous } },
            { visitedAt: { gte: range.previous } },
            { conversions: { some: { placedAt: { gte: range.previous } } } },
          ],
        },
        select: {
          id: true,
          linkId: true,
          visitorHash: true,
          createdAt: true,
          visitedAt: true,
        },
      }),
      prisma.telegramGrowthConversion.findMany({
        where: {
          click: {
            link: { userId },
            NOT: { visitorHash: { startsWith: "test:" } },
          },
          placedAt: { gte: range.previous },
        },
        select: {
          clickId: true,
          amountCents: true,
          status: true,
          placedAt: true,
        },
      }),
      prisma.trayConnection.findFirst({ select: { id: true } }),
      prisma.telegramGrowthClick.findFirst({
        where: {
          link: { userId },
          visitedAt: { not: null },
          NOT: { visitorHash: { startsWith: "test:" } },
        },
        orderBy: { visitedAt: "desc" },
        select: { visitedAt: true },
      }),
      prisma.telegramGrowthClick.findFirst({
        where: {
          link: { userId },
          visitorHash: { startsWith: "test:" },
          visitedAt: { not: null },
        },
        orderBy: { visitedAt: "desc" },
        select: { visitedAt: true },
      }),
    ]);
  const config = workspace.parsed.growth || {};
  const testLink = links.find(
    (l) => l.active && (!source || l.sourceName === source),
  );
  const analytics = await googleAnalytics(
    days,
    source
      ? links.filter((l) => l.sourceName === source).map((l) => l.slug)
      : undefined,
    input.get("fresh") === "1",
  );
  return {
    ...summarize(links, clicks, sales, workspace.parsed, days, source),
    csrf: csrf(userId),
    analytics,
    connection: workspace.authState,
    updatedAt: new Date().toISOString(),
    tracking: {
      links: links.length,
      installed: !!config.installedAt,
      lastVisit: lastVisit?.visitedAt?.toISOString() || null,
      lastTestAt: lastTest?.visitedAt?.toISOString() || null,
      testUrl: testLink
        ? `/t/${testLink.slug}?bff_test=${validationToken(testLink.slug)}`
        : null,
      trayConnected: !!connection,
      canRestoreTray: canRestoreTray(),
      syncedAt: config.syncedAt || null,
      truncated: config.truncated || false,
      attributionDays: ATTRIBUTION_DAYS,
      gaAttribution: config.gaAttribution || null,
    },
    prospects: workspace.parsed.prospects || [],
  };
}
export async function createLink(
  userId: string,
  input: Record<string, unknown>,
) {
  const data = linkInput(input);
  await checkGrowthStorage();
  await load(userId);
  return prisma.telegramGrowthLink.create({
    data: { ...data, userId, slug: randomBytes(9).toString("base64url") },
  });
}
export async function toggleLink(
  userId: string,
  input: Record<string, unknown>,
) {
  if (typeof input.id !== "string" || typeof input.active !== "boolean")
    throw new TelegramError("input", "Link inválido.");
  const result = await prisma.telegramGrowthLink.updateMany({
    where: { id: input.id, userId },
    data: { active: input.active },
  });
  if (!result.count)
    throw new TelegramError("input", "Link não encontrado.", 0, 404);
  return { ok: true };
}
type Scripts = {
  paging?: { total: number };
  ExternalScripts?: { ExternalScript: { id: string; source: string } }[];
};
export async function installTracker(userId: string, origin: string) {
  await checkGrowthStorage();
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "app.bfffitnessatacado.com.br"
  )
    throw new TelegramError(
      "config",
      "Instale o rastreamento pelo endereço oficial do app BFF.",
    );
  const source = `${url.origin}/api/telegram-growth/tracker.js`;
  const proof = await verifyStorefrontTracker();
  const found =
    proof.installed ||
    (await prisma.$transaction(
      async (tx) => {
        const [lock] = await tx.$queryRaw<
          { locked: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(760311341) AS locked`;
        if (!lock?.locked)
          throw new TelegramError(
            "busy",
            "A instalação já está em andamento. Aguarde alguns segundos.",
            0,
            409,
          );
        return ensureTracker(source);
      },
      { timeout: 45000, maxWait: 5000 },
    ));
  await mutate(userId, (row) => {
    row.parsed.growth = {
      ...row.parsed.growth,
      installedAt: new Date().toISOString(),
    };
  });
  return { ok: true, alreadyInstalled: found };
}
async function ensureTracker(source: string) {
  // A API lista somente scripts deste aplicativo. Nenhuma outra tag é alterada.
  let found = false;
  for (let page = 1; page <= 10; page++) {
    const list = await trayGet<Scripts>("external_scripts", {
      limit: "50",
      page: String(page),
    });
    const batch = list.ExternalScripts || [];
    if (batch.some((s) => s.ExternalScript.source === source)) {
      found = true;
      break;
    }
    if (batch.length < 50) break;
    if (page === 10)
      throw new TelegramError(
        "tray",
        "Não foi possível conferir todos os scripts da loja. Tente novamente.",
        0,
        502,
      );
  }
  if (!found) {
    const { apiAddress, accessToken } = await getValidAccessToken();
    const endpoint = new URL(`${apiAddress}/external_scripts/`);
    endpoint.searchParams.set("access_token", accessToken);
    const result = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ExternalScript: { source } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!result.ok)
      throw new TelegramError(
        "tray",
        "A Tray não permitiu instalar o rastreador. A conexão precisa ter acesso a scripts externos.",
        0,
        502,
      );
    const created = (await result.json()) as { id?: string; code?: number };
    if (!created.id || Number(created.code) !== 201)
      throw new TelegramError(
        "tray",
        "A Tray não confirmou a instalação. Confira a conexão e tente novamente.",
        0,
        502,
      );
  }
  return found;
}
type AttributedOrder = TraySaleOrder & {
  session_id?: string;
  hour?: string;
  has_payment?: string | number;
};
export async function syncSales(userId?: string) {
  await checkGrowthStorage();
  const since = new Date(Date.now() - ATTRIBUTION_DAYS * 86400000);
  const connection = await prisma.trayConnection.findFirst({
    select: { storeId: true },
    orderBy: { createdAt: "desc" },
  });
  if (!connection?.storeId)
    throw new TelegramError(
      "tray",
      "Conecte a loja Tray para confirmar as vendas.",
      0,
      409,
    );
  // Esta propriedade Google pertence à BFF, não a qualquer loja que venha a
  // ser conectada no futuro pelo OAuth da empresa.
  const ga: GaAttributionReport =
    connection.storeId === "1270558"
      ? await readGaPurchases(ATTRIBUTION_DAYS)
      : {
          status: process.env.BFF_GA_SERVICE_ACCOUNT_JSON
            ? "unavailable"
            : "unconfigured",
          configured: !!process.env.BFF_GA_SERVICE_ACCOUNT_JSON,
          connected: false,
          checkedAt: new Date().toISOString(),
          timeZone: null,
          partial: false,
          evidence: [],
          linkOnly: 0,
          invalid: 0,
        };
  const gaMeta: NonNullable<GrowthConfig["gaAttribution"]> = {
    status: ga.status,
    checkedAt: ga.checkedAt,
    timeZone: ga.timeZone,
    partial: ga.partial,
    matched: 0,
    ambiguous: 0,
    unmatched: 0,
    linkOnly: ga.linkOnly,
    invalid: ga.invalid,
  };
  const gaIds = [
    ...new Set(ga.evidence.flatMap((e) => (e.clickId ? [e.clickId] : []))),
  ];
  const gaClicks = gaIds.length
    ? (
        await prisma.telegramGrowthClick.findMany({
          where: {
            id: { in: gaIds },
            NOT: { visitorHash: { startsWith: "test:" } },
          },
          select: {
            id: true,
            linkId: true,
            createdAt: true,
            link: { select: { slug: true } },
          },
        })
      ).map((c) => ({
        id: c.id,
        linkId: c.linkId,
        createdAt: c.createdAt,
        slug: c.link.slug,
      }))
    : [];
  // A Tray é da empresa. Atribuição precisa comparar todos os operadores,
  // inclusive em sincronização manual, para preservar o último clique global.
  const scope = {};
  // Pedidos dos últimos 30 dias podem vir de um clique até 30 dias ANTES deles;
  // 60 dias de cliques são necessários para não perder pagamentos recentes.
  const eligible = await prisma.telegramGrowthClick.findMany({
    where: {
      link: scope,
      NOT: { visitorHash: { startsWith: "test:" } },
      sessionHash: { not: null },
      visitedAt: { not: null },
      createdAt: {
        gte: new Date(since.getTime() - ATTRIBUTION_DAYS * 86400000),
      },
    },
    select: { id: true, sessionHash: true, createdAt: true, visitedAt: true },
    orderBy: { createdAt: "desc" },
  });
  const existing = await prisma.telegramGrowthConversion.findMany({
    where: {
      click: { link: scope, NOT: { visitorHash: { startsWith: "test:" } } },
    },
    select: { orderId: true, orderKey: true, clickId: true, placedAt: true },
    orderBy: { checkedAt: "asc" },
  });
  if (!eligible.length && !existing.length && !gaClicks.length) {
    await saveSyncForOwners(userId, {
      syncedAt: new Date().toISOString(),
      truncated: ga.partial,
      checked: 0,
      gaAttribution: gaMeta,
    });
    return { matched: 0, checked: 0, truncated: ga.partial };
  }
  const list = await fetchOrdersSince(day(since), 1000);
  const orders = list.orders as AttributedOrder[];
  const storePrefix = `${connection.storeId}:`;
  const saved = existing.filter((s) => s.orderKey.startsWith(storePrefix));
  const priorOrders = new Map(saved.map((s) => [s.orderId, s]));
  const seen = new Set(orders.map((o) => String(o.id)));
  const missing = saved.filter((s) => !seen.has(s.orderId));
  let checked = 0,
    matched = 0,
    detailReads = 0,
    partial = false;
  const hashes = new Set(eligible.map((c) => c.sessionHash));
  // Revalida pedidos já atribuídos, inclusive cancelamentos posteriores ao período.
  // A leitura é limitada e a cobertura parcial aparece no dashboard.
  for (const item of missing.slice(0, 40)) {
    const result = await trayGet<{ Order: AttributedOrder }>(
      `orders/${encodeURIComponent(item.orderId)}`,
    );
    detailReads++;
    orders.push(result.Order);
  }
  const knownClicks = new Set(gaClicks.map((c) => c.id));
  const gaOrderIds = [
    ...new Set(
      ga.evidence
        .filter((e) => e.clickId && knownClicks.has(e.clickId))
        .map((e) => e.orderId),
    ),
  ];
  // Um evento Google só pode virar venda depois de conferir o pedido real.
  // Nunca cria conversão por proximidade de datas, valor ou clique aleatório.
  for (const orderId of gaOrderIds) {
    // Os já atribuídos são revisados pelo lote priorizado por checkedAt;
    // repetir os primeiros IDs Google consumiria o orçamento indefinidamente.
    if (priorOrders.has(orderId)) continue;
    const index = orders.findIndex((o) => String(o.id) === orderId);
    if (index >= 0 && orders[index].hour) continue;
    if (detailReads >= 40) {
      partial = true;
      break;
    }
    detailReads++;
    try {
      const full = await trayGet<{ Order: AttributedOrder }>(
        `orders/${encodeURIComponent(orderId)}`,
      );
      if (String(full.Order?.id) !== orderId) {
        partial = true;
        continue;
      }
      if (index >= 0) orders[index] = full.Order;
      else orders.push(full.Order);
    } catch {
      partial = true;
    }
  }
  const gaReconciled = reconcileGaPurchases(ga.evidence, gaClicks, orders);
  gaMeta.ambiguous = gaReconciled.ambiguous;
  gaMeta.unmatched = gaReconciled.unmatched;
  const gaByOrder = new Map(
    gaReconciled.conversions.map((c) => [c.orderId, c]),
  );
  for (let order of orders) {
    const prior = priorOrders.get(String(order.id));
    const sessionHash = order.session_id
      ? hash(`session:${digest(order.session_id)}`)
      : null;
    const gaMatch = gaByOrder.get(String(order.id));
    if (!prior && !gaMatch && (!sessionHash || !hashes.has(sessionHash)))
      continue;
    checked++;
    if (!prior && !order.hour) {
      if (detailReads >= 80) {
        partial = true;
        continue;
      }
      order = (
        await trayGet<{ Order: AttributedOrder }>(
          `orders/${encodeURIComponent(order.id)}`,
        )
      ).Order;
      detailReads++;
    }
    if (
      !prior &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(order.date) ||
        !/^\d{2}:\d{2}:\d{2}$/.test(order.hour || ""))
    ) {
      partial = true;
      continue;
    }
    const placedAt =
      prior?.placedAt || new Date(`${order.date}T${order.hour}-03:00`);
    if (!Number.isFinite(placedAt.getTime())) continue;
    const match = prior
      ? { id: prior.clickId }
      : eligible.find(
          (c) =>
            c.sessionHash === sessionHash &&
            c.createdAt <= placedAt &&
            c.visitedAt! <= placedAt &&
            placedAt.getTime() - c.createdAt.getTime() <=
              ATTRIBUTION_DAYS * 86400000,
        ) || (gaMatch ? { id: gaMatch.clickId } : undefined);
    if (!match) continue;
    const record = {
      amountCents: cents(order.total),
      status: orderStatus(order),
      placedAt,
      checkedAt: new Date(),
    };
    await prisma.telegramGrowthConversion.upsert({
      where: { orderKey: `${storePrefix}${order.id}` },
      create: {
        orderKey: `${storePrefix}${order.id}`,
        orderId: String(order.id),
        clickId: match.id,
        ...record,
      },
      update: record,
    });
    if (gaMatch?.clickId === match.id) gaMeta.matched++;
    matched++;
  }
  const truncated =
    list.truncated || missing.length > 40 || partial || ga.partial;
  const config: GrowthConfig = {
    syncedAt: new Date().toISOString(),
    truncated,
    checked,
    gaAttribution: gaMeta,
  };
  await saveSyncForOwners(userId, config);
  return { matched, checked, truncated };
}
async function saveSyncForOwners(
  userId: string | undefined,
  config: GrowthConfig,
) {
  const owners = [
    ...new Set([
      ...(userId ? [userId] : []),
      ...(
        await prisma.telegramGrowthLink.findMany({
          select: { userId: true },
          distinct: ["userId"],
        })
      ).map((l) => l.userId),
    ]),
  ];
  for (const owner of owners) await saveSync(owner, config);
}
async function saveSync(userId: string, config: GrowthConfig) {
  await mutate(userId, (row) => {
    row.parsed.growth = { ...row.parsed.growth, ...config };
  });
}
