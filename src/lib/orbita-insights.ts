/** Read-only adapter for the official Instagram collection already saved in the app.
 * Never use the denormalized zero-default columns as evidence of a metric.
 */
const DAY_MS = 86_400_000;
const ZONE = "America/Sao_Paulo";
export class OrbitaInsightsError extends Error {
  constructor(
    message: string,
    public code: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type OfficialAccount = {
  id: string;
  username: string | null;
  loja: string;
};
export type StoredAccountDay = {
  contaId: string;
  data: Date | string;
  bruto: string;
  coletadoEm: Date | string;
};
export type StoredPost = {
  contaId: string;
  externoId: string;
  tipo: string;
  legenda: string;
  permalink: string | null;
  publicadoEm: Date | string;
  bruto: string;
  coletadoEm: Date | string;
};
type Metrics = Record<string, number>;
type Content = {
  id: string;
  kind: "post" | "carousel" | "reel" | "story";
  title: string;
  url?: string;
  thumbnailUrl?: string;
  publishedAt: string;
  storyMedia?: "photo" | "video";
  metrics: Metrics;
};
export type OfficialInsightReport = {
  id: string;
  account: string;
  start: string;
  end: string;
  recordedAt: string;
  source: "file";
  coverage: "unknown";
  contentWindow: "period" | "lifetime";
  note: string;
  metrics: Metrics;
  content: Content[];
  audience: [];
};
export function usernameOf(value: unknown): string {
  if (typeof value !== "string")
    throw new OrbitaInsightsError(
      "Informe o @ da conta selecionada.",
      "INVALID_ACCOUNT",
    );
  const username = value.trim().replace(/^@/, "").toLowerCase();
  if (
    !/^[a-z0-9._]{1,30}$/.test(username) ||
    username.includes("..") ||
    /^\.|\.$/.test(username)
  )
    throw new OrbitaInsightsError(
      "Informe um @ válido, sem link ou espaços.",
      "INVALID_ACCOUNT",
    );
  return username;
}
export function dayInSaoPaulo(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new OrbitaInsightsError(
      "Data de coleta inválida.",
      "INVALID_STORED_DATE",
    );
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}
function validDay(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new OrbitaInsightsError(
      "Use datas válidas no formato AAAA-MM-DD.",
      "INVALID_PERIOD",
    );
  return value;
}
export function officialPeriod(
  startValue: unknown,
  endValue: unknown,
  now = new Date(),
) {
  const start = validDay(startValue),
    end = validDay(endValue);
  const days = (Date.parse(end) - Date.parse(start)) / DAY_MS + 1;
  if (start > end || end >= dayInSaoPaulo(now) || days > 90)
    throw new OrbitaInsightsError(
      "Escolha um período encerrado de até 90 dias, anterior ao dia atual de Brasília.",
      "INVALID_PERIOD",
    );
  return { start, end, days };
}
export function selectOfficialAccount(
  accounts: OfficialAccount[],
  username: string,
  accountId?: string | null,
): OfficialAccount {
  const matches = accounts.filter((a) => {
    try {
      return usernameOf(a.username) === username;
    } catch {
      return false;
    }
  });
  if (accountId) {
    const match = matches.find((a) => a.id === accountId);
    if (!match)
      throw new OrbitaInsightsError(
        "A conta escolhida não corresponde ao @ informado.",
        "ACCOUNT_NOT_FOUND",
        404,
      );
    return match;
  }
  if (!matches.length)
    throw new OrbitaInsightsError(
      "Este @ não possui uma conta oficial ativa na área de redes sociais do app. Confira a conexão em Growth → Instagram → Publicar nas redes.",
      "ACCOUNT_NOT_FOUND",
      404,
    );
  if (matches.length > 1)
    throw new OrbitaInsightsError(
      "Há mais de um cadastro ativo para este @. Escolha a conta de origem.",
      "ACCOUNT_AMBIGUOUS",
      409,
    );
  return matches[0];
}
const object = (x: unknown): Record<string, unknown> =>
  x && typeof x === "object" && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : {};
const parse = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};
const count = (x: unknown): x is number =>
  typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
function metricMap(value: unknown, accountDay = false): Metrics {
  const out: Metrics = {},
    seen = new Set<string>();
  if (!Array.isArray(value)) return out;
  for (const raw of value) {
    const row = object(raw),
      name = row.name;
    if (typeof name !== "string") continue;
    if (seen.has(name)) {
      delete out[name];
      continue;
    }
    seen.add(name);
    if (accountDay && row.period !== undefined && row.period !== "day")
      continue;
    const total = object(row.total_value).value;
    const values = row.values;
    const number =
      total !== undefined
        ? total
        : Array.isArray(values) && values.length === 1
          ? object(values[0]).value
          : undefined;
    if (
      count(number) ||
      (["ig_reels_avg_watch_time", "ig_reels_video_view_total_time"].includes(
        name,
      ) &&
        typeof number === "number" &&
        Number.isFinite(number) &&
        number >= 0 &&
        number <= Number.MAX_SAFE_INTEGER)
    )
      out[name] = number;
  }
  return out;
}
const ACCOUNT_ADDITIVE: Record<string, string> = {
  views: "views",
  profile_views: "profile_visits",
  profile_links_taps: "profile_links_taps",
  total_interactions: "total_interactions",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saves: "saves",
};
const CONTENT_METRICS: Record<string, string> = {
  reach: "reach",
  views: "views",
  likes: "likes",
  comments: "comments",
  shares: "shares",
  saved: "saves",
  total_interactions: "total_interactions",
  follows: "follows",
  profile_visits: "profile_visits",
  replies: "replies",
};
const KINDS: Record<string, Content["kind"]> = {
  foto: "post",
  carrossel: "carousel",
  reel: "reel",
  story: "story",
};
function safeUrl(value: string | null): string | undefined {
  try {
    const u = new URL(value || "");
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      !["instagram.com", "www.instagram.com"].includes(u.hostname) ||
      !/^\/(p|reel|reels|stories)\//.test(u.pathname)
    )
      return undefined;
    return `https://www.instagram.com${u.pathname.replace(/^\/reels\//, "/reel/").replace(/\/+$/, "")}/`;
  } catch {
    return undefined;
  }
}
function safeThumbnail(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const url = new URL(value.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      (url.port && url.port !== "443") ||
      !["cdninstagram.com", "fbcdn.net"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      ) ||
      /\.(mp4|m4v|mov|webm)(?:$|\/)/i.test(url.pathname)
    )
      return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}
