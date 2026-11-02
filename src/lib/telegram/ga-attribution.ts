import "server-only";
import { google } from "googleapis";
import {
  ATTRIBUTION_DAYS,
  cents,
  orderStatus,
  verifyClick,
} from "./growth-domain";

const PROPERTY = "419011003";
const HOSTS = ["www.bfffitnessatacado.com.br", "bfffitnessatacado.com.br"];
const SOURCES = [
  "telegram",
  "t.me",
  "telegram.me",
  "web.telegram.org",
  "telegram.org",
];
const DIMENSIONS = [
  "transactionId",
  "landingPagePlusQueryString",
  "sessionManualAdContent",
  "dateHourMinute",
];
const REPORT_LIMIT = 10000;

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
    subjectToThresholding?: boolean;
    dataLossFromOtherRow?: boolean;
    samplingMetadatas?: unknown[];
  };
};
export type GaPurchaseEvidence = {
  orderId: string;
  clickId: string | null;
  slug: string | null;
  purchaseMinute: Date;
};
export type GaAttributionReport = {
  status: "ready" | "unconfigured" | "unavailable";
  configured: boolean;
  connected: boolean;
  checkedAt: string;
  timeZone: string | null;
  partial: boolean;
  evidence: GaPurchaseEvidence[];
  linkOnly: number;
  invalid: number;
  error?: string;
};
export type GaAttributionClick = {
  id: string;
  linkId: string;
  slug: string;
  createdAt: Date;
};
export type GaAttributionOrder = {
  id: string | number;
  date: string;
  hour?: string;
  total: string | number;
  status?: string;
  has_payment?: string | number;
};
export type GaAttributedConversion = {
  orderId: string;
  clickId: string;
  amountCents: number;
  status: "paid" | "pending" | "cancelled";
  placedAt: Date;
};

/** Current BFF tagging was checked against five real Tray order IDs/timestamps.
 * Only the verified T_<Tray order ID> mapping is accepted; arbitrary prefixes,
 * substrings and unverified numeric transaction formats are never guessed. */
export function transactionOrderId(value: string): string | null {
  return /^T_([1-9]\d{0,17})$/.exec(value)?.[1] || null;
}

function partsAt(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return {
    year: +values.year,
    month: +values.month,
    day: +values.day,
    hour: +values.hour,
    minute: +values.minute,
    second: +values.second,
  };
}
function timestamp(parts: ReturnType<typeof partsAt>) {
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
}
/** A GA4 dateHourMinute is in the PROPERTY timezone, not the browser/store timezone.
 * Reject DST gaps/overlaps rather than choosing an uncertain financial timestamp. */
export function gaMinute(value: string, timeZone: string): Date | null {
  if (!/^20\d{10}$/.test(value)) return null;
  const wanted = {
    year: +value.slice(0, 4),
    month: +value.slice(4, 6),
    day: +value.slice(6, 8),
    hour: +value.slice(8, 10),
    minute: +value.slice(10, 12),
    second: 0,
  };
  const wall = timestamp(wanted);
  const utc = new Date(wall);
  if (
    utc.getUTCFullYear() !== wanted.year ||
    utc.getUTCMonth() + 1 !== wanted.month ||
    utc.getUTCDate() !== wanted.day ||
    wanted.hour > 23 ||
    wanted.minute > 59
  )
    return null;
  try {
    const candidates = new Set<number>();
    for (const delta of [-86400000, 0, 86400000]) {
      const sample = wall + delta;
      const offset = timestamp(partsAt(new Date(sample), timeZone)) - sample;
      const candidate = wall - offset;
      if (timestamp(partsAt(new Date(candidate), timeZone)) === wall)
        candidates.add(candidate);
    }
    return candidates.size === 1 ? new Date([...candidates][0]) : null;
  } catch {
    return null;
  }
}

