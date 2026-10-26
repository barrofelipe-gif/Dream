import "server-only";
import { prisma } from "@/lib/prisma";
import { abrirConta } from "@/lib/social/contas";
import type { ResultadoColeta, TipoPost } from "./types";

const GRAPH = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;
const DIA_MS = 86_400_000;
const FUSO = "America/Sao_Paulo";

class ErroApi extends Error {
  constructor(
    msg: string,
    public codigo?: number,
    public reconectar = false,
  ) {
    super(msg);
  }
}

async function chamar<T = unknown>(token: string, caminho: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${GRAPH}/${caminho}${qs.size ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const texto = await res.text();
  if (!res.ok) {
    let msg = texto.slice(0, 300);
    let codigo: number | undefined;
    try {
      const e = (JSON.parse(texto) as { error?: { message?: string; code?: number } }).error;
      msg = e?.message ?? msg;
      codigo = e?.code;
    } catch {
      /* mantém o texto cru */
    }
    const reconectar = codigo === 190 || codigo === 10 || codigo === 200 || /permission|permiss|scope|OAuth|access token/i.test(msg);
    throw new ErroApi(
      reconectar
        ? `O Instagram não liberou as métricas (${msg}). Reconecte a conta do Instagram para liberar a permissão de métricas.`
        : `Instagram recusou: ${msg}`,
      codigo,
      reconectar,
    );
  }
  return JSON.parse(texto) as T;
}

/** Faz as tarefas com no máximo `n` ao mesmo tempo. */
async function emLotes<T>(itens: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, async () => {
      while (i < itens.length) await fn(itens[i++]);
    }),
  );
}

// ── Datas no fuso de Brasília ──────────────────────────────────────────────
const fmtBr = new Intl.DateTimeFormat("en-US", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
const DIAS_SEM: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function partesBr(d: Date) {
  const p = Object.fromEntries(fmtBr.formatToParts(d).map((x) => [x.type, x.value]));
  return { ano: +p.year, mes: +p.month, dia: +p.day, hora: +p.hour % 24, diaSemana: DIAS_SEM[p.weekday] ?? 0 };
}
/** Chave do dia (00:00 UTC da data de Brasília): serve de valor único para o banco. */
function chaveDia(d: Date) {
  const p = partesBr(d);
  return new Date(Date.UTC(p.ano, p.mes - 1, p.dia));
}
/** Início real (instante, em segundos) do dia de Brasília que tem esta chave. Brasil não tem horário de verão desde 2019: UTC-3. */
const inicioDoDia = (chave: Date) => Math.floor((chave.getTime() + 3 * 3600_000) / 1000);
const parseData = (s: string) => new Date(s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));

// ── Leitura das respostas de insights ──────────────────────────────────────
type ItemInsight = {
  name: string;
  total_value?: { value?: number; breakdowns?: { results?: { dimension_values?: string[]; value?: number }[] }[] };
  values?: { value?: number | Record<string, number> }[];
};
const numero = (it: ItemInsight | undefined): number => {
  if (!it) return 0;
  const v = it.total_value?.value ?? it.values?.[0]?.value;
  return typeof v === "number" ? v : 0;
};
const mapa = (itens: ItemInsight[]): Record<string, ItemInsight> => Object.fromEntries(itens.map((i) => [i.name, i]));
const resultados = (it: ItemInsight | undefined) =>
  (it?.total_value?.breakdowns?.[0]?.results ?? []).map((r) => ({ chave: (r.dimension_values ?? []).join(" / "), valor: r.value ?? 0 }));

