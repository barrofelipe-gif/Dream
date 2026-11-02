import "server-only";
import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { encrypt } from "@/lib/crypto";
import { TelegramError } from "./domain";
import { day, period } from "./growth-domain";

const PROPERTY = "419011003";
const HOSTS = ["www.bfffitnessatacado.com.br", "bfffitnessatacado.com.br"];
const TELEGRAM = [
  "telegram",
  "t.me",
  "telegram.me",
  "web.telegram.org",
  "telegram.org",
];
export type Analytics = {
  connected: boolean;
  configured: boolean;
  propertyId: string;
  checkedAt: string;
  timeZone: string | null;
  from: string;
  to: string;
  sessions: number;
  purchases: number;
  revenue: number;
  partial: boolean;
  error?: string;
  daily: {
    day: string;
    sessions: number;
    purchases: number;
    revenue: number;
  }[];
};
type Report = {
  dimensionHeaders?: { name?: string }[];
  metricHeaders?: { name?: string }[];
  rows?: {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[];
  rowCount?: number;
  metadata?: {
    timeZone?: string;
    currencyCode?: string;
    subjectToThresholding?: boolean;
    dataLossFromOtherRow?: boolean;
    samplingMetadatas?: unknown[];
  };
};
export function analyticsRequest(days: number, slugs?: string[]) {
  const expressions: unknown[] = [
    {
      filter: {
        fieldName: "hostName",
        inListFilter: { values: HOSTS, caseSensitive: false },
      },
    },
    {
      filter: {
        fieldName: "sessionSource",
        inListFilter: { values: TELEGRAM, caseSensitive: false },
      },
    },
  ];
  if (slugs)
    expressions.push({
      filter: {
        fieldName: "sessionManualAdContent",
        inListFilter: { values: slugs, caseSensitive: true },
      },
    });
  return {
    dateRanges: [{ startDate: `${days - 1}daysAgo`, endDate: "today" }],
    dimensions: [{ name: "date" }],
    metrics: [
      { name: "sessions" },
      { name: "ecommercePurchases" },
      { name: "purchaseRevenue" },
    ],
    dimensionFilter: { andGroup: { expressions } },
    currencyCode: "BRL",
    limit: 10000,
  };
}
export function analyticsSummary(report: Report) {
  const names = report.dimensionHeaders?.map((d) => d.name) || [];
  const metrics = report.metricHeaders?.map((m) => m.name) || [];
  if (
    !names.includes("date") ||
    !["sessions", "ecommercePurchases", "purchaseRevenue"].every((m) =>
      metrics.includes(m),
    )
  )
    throw new Error("Incomplete analytics report");
  const daily = (report.rows || [])
    .map((row) => {
      const date = row.dimensionValues?.[names.indexOf("date")]?.value || "";
      const metric = (key: string) => {
        const value = Number(
          row.metricValues?.[metrics.indexOf(key)]?.value || 0,
        );
        if (!Number.isFinite(value) || value < 0)
          throw new Error("Invalid analytics result");
        return value;
      };
      if (!/^\d{8}$/.test(date)) throw new Error("Invalid analytics date");
      return {
        day: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}`,
        sessions: metric("sessions"),
        purchases: metric("ecommercePurchases"),
        revenue: metric("purchaseRevenue"),
      };
    })
    .sort((a, b) => a.day.localeCompare(b.day));
  return {
    daily,
    sessions: daily.reduce((n, d) => n + d.sessions, 0),
    purchases: daily.reduce((n, d) => n + d.purchases, 0),
    revenue: Math.round(daily.reduce((n, d) => n + d.revenue, 0) * 100) / 100,
    partial:
      (report.rowCount || 0) > daily.length ||
      !!report.metadata?.subjectToThresholding ||
      !!report.metadata?.dataLossFromOtherRow ||
      !!report.metadata?.samplingMetadatas?.length,
  };
}
const cache = new Map<string, { expires: number; value: Promise<Analytics> }>();
export function googleAnalytics(
  days: number,
  slugs?: string[],
  fresh = false,
): Promise<Analytics> {
  const key = `${days}:${slugs ? [...slugs].sort().join(",") : "all"}`;
  const saved = cache.get(key);
  if (!fresh && saved && saved.expires > Date.now()) return saved.value;
  const value = queryAnalytics(days, slugs);
  if (cache.size >= 50) cache.delete(cache.keys().next().value!);
  cache.set(key, { expires: Date.now() + 300000, value });
  return value;
}
async function queryAnalytics(
  days: number,
  slugs?: string[],
): Promise<Analytics> {
  const base: Analytics = {
    connected: false,
    configured: !!process.env.BFF_GA_SERVICE_ACCOUNT_JSON,
    propertyId: PROPERTY,
    checkedAt: new Date().toISOString(),
    timeZone: null,
    from: day(period(days).start),
    to: day(new Date()),
    sessions: 0,
    purchases: 0,
    revenue: 0,
    daily: [],
    partial: false,
  };
  if (!base.configured) return base;
  try {
    const credentials = JSON.parse(process.env.BFF_GA_SERVICE_ACCOUNT_JSON!);
    if (
      !credentials.client_email ||
      !credentials.private_key ||
      credentials.type !== "service_account"
    )
      throw new Error("Invalid credentials");
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    // Uma origem sem links ainda verifica o acesso, usando um filtro sem
    // correspondência para não misturar as métricas de outras origens.
    const request = analyticsRequest(
      days,
      slugs?.length === 0 ? ["__no_bff_telegram_links__"] : slugs,
    );
    const client = await auth.getClient();
    const result = await client.request<Report>({
      url: `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`,
      method: "POST",
      data: request,
      timeout: 15000,
      retry: false,
    });
    const timeZone = result.data.metadata?.timeZone || null;
    const to = timeZone
      ? new Intl.DateTimeFormat("en-CA", {
          timeZone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).format(new Date())
      : base.to;
    const first = new Date(`${to}T12:00:00Z`);
    first.setUTCDate(first.getUTCDate() - days + 1);
    return {
      ...base,
      ...analyticsSummary(result.data),
      timeZone,
      to,
      from: first.toISOString().slice(0, 10),
      connected: true,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    console.warn("[telegram-growth] analytics unavailable");
    return {
      ...base,
      error:
        "Não foi possível consultar esta propriedade do Google Analytics. Tente atualizar novamente.",
    };
  }
}

function trayBootstrap() {
  if (!process.env.BFF_TRAY_CONNECTION_BOOTSTRAP)
    throw new TelegramError(
      "tray",
      "Use Conectar loja Tray para autorizar a loja.",
      0,
      409,
    );
  let config: {
    apiAddress: string;
    storeId: string;
    accessToken: string;
    refreshToken: string;
    accessExpiresAt: string;
    refreshExpiresAt: string;
  };
  try {
    config = JSON.parse(process.env.BFF_TRAY_CONNECTION_BOOTSTRAP);
    const url = new URL(config.apiAddress);
    if (
      url.protocol !== "https:" ||
      !HOSTS.includes(url.hostname) ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/web_api\/?$/.test(url.pathname) ||
      String(config.storeId) !== "1270558"
    )
      throw new Error();
    if (
      ![config.accessToken, config.refreshToken].every(
        (v) => typeof v === "string" && /^[A-Za-z0-9._-]{10,1000}$/.test(v),
      )
    )
      throw new Error();
    if (
      ![config.accessExpiresAt, config.refreshExpiresAt].every(
        (v) =>
          Number.isFinite(new Date(v).getTime()) &&
          new Date(v).getTime() > Date.now(),
      )
    )
      throw new Error();
  } catch {
    throw new TelegramError(
      "tray",
      "A configuração de reconexão expirou. Reautorize a loja Tray.",
      0,
      409,
    );
  }
  return config;
}
export function canRestoreTray() {
  try {
    trayBootstrap();
    return true;
  } catch {
    return false;
  }
}
export async function restoreTray(userId: string) {
  const existing = await prisma.trayConnection.findFirst({
    select: { id: true },
  });
  if (existing) return { connected: true, restored: false };
  const config = trayBootstrap();
  const endpoint = new URL(`${config.apiAddress.replace(/\/$/, "")}/orders`);
  endpoint.searchParams.set("access_token", config.accessToken);
  endpoint.searchParams.set("limit", "1");
  const response = await fetch(endpoint, {
    signal: AbortSignal.timeout(15000),
  });
  const probe = await response.json().catch(() => ({}));
  if (!response.ok || !Array.isArray(probe.Orders))
    throw new TelegramError(
      "tray",
      "A Tray não confirmou o acesso. Reautorize a loja.",
      0,
      409,
    );
  await prisma.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_xact_lock(760311342) AS locked`;
    if (!lock?.locked)
      throw new TelegramError(
        "busy",
        "A loja já está sendo reconectada. Aguarde alguns segundos.",
        0,
        409,
      );
    if (await tx.trayConnection.findFirst({ select: { id: true } })) return;
    await tx.trayConnection.create({
      data: {
        apiAddress: config.apiAddress,
        storeId: config.storeId,
        accessToken: encrypt(config.accessToken),
        refreshToken: encrypt(config.refreshToken),
        accessTokenExpiresAt: new Date(config.accessExpiresAt),
        refreshTokenExpiresAt: new Date(config.refreshExpiresAt),
        connectedByUserId: userId,
        lastSyncAt: new Date(),
      },
    });
  });
  return { connected: true, restored: true };
}
