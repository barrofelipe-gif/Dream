import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { TelegramError, type Data } from "./domain";

export const STORE_HOSTS = [
  "www.bfffitnessatacado.com.br",
  "bfffitnessatacado.com.br",
];
export const ATTRIBUTION_DAYS = 30;
export function destination(value: unknown) {
  try {
    const url = new URL(String(value));
    if (
      url.protocol !== "https:" ||
      !STORE_HOSTS.includes(url.hostname) ||
      url.username ||
      url.password ||
      url.port
    )
      throw new Error();
    if (/^\/(?:auth|admin|mvc\/adm|checkout)(?:[/.]|$)/i.test(url.pathname))
      throw new Error();
    url.searchParams.delete("bff_tg");
    url.searchParams.delete("bff_validation");
    url.searchParams.delete("bff_test");
    return url.toString();
  } catch {
    throw new TelegramError(
      "input",
      "Use um link HTTPS de produto, coleção ou página da loja BFF Fitness.",
    );
  }
}
export function text(value: unknown, label: string, max = 100) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.trim().length > max ||
    /[\x00-\x1f\x7f]/.test(value)
  )
    throw new TelegramError(
      "input",
      `Preencha ${label} com até ${max} caracteres.`,
    );
  return value.trim();
}
export function linkInput(input: Record<string, unknown>) {
  return {
    name: text(input.name, "o nome do link"),
    sourceName: text(input.sourceName, "o grupo ou canal de origem"),
    campaign: text(input.campaign, "a campanha"),
    destination: destination(input.destination),
  };
}
function key() {
  const value = process.env.AUTH_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!value)
    throw new TelegramError(
      "config",
      "Segurança do rastreamento não configurada.",
      0,
      503,
    );
  return value;
}
export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
export function hash(value: string) {
  return createHmac("sha256", key()).update(`tg-growth:${value}`).digest("hex");
}
export function signClick(id: string) {
  return `${id}.${hash(`click:${id}`).slice(0, 32)}`;
}
export function verifyClick(value: unknown) {
  if (typeof value !== "string" || !/^[0-9a-f-]{36}\.[0-9a-f]{32}$/.test(value))
    return null;
  const id = value.split(".")[0];
  const expected = Buffer.from(signClick(id));
  const supplied = Buffer.from(value);
  return expected.length === supplied.length &&
    timingSafeEqual(expected, supplied)
    ? id
    : null;
}
export function validationToken(slug: string, now = Date.now()) {
  const stamp = Math.floor(now / 1000);
  return `${stamp}.${hash(`validation:${slug}:${stamp}`).slice(0, 32)}`;
}
export function verifyValidation(
  slug: string,
  token: string,
  now = Date.now(),
) {
  if (!/^\d{10}\.[a-f0-9]{32}$/.test(token)) return false;
  const stamp = Number(token.split(".")[0]) * 1000;
  if (stamp > now + 60000 || now - stamp > 900000) return false;
  const expected = Buffer.from(validationToken(slug, stamp)),
    supplied = Buffer.from(token);
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}
export function trackedDestination(
  link: {
    destination: string;
    campaign: string;
    sourceName: string;
    slug: string;
  },
  token?: string,
  validation = false,
) {
  const url = new URL(destination(link.destination));
  url.searchParams.set(
    "utm_source",
    validation ? "bff_validation" : "telegram",
  );
  url.searchParams.set(
    "utm_medium",
    validation ? "internal_test" : "community",
  );
  url.searchParams.set("utm_campaign", link.campaign);
  url.searchParams.set("utm_content", link.slug);
  if (token) url.searchParams.set("bff_tg", token);
  if (validation) url.searchParams.set("bff_validation", "1");
  return url.toString();
}
export function isPreview(headers: Headers) {
  return (
    /bot|crawler|spider|preview|telegrambot|facebookexternalhit|headless|lighthouse/i.test(
      headers.get("user-agent") || "",
    ) ||
    /prefetch|prerender/i.test(
      `${headers.get("purpose") || ""} ${headers.get("sec-purpose") || ""}`,
    )
  );
}
export function day(date: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
export function period(days: number, now = new Date()) {
  const today = day(now);
  const end = new Date(`${today}T00:00:00-03:00`);
  end.setUTCDate(end.getUTCDate() + 1);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  const previous = new Date(start);
  previous.setUTCDate(previous.getUTCDate() - days);
  return { start, end, previous };
}
export type GrowthClick = {
  id: string;
  linkId: string;
  visitorHash: string;
  createdAt: Date;
  visitedAt: Date | null;
};
export type GrowthSale = {
  clickId: string;
  amountCents: number;
  status: string;
  placedAt: Date;
};
export type GrowthLink = {
  id: string;
  slug: string;
  name: string;
  sourceName: string;
  campaign: string;
  destination: string;
  active: boolean;
  createdAt: Date;
};
export type Totals = {
  audience: number;
  clicks: number;
  visitors: number;
  visits: number;
  sales: number;
  revenue: number;
  pending: number;
  conversion: number;
  ticket: number;
};
export function summarize(
  links: GrowthLink[],
  clicks: GrowthClick[],
  sales: GrowthSale[],
  data: Data,
  days: number,
  source = "",
  now = new Date(),
) {
  const range = period(days, now);
  const filteredLinks = links.filter((l) => !source || l.sourceName === source);
  const ids = new Set(filteredLinks.map((l) => l.id));
  const scopedClicks = clicks.filter(
    (c) => ids.has(c.linkId) && !c.visitorHash.startsWith("test:"),
  );
  const clickMap = new Map(scopedClicks.map((c) => [c.id, c]));
  const scopedSales = sales.filter((s) => clickMap.has(s.clickId));
  // A pessoa conta uma vez, na primeira inclusão confirmada. "Já participava"
  // e tentativas de convite não são aquisição. A origem é a do trabalho real.
  const acquired = new Map<number, { at: Date; source: string }>();
  const jobs = new Map(data.jobs.map((j) => [j.id, j]));
  // Older jobs have no name snapshot. Resolve only identities already known
  // to the workspace; current configuration takes precedence for those jobs.
  const origins = new Map(
    [...(data.prospects || []), ...data.groups, ...data.sources].map((group) => [
      group.id,
      group.name,
    ]),
  );
  for (const result of data.results) {
    if (result.state !== "added") continue;
    const job = jobs.get(result.job_id);
    if (!job) continue;
    const at = new Date(result.updated_at * 1000);
    const sourceName =
      (typeof job.source_name === "string" && job.source_name.trim()
        ? job.source_name
        : origins.get(job.source_id)) || `Grupo ${job.source_id}`;
    if (!acquired.has(result.user_id) || acquired.get(result.user_id)!.at > at)
      acquired.set(result.user_id, { at, source: sourceName });
  }
  const audience = [...acquired.values()].filter(
    (a) => !source || a.source === source,
  );
  function total(start: Date, end: Date): Totals {
    const within = (at: Date) => at >= start && at < end;
    const c = scopedClicks.filter((c) => within(c.createdAt));
    const visits = scopedClicks.filter(
      (c) => c.visitedAt && within(c.visitedAt),
    ).length;
    const orders = scopedSales.filter((s) => within(s.placedAt));
    const paid = orders.filter((s) => s.status === "paid");
    const revenue = paid.reduce((n, s) => n + s.amountCents, 0) / 100;
    return {
      audience: audience.filter((a) => within(a.at)).length,
      clicks: c.length,
      visitors: new Set(c.map((c) => c.visitorHash)).size,
      visits,
      sales: paid.length,
      revenue,
      pending: orders.filter((s) => s.status === "pending").length,
      conversion: visits ? (paid.length / visits) * 100 : 0,
      ticket: paid.length ? revenue / paid.length : 0,
    };
  }
  const totals = total(range.start, range.end),
    previous = total(range.previous, range.start);
  const daily = Array.from({ length: days }, (_, i) => {
    const start = new Date(range.start);
    start.setUTCDate(start.getUTCDate() + i);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 1);
    return { day: day(start), ...total(start, end) };
  });
  const performance = filteredLinks
    .map((link) => {
      const linked = scopedClicks.filter((c) => c.linkId === link.id);
      const clickIds = new Set(linked.map((c) => c.id));
      const within = (date: Date) => date >= range.start && date < range.end;
      const paid = scopedSales.filter(
        (s) =>
          clickIds.has(s.clickId) && s.status === "paid" && within(s.placedAt),
      );
      const visits = linked.filter(
        (c) => c.visitedAt && within(c.visitedAt),
      ).length;
      return {
        ...link,
        createdAt: link.createdAt.toISOString(),
        clicks: linked.filter((c) => within(c.createdAt)).length,
        visits,
        sales: paid.length,
        revenue: paid.reduce((n, s) => n + s.amountCents, 0) / 100,
        conversion: visits ? (paid.length / visits) * 100 : 0,
      };
    })
    .sort((a, b) => b.revenue - a.revenue || b.clicks - a.clicks);
  const sources = [
    ...new Set([
      ...links.map((l) => l.sourceName),
      ...[...acquired.values()].map((a) => a.source),
    ]),
  ].sort();
  return {
    days,
    source,
    from: day(range.start),
    to: day(now),
    totals,
    previous,
    daily,
    links: performance,
    sources,
  };
}
export function orderStatus(order: {
  status?: string;
  has_payment?: string | number;
}) {
  if (/cancelad|estornad|reembolsad/i.test(order.status || ""))
    return "cancelled";
  return String(order.has_payment) === "1" ? "paid" : "pending";
}
export function cents(value: unknown) {
  const text = String(value ?? "");
  if (!/^\d{1,8}(?:\.\d{1,2})?$/.test(text))
    throw new Error("Invalid order total");
  const result = Math.round(Number(text) * 100);
  if (!Number.isSafeInteger(result) || result > 2147483647)
    throw new Error("Invalid order total");
  return result;
}
export function rankProspect(
  group: { name: string; username: string; members: number | null },
  query: string,
) {
  const words = query
    .toLocaleLowerCase("pt-BR")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  const haystack = `${group.name} ${group.username}`.toLocaleLowerCase("pt-BR");
  const matches = words.filter((w) => haystack.includes(w));
  return {
    affinity: matches.length
      ? "Nome relacionado à pesquisa"
      : "Retornado pela busca do Telegram",
    matches: matches.length,
  };
}