/** Pede várias métricas; se a API recusar o conjunto (uma delas não vale para esse caso), tenta uma por uma e guarda as que valem. */
async function insightsTolerante(token: string, caminho: string, metricas: string[], extra: Record<string, string | number>, avisos?: string[], rotulo = "") {
  try {
    const r = await chamar<{ data: ItemInsight[] }>(token, caminho, { metric: metricas.join(","), ...extra });
    return r.data ?? [];
  } catch (e) {
    if (e instanceof ErroApi && e.reconectar) throw e;
  }
  const out: ItemInsight[] = [];
  for (const m of metricas) {
    try {
      const r = await chamar<{ data: ItemInsight[] }>(token, caminho, { metric: m, ...extra });
      out.push(...(r.data ?? []));
    } catch (e) {
      if (e instanceof ErroApi && e.reconectar) throw e;
      avisos?.push(`${rotulo}${m}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 220));
    }
  }
  return out;
}

// ── (a) Métricas da conta por dia ──────────────────────────────────────────
const METRICAS_CONTA = ["reach", "views", "profile_views", "profile_links_taps", "accounts_engaged", "total_interactions", "likes", "comments", "shares", "saves"];

async function coletarContaPorDia(token: string, ig: string, contaId: string, dias: number, avisos: string[]): Promise<number> {
  const hoje = chaveDia(new Date());
  const todas: Date[] = [];
  for (let i = 0; i < dias; i++) todas.push(new Date(hoje.getTime() - i * DIA_MS));
  // Dias já gravados ficam como estão, exceto os 3 mais recentes (a Meta atrasa até 48h e corrige depois).
  const existentes = await prisma.socialMetricaConta.findMany({ where: { contaId, data: { gte: todas[todas.length - 1] } }, select: { data: true } });
  const jaTem = new Set(existentes.map((e) => e.data.getTime()));
  const faltam = todas.filter((d, i) => i < 3 || !jaTem.has(d.getTime()));
  let gravados = 0;
  let falhas = 0;
  await emLotes(faltam, 4, async (dia) => {
    const since = inicioDoDia(dia);
    try {
      const itens = await insightsTolerante(token, `${ig}/insights`, METRICAS_CONTA, { metric_type: "total_value", period: "day", since, until: since + 86_399 });
      if (!itens.length) {
        falhas++;
        return;
      }
      const m = mapa(itens);
      const dados = {
        alcance: numero(m.reach),
        visualizacoes: numero(m.views),
        visitasPerfil: numero(m.profile_views),
        toquesLink: numero(m.profile_links_taps),
        contasEngajadas: numero(m.accounts_engaged),
        interacoes: numero(m.total_interactions),
        curtidas: numero(m.likes),
        comentarios: numero(m.comments),
        compartilhamentos: numero(m.shares),
        salvamentos: numero(m.saves),
        bruto: JSON.stringify(itens),
        coletadoEm: new Date(),
      };
      await prisma.socialMetricaConta.upsert({ where: { contaId_data: { contaId, data: dia } }, create: { contaId, data: dia, ...dados }, update: dados });
      gravados++;
    } catch (e) {
      if (e instanceof ErroApi && e.reconectar) throw e;
      falhas++;
    }
  });
  if (falhas) avisos.push(`Métricas da conta: ${falhas} dia(s) sem dados (a Meta pode demorar até 48h para fechar o dia).`);
  // Total de seguidores de hoje.
  try {
    const perfil = await chamar<{ followers_count?: number }>(token, ig, { fields: "followers_count" });
    if (typeof perfil.followers_count === "number")
      await prisma.socialMetricaConta.upsert({
        where: { contaId_data: { contaId, data: hoje } },
        create: { contaId, data: hoje, seguidores: perfil.followers_count },
        update: { seguidores: perfil.followers_count },
      });
  } catch (e) {
    if (e instanceof ErroApi && e.reconectar) throw e;
    avisos.push("Não consegui ler o total de seguidores.");
  }
  return gravados;
}

// ── (b) Mídias + insights de cada uma ─────────────────────────────────────
type MidiaApi = {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  timestamp?: string;
  thumbnail_url?: string;
  media_url?: string;
  like_count?: number;
  comments_count?: number;
};

function normalizarTipo(m: MidiaApi): TipoPost {
  if (m.media_product_type === "STORY") return "story";
  if (m.media_product_type === "REELS" || m.media_product_type === "REEL") return "reel";
  if (m.media_type === "CAROUSEL_ALBUM") return "carrossel";
  if (m.media_type === "VIDEO") return "reel"; // vídeos do feed hoje são tratados como reels pelo Instagram
  return "foto";
}

const CAMPOS_MIDIA = "id,caption,media_type,media_product_type,permalink,timestamp,thumbnail_url,media_url,like_count,comments_count";
const METRICAS_POR_TIPO: Record<TipoPost, string[]> = {
  foto: ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions", "follows", "profile_visits"],
  carrossel: ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions", "follows", "profile_visits"],
  reel: ["reach", "views", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time", "ig_reels_video_view_total_time"],
  story: ["reach", "views", "shares", "total_interactions", "replies", "follows", "profile_visits"],
};

async function listarMidias(token: string, ig: string, dias: number): Promise<MidiaApi[]> {
  const limite = Date.now() - dias * DIA_MS;
  const out: MidiaApi[] = [];
  let r = await chamar<{ data: MidiaApi[]; paging?: { next?: string } }>(token, `${ig}/media`, { fields: CAMPOS_MIDIA, limit: 50 });
  for (let pag = 0; pag < 6; pag++) {
    let passou = false;
    for (const m of r.data ?? []) {
      if (m.timestamp && parseData(m.timestamp).getTime() < limite) passou = true;
      else out.push(m);
    }
    if (passou || !r.paging?.next || out.length >= 200) break;
    // O endereço "next" já traz os parâmetros; o token vai no cabeçalho.
    const prox = new URL(r.paging.next);
    prox.searchParams.delete("access_token");
    const res = await fetch(prox, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (!res.ok) break;
    r = await res.json();
  }
  return out;
}

async function coletarMidias(token: string, ig: string, contaId: string, dias: number, avisos: string[]): Promise<number> {
  const midias = await listarMidias(token, ig, dias);
  // Stories (a API só devolve os das últimas 24h).
  try {
    const st = await chamar<{ data: MidiaApi[] }>(token, `${ig}/stories`, { fields: CAMPOS_MIDIA });
    for (const s of st.data ?? []) if (!midias.some((m) => m.id === s.id)) midias.push({ ...s, media_product_type: "STORY" });
  } catch (e) {
    if (e instanceof ErroApi && e.reconectar) throw e;
  }
  let gravados = 0;
  let semInsights = 0;
  await emLotes(midias, 4, async (m) => {
    if (!m.timestamp) return;
    const tipo = normalizarTipo(m);
    const quando = parseData(m.timestamp);
    const local = partesBr(quando);
    const avisosItem: string[] = [];
    let itens: ItemInsight[] = [];
    try {
      itens = await insightsTolerante(token, `${m.id}/insights`, METRICAS_POR_TIPO[tipo], {}, avisosItem, `${m.id} `);
    } catch (e) {
      if (e instanceof ErroApi && e.reconectar) throw e;
    }
    // Cliques no link da bio gerados pelo post (profile_activity detalhado por ação).
    let cliquesBio = 0;
    let atividade: ItemInsight[] = [];
    if (tipo !== "reel") {
      try {
        const r = await chamar<{ data: ItemInsight[] }>(token, `${m.id}/insights`, { metric: "profile_activity", breakdown: "action_type" });
        atividade = r.data ?? [];
        cliquesBio = resultados(atividade[0]).find((x) => x.chave.toUpperCase().includes("BIO_LINK_CLICKED"))?.valor ?? 0;
      } catch (e) {
        if (e instanceof ErroApi && e.reconectar) throw e;
      }
    }
    if (!itens.length) semInsights++;
    const x = mapa(itens);
    const curtidas = x.likes ? numero(x.likes) : (m.like_count ?? 0);
    const comentarios = x.comments ? numero(x.comments) : (m.comments_count ?? 0);
    const compartilhamentos = numero(x.shares);
    const salvamentos = numero(x.saved);
    const interacoes = x.total_interactions ? numero(x.total_interactions) : curtidas + comentarios + compartilhamentos + salvamentos;
    const tempoMs = x.ig_reels_avg_watch_time ? numero(x.ig_reels_avg_watch_time) : null;
    const dados = {
      tipo,
      legenda: (m.caption ?? "").slice(0, 2200),
      permalink: m.permalink ?? null,
      miniatura: m.thumbnail_url ?? m.media_url ?? null,
      publicadoEm: quando,
      hora: local.hora,
      diaSemana: local.diaSemana,
      alcance: numero(x.reach),
      visualizacoes: numero(x.views),
      curtidas,
      comentarios,
      compartilhamentos,
      salvamentos,
      interacoes,
      seguidoresGanhos: numero(x.follows),
      visitasPerfil: numero(x.profile_visits),
      cliquesLinkBio: cliquesBio,
      tempoMedioAssistidoSeg: tempoMs == null ? null : tempoMs / 1000,
      bruto: JSON.stringify({ midia: m, insights: itens, profile_activity: atividade, avisos: avisosItem }),
      coletadoEm: new Date(),
    };
    await prisma.socialMetricaPost.upsert({ where: { contaId_externoId: { contaId, externoId: m.id } }, create: { contaId, externoId: m.id, ...dados }, update: dados });
    gravados++;
  });
  if (semInsights) avisos.push(`${semInsights} mídia(s) sem insights (a Meta não entrega insights de algumas mídias antigas ou de itens de álbum).`);
  return gravados;
}

// ── (c) Público ────────────────────────────────────────────────────────────
const RECORTES = ["age", "gender", "city", "country"] as const;
const GRUPOS_PUBLICO: { chave: string; metrica: string; extra: Record<string, string> }[] = [
  { chave: "seguidores", metrica: "follower_demographics", extra: {} },
  { chave: "engajados", metrica: "engaged_audience_demographics", extra: { timeframe: "last_90_days" } },
  { chave: "alcancados", metrica: "reached_audience_demographics", extra: { timeframe: "last_90_days" } },
];

async function coletarPublico(token: string, ig: string, contaId: string, avisos: string[]): Promise<boolean> {
  const grupos: Record<string, Record<string, { chave: string; valor: number }[]>> = {};
  const av: string[] = [];
  let algum = false;
  for (const g of GRUPOS_PUBLICO) {
    grupos[g.chave] = {};
    for (const rec of RECORTES) {
      try {
        const r = await chamar<{ data: ItemInsight[] }>(token, `${ig}/insights`, { metric: g.metrica, period: "lifetime", metric_type: "total_value", breakdown: rec, ...g.extra });
        const lista = resultados(r.data?.[0]).sort((a, b) => b.valor - a.valor);
        grupos[g.chave][rec] = lista;
        if (lista.length) algum = true;
      } catch (e) {
        if (e instanceof ErroApi && e.reconectar) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        if (!av.some((x) => x.startsWith(g.chave)))
          av.push(`${g.chave}: ${/100|minimum|mínimo|enough/i.test(msg) ? "indisponível (a Meta exige pelo menos 100 seguidores/engajamentos)" : msg}`.slice(0, 240));
      }
    }
  }
  avisos.push(...av.map((a) => `Público — ${a}`));
  if (!algum && !av.length) avisos.push("Público: a Meta não devolveu dados demográficos (conta com menos de 100 seguidores?).");
  const data = chaveDia(new Date());
  const dados = { bruto: JSON.stringify({ ...grupos, avisos: av }), coletadoEm: new Date() };
  await prisma.socialMetricaPublico.upsert({ where: { contaId_data: { contaId, data } }, create: { contaId, data, ...dados }, update: dados });
  return algum;
}

// ── Entrada ────────────────────────────────────────────────────────────────
export async function coletarInstagram(contaId: string, opcoes?: { dias?: number }): Promise<ResultadoColeta> {
  const dias = Math.min(Math.max(opcoes?.dias ?? 30, 1), 90);
  const base: ResultadoColeta = { contaId, rede: "instagram", dias, diasGravados: 0, postsGravados: 0, publicoGravado: false, avisos: [] };
  const conta = await abrirConta(contaId);
  if (!conta || conta.rede !== "instagram") return { ...base, erro: "Conta do Instagram não encontrada ou desativada." };
  const token = conta.accessToken;
  const ig = conta.externoId;
  try {
    base.diasGravados = await coletarContaPorDia(token, ig, contaId, dias, base.avisos);
    // Posts: sempre os últimos 90 dias (janela da análise de horário e formato).
    base.postsGravados = await coletarMidias(token, ig, contaId, 90, base.avisos);
    base.publicoGravado = await coletarPublico(token, ig, contaId, base.avisos);
  } catch (e) {
    if (e instanceof ErroApi) return { ...base, erro: e.message, precisaReconectar: e.reconectar };
    return { ...base, erro: e instanceof Error ? e.message : String(e) };
  }
  return base;
}