export function gaPurchaseRequest(days = 30) {
  if (!Number.isInteger(days) || days < 1 || days > 90)
    throw new Error("Invalid attribution period");
  return {
    // Relative dates are interpreted in the actual GA property timezone.
    // One extra boundary day prevents losing orders around a timezone midnight;
    // exact click/order timing is checked again during reconciliation.
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: "today" }],
    dimensions: DIMENSIONS.map((name) => ({ name })),
    metrics: [{ name: "ecommercePurchases" }],
    dimensionFilter: {
      andGroup: {
        expressions: [
          {
            filter: {
              fieldName: "hostName",
              inListFilter: { values: HOSTS, caseSensitive: false },
            },
          },
          {
            filter: {
              fieldName: "sessionSource",
              inListFilter: { values: SOURCES, caseSensitive: false },
            },
          },
        ],
      },
    },
    metricFilter: {
      filter: {
        fieldName: "ecommercePurchases",
        numericFilter: {
          operation: "GREATER_THAN",
          value: { int64Value: "0" },
        },
      },
    },
    limit: REPORT_LIMIT,
  };
}

function landingEvidence(landing: string, adContent: string) {
  try {
    if (
      !landing.startsWith("/") ||
      landing.startsWith("//") ||
      landing.length > 8192
    )
      return null;
    const url = new URL(landing, `https://${HOSTS[0]}`);
    if (
      !HOSTS.includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      return null;
    if (
      url.searchParams.getAll("bff_tg").length > 1 ||
      url.searchParams.getAll("utm_content").length > 1
    )
      return null;
    const landingSlug = url.searchParams.get("utm_content");
    const reportSlug = /^[\w-]{12}$/.test(adContent) ? adContent : null;
    const slug =
      landingSlug && /^[\w-]{12}$/.test(landingSlug) ? landingSlug : reportSlug;
    if (
      !slug ||
      (landingSlug && landingSlug !== slug) ||
      (reportSlug && reportSlug !== slug)
    )
      return null;
    const token = url.searchParams.get("bff_tg");
    if (!token) return { slug, clickId: null };
    const clickId = verifyClick(token);
    // A malformed or forged token is not downgraded into trusted click evidence.
    return clickId ? { slug, clickId } : null;
  } catch {
    return null;
  }
}

export function parseGaPurchases(report: Report) {
  const headers = report.dimensionHeaders?.map((h) => h.name) || [];
  const metrics = report.metricHeaders?.map((h) => h.name) || [];
  if (
    !DIMENSIONS.every((d) => headers.includes(d)) ||
    !metrics.includes("ecommercePurchases")
  )
    throw new Error("Incomplete attribution report");
  const rows = report.rows || [];
  if (rows.length && !report.metadata?.timeZone)
    throw new Error("Missing property timezone");
  const evidence: GaPurchaseEvidence[] = [];
  let linkOnly = 0,
    invalid = 0;
  for (const row of rows) {
    const dimension = (name: string) =>
      row.dimensionValues?.[headers.indexOf(name)]?.value || "";
    const purchases = Number(
      row.metricValues?.[metrics.indexOf("ecommercePurchases")]?.value,
    );
    const orderId = transactionOrderId(dimension("transactionId"));
    const minute = gaMinute(
      dimension("dateHourMinute"),
      report.metadata?.timeZone || "",
    );
    const landing = landingEvidence(
      dimension("landingPagePlusQueryString"),
      dimension("sessionManualAdContent"),
    );
    if (
      !orderId ||
      !minute ||
      !landing ||
      !Number.isFinite(purchases) ||
      purchases <= 0
    ) {
      invalid++;
      continue;
    }
    if (!landing.clickId) linkOnly++;
    evidence.push({
      orderId,
      clickId: landing.clickId,
      slug: landing.slug,
      purchaseMinute: minute,
    });
  }
  return {
    evidence,
    linkOnly,
    invalid,
    timeZone: report.metadata?.timeZone || null,
    partial:
      (report.rowCount || 0) > rows.length ||
      !!report.metadata?.subjectToThresholding ||
      !!report.metadata?.dataLossFromOtherRow ||
      !!report.metadata?.samplingMetadatas?.length,
  };
}

export async function readGaPurchases(days = 30): Promise<GaAttributionReport> {
  const base: GaAttributionReport = {
    status: "unconfigured",
    configured: !!process.env.BFF_GA_SERVICE_ACCOUNT_JSON,
    connected: false,
    checkedAt: new Date().toISOString(),
    timeZone: null,
    partial: false,
    evidence: [],
    linkOnly: 0,
    invalid: 0,
  };
  if (!base.configured) return base;
  try {
    const credentials = JSON.parse(process.env.BFF_GA_SERVICE_ACCOUNT_JSON!);
    if (
      credentials.type !== "service_account" ||
      !credentials.private_key ||
      !credentials.client_email
    )
      throw new Error("Invalid configuration");
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
    });
    const client = await auth.getClient();
    const response = await client.request<Report>({
      url: `https://analyticsdata.googleapis.com/v1beta/properties/${PROPERTY}:runReport`,
      method: "POST",
      data: gaPurchaseRequest(days),
      timeout: 15000,
      retry: false,
    });
    return {
      ...base,
      ...parseGaPurchases(response.data),
      status: "ready",
      connected: true,
      checkedAt: new Date().toISOString(),
    };
  } catch {
    console.warn("[telegram-growth] GA4 attribution unavailable");
    return {
      ...base,
      status: "unavailable",
      error:
        "Não foi possível consultar a atribuição de compras no Google Analytics.",
    };
  }
}