function mediaThumbnail(
  media: Record<string, unknown>,
  kind: Content["kind"],
): string | undefined {
  const thumbnail = safeThumbnail(media.thumbnail_url);
  if (thumbnail) return thumbnail;
  const image = safeThumbnail(media.media_url);
  if (!image) return undefined;
  if (media.media_type === "IMAGE") return image;
  // A carousel URL can point to a video. Use a visibly image-shaped URL only;
  // a Reel/video media_url is never treated as its cover.
  if (
    (kind === "post" || kind === "carousel") &&
    media.media_type !== "VIDEO" &&
    /\.(jpe?g|png|webp|avif|gif)$/i.test(new URL(image).pathname)
  )
    return image;
  return undefined;
}
export function buildOfficialInsights(input: {
  account: OfficialAccount;
  username: string;
  start: string;
  end: string;
  days: StoredAccountDay[];
  posts: StoredPost[];
  postsTruncated?: boolean;
  now?: Date;
}) {
  const now = input.now || new Date(),
    period = officialPeriod(input.start, input.end, now);
  const account = selectOfficialAccount(
      [input.account],
      usernameOf(input.username),
      input.account.id,
    ),
    warnings: string[] = [],
    reports: OfficialInsightReport[] = [];
  const storeLabel = account.loja.trim().slice(0, 60);
  const expectedDays = Array.from({ length: period.days }, (_, i) =>
    new Date(Date.parse(period.start) + i * DAY_MS).toISOString().slice(0, 10),
  );
  const days = new Map<string, { metrics: Metrics; at: string }>();
  const stamps: string[] = [];
  function recorded(value: Date | string) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) &&
      date.getTime() <= now.getTime() + 60000
      ? date.toISOString()
      : null;
  }
  for (const row of input.days) {
    if (row.contaId !== account.id)
      throw new OrbitaInsightsError(
        "A coleta contém dados de outra conta. Nenhum relatório foi preparado.",
        "STORED_ACCOUNT_MISMATCH",
        409,
      );
    const date = new Date(row.data),
      at = recorded(row.coletadoEm);
    if (!Number.isFinite(date.getTime()) || !at) continue;
    const key = date.toISOString().slice(0, 10);
    if (!expectedDays.includes(key)) continue;
    const metrics = metricMap(parse(row.bruto), true);
    if (!Object.keys(metrics).length) continue;
    const old = days.get(key);
    if (!old || old.at < at) days.set(key, { metrics, at });
  }
  const totals: Metrics = {};
  for (const [raw, key] of Object.entries(ACCOUNT_ADDITIVE)) {
    if (!expectedDays.every((day) => days.get(day)?.metrics[raw] !== undefined))
      continue;
    const sum = expectedDays.reduce(
      (sum, day) => sum + days.get(day)!.metrics[raw],
      0,
    );
    if (count(sum)) totals[key] = sum;
  }
  if (period.days === 1)
    for (const key of ["reach", "accounts_engaged"]) {
      const value = days.get(period.start)?.metrics[key];
      if (value !== undefined) totals[key] = value;
    }
  else
    warnings.push(
      "Alcance e contas engajadas não foram somados entre dias: pessoas únicas podem se repetir. Para esses indicadores, escolha um único dia ou importe um agregado oficial equivalente.",
    );
  for (const day of days.values()) stamps.push(day.at);
  if (days.size < period.days)
    warnings.push(
      `Há coleta válida em ${days.size} de ${period.days} dias. Uma métrica do período só é incluída quando está presente em todos os dias.`,
    );
  if (Object.keys(totals).length)
    reports.push({
      id: `app-ig-${period.start}-${period.end}-account`,
      account: usernameOf(input.username),
      ...{ start: period.start, end: period.end },
      recordedAt: [...days.values()]
        .map((x) => x.at)
        .sort()
        .at(-1)!,
      source: "file",
      coverage: "unknown",
      contentWindow: "period",
      note: `Coleta oficial já salva no app (${storeLabel}). Última coleta dos dados: ${[
        ...days.values(),
      ]
        .map((x) => x.at)
        .sort()
        .at(
          -1,
        )}. Fuso ${ZONE}. Somente métricas presentes em todos os dias; cobertura orgânico/anúncio não registrada na coleta.`.slice(
        0,
        500,
      ),
      metrics: totals,
      content: [],
      audience: [],
    });
  const content: Content[] = [],
    mediaStamps: string[] = [];
  let skipped = 0;
  for (const row of input.posts) {
    if (row.contaId !== account.id)
      throw new OrbitaInsightsError(
        "A coleta contém conteúdos de outra conta. Nenhum relatório foi preparado.",
        "STORED_ACCOUNT_MISMATCH",
        409,
      );
    const at = recorded(row.coletadoEm),
      published = new Date(row.publicadoEm),
      kind = Object.hasOwn(KINDS, row.tipo) ? KINDS[row.tipo] : undefined;
    if (
      !at ||
      !kind ||
      !Number.isFinite(published.getTime()) ||
      published > now ||
      !row.externoId ||
      row.externoId.length > 150
    ) {
      skipped++;
      continue;
    }
    const publishedDay = dayInSaoPaulo(published);
    if (publishedDay < period.start || publishedDay > period.end) continue;
    const raw = object(parse(row.bruto)),
      media = object(raw.midia);
    if (media.id !== undefined && String(media.id) !== row.externoId) {
      skipped++;
      continue;
    }
    const source = metricMap(raw.insights),
      metrics: Metrics = {};
    for (const [key, target] of Object.entries(CONTENT_METRICS))
      if (source[key] !== undefined) metrics[target] = source[key];
    if (metrics.likes === undefined && count(media.like_count))
      metrics.likes = media.like_count;
    if (metrics.comments === undefined && count(media.comments_count))
      metrics.comments = media.comments_count;
    if (source.ig_reels_avg_watch_time !== undefined)
      metrics.avg_watch_time_seconds = source.ig_reels_avg_watch_time / 1000;
    if (source.ig_reels_video_view_total_time !== undefined)
      metrics.watch_time_seconds = source.ig_reels_video_view_total_time / 1000;
    if (!Object.keys(metrics).length) {
      skipped++;
      continue;
    }
    const item: Content = {
      id: row.externoId,
      kind,
      title: row.legenda.trim().slice(0, 180) || `Instagram ${row.externoId}`,
      publishedAt: published.toISOString(),
      metrics,
    };
    const url = safeUrl(row.permalink);
    if (url) item.url = url;
    const thumbnailUrl = mediaThumbnail(media, kind);
    if (thumbnailUrl) item.thumbnailUrl = thumbnailUrl;
    if (kind === "story") {
      if (media.media_type === "IMAGE") item.storyMedia = "photo";
      if (media.media_type === "VIDEO") item.storyMedia = "video";
    }
    if (
      content.some((c) => c.id === item.id || (item.url && c.url === item.url))
    ) {
      skipped++;
      continue;
    }
    if (content.length < 500) {
      content.push(item);
      stamps.push(at);
      mediaStamps.push(at);
    } else input.postsTruncated = true;
  }
  if (content.length)
    reports.push({
      id: `app-ig-${period.start}-${period.end}-content`,
      account: usernameOf(input.username),
      start: period.start,
      end: period.end,
      recordedAt: mediaStamps.sort().at(-1)!,
      source: "file",
      coverage: "unknown",
      contentWindow: "lifetime",
      note: `Coleta oficial já salva no app (${storeLabel}). Última coleta das mídias: ${mediaStamps.sort().at(-1)}. Mídias publicadas no intervalo; métricas acumuladas até a última coleta, sem recorte das interações ocorridas no período. Cobertura orgânico/anúncio não registrada. Amostra disponível da coleta, não lista completa de publicações.`.slice(
        0,
        500,
      ),
      metrics: {},
      content,
      audience: [],
    });
  if (skipped)
    warnings.push(
      `${skipped} conteúdo(s) sem métricas brutas válidas ou com metadados incompatíveis ficaram fora do relatório.`,
    );
  if (input.postsTruncated)
    warnings.push(
      "A lista de conteúdos foi limitada à amostra disponível, com no máximo 500 itens; não representa todas as publicações do período.",
    );
  if (!reports.length)
    warnings.push(
      "Nenhuma métrica oficial salva utilizável neste intervalo. Atualize a coleta em Growth → Instagram → Métricas e depois leia novamente na Órbita.",
    );
  warnings.push(
    "Esta leitura usa a coleta já salva no app. Não atualiza a Meta em tempo real. Campos ausentes não foram preenchidos com zero; dados demográficos de outras janelas não foram importados.",
  );
  return {
    reports,
    warnings,
    source: {
      type: "app-official-collection" as const,
      username: usernameOf(input.username),
      loja: account.loja,
      lastCollectedAt: stamps.sort().at(-1) || null,
      daysAvailable: days.size,
      daysExpected: period.days,
      contentAvailable: content.length,
      readOnly: true as const,
    },
  };
}