function trayPlacedAt(order: GaAttributionOrder) {
  if (
    !/^20\d{2}-\d{2}-\d{2}$/.test(order.date) ||
    !/^\d{2}:\d{2}:\d{2}$/.test(order.hour || "")
  )
    return null;
  const date = new Date(`${order.date}T${order.hour}-03:00`);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = partsAt(date, "America/Sao_Paulo");
  const actual = `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")} ${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`;
  return actual === `${order.date} ${order.hour}` ? date : null;
}

/** Pure reconciliation: never writes a conversion or a synthetic arrival event.
 * Payment, total, cancellations and creation timestamp come only from the Tray order. */
export function reconcileGaPurchases(
  evidence: GaPurchaseEvidence[],
  clicks: GaAttributionClick[],
  orders: GaAttributionOrder[],
  now = new Date(),
) {
  const clickMap = new Map(clicks.map((c) => [c.id, c]));
  const orderMap = new Map(orders.map((o) => [String(o.id), o]));
  const groups = new Map<string, GaPurchaseEvidence[]>();
  for (const item of evidence)
    groups.set(item.orderId, [...(groups.get(item.orderId) || []), item]);
  const conversions: GaAttributedConversion[] = [];
  let ambiguous = 0,
    unmatched = 0,
    linkOnly = 0;
  for (const [orderId, items] of groups) {
    const signed = items.filter((i) => i.clickId !== null);
    if (!signed.length) {
      linkOnly++;
      continue;
    }
    const ids = new Set(signed.map((i) => i.clickId));
    const slugs = new Set(items.map((i) => i.slug));
    if (ids.size !== 1 || slugs.size !== 1) {
      ambiguous++;
      continue;
    }
    const click = clickMap.get(signed[0].clickId!);
    const order = orderMap.get(orderId);
    if (
      !click ||
      !order ||
      click.slug !== signed[0].slug ||
      !Number.isFinite(click.createdAt.getTime())
    ) {
      unmatched++;
      continue;
    }
    const placedAt = trayPlacedAt(order);
    if (
      !placedAt ||
      placedAt > now ||
      placedAt < click.createdAt ||
      placedAt.getTime() - click.createdAt.getTime() >
        ATTRIBUTION_DAYS * 86400000
    ) {
      unmatched++;
      continue;
    }
    const timingMatches = signed.some(
      (i) =>
        Number.isFinite(i.purchaseMinute.getTime()) &&
        i.purchaseMinute <= now &&
        i.purchaseMinute.getTime() + 60000 > click.createdAt.getTime() &&
        Math.abs(i.purchaseMinute.getTime() - placedAt.getTime()) <= 300000,
    );
    if (!timingMatches) {
      unmatched++;
      continue;
    }
    try {
      conversions.push({
        orderId,
        clickId: click.id,
        amountCents: cents(order.total),
        status: orderStatus(order),
        placedAt,
      });
    } catch {
      unmatched++;
    }
  }
  return { conversions, ambiguous, unmatched, linkOnly };
}
