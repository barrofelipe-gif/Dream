import "server-only";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { abrirConta } from "@/lib/social/contas";
import { FB_GRAPH } from "@/lib/social/facebook";
import { tokenValido, YT_ESCOPO_COMENTAR } from "@/lib/social/youtube";

/**
 * Comentários nas publicações das marcas (aba "Responder comentários").
 * Lê ao vivo em cada rede e responde só quando a equipe clica em Enviar.
 * Instagram usa a conta do robô (já tem instagram_business_manage_comments);
 * Facebook e YouTube usam as contas do publicador (SocialConta).
 */

const IG = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;
const YT = "https://www.googleapis.com/youtube/v3";
const LIMITE_MS = 15_000; // por chamada
const PRAZO_LISTA_MS = 40_000; // a listagem inteira: a rota tem 60 s e precisa de folga para responder

export type RedeComentario = "instagram" | "facebook" | "youtube";
export const REDES_COMENTARIO: RedeComentario[] = ["instagram", "facebook", "youtube"];

export type Resposta = { autor: string; texto: string; em: string; nossa: boolean };
export type Comentario = {
  rede: RedeComentario;
  loja: string;
  contaId: string;
  contaNome: string;
  id: string;
  texto: string;
  autor: string;
  em: string;
  oculto: boolean;
  podeOcultar: boolean;
  respondido: boolean;
  respostas: Resposta[];
  post: { id: string; legenda: string; miniatura: string | null; link: string | null };
};
export type ContaStatus = {
  contaId: string;
  rede: RedeComentario;
  loja: string;
  nome: string;
  ler: boolean;
  responder: boolean;
  aviso?: string;
};

class ErroRede extends Error {}

/** Chamada HTTP com limite de tempo e erro em português. */
async function chamar<T>(rede: RedeComentario, url: string, init: RequestInit & { token: string; ate?: number }): Promise<T> {
  const { token, ate, ...resto } = init;
  // Respeita o prazo total da listagem (ate) além do limite por chamada.
  const resta = ate ? Math.min(LIMITE_MS, ate - Date.now()) : LIMITE_MS;
  if (resta < 1000) throw new ErroRede(`Sem tempo para ler mais de ${NOME[rede]}; mostrando o que deu.`);
  let res: Response;
  try {
    res = await fetch(url, {
      ...resto,
      headers: { Authorization: `Bearer ${token}`, ...(resto.headers ?? {}) },
      cache: "no-store",
      signal: AbortSignal.timeout(resta),
    });
  } catch (e) {
    const tempo = e instanceof Error && /timeout|abort/i.test(e.name + e.message);
    throw new ErroRede(tempo ? `${NOME[rede]} demorou demais para responder. Tente de novo.` : `Não consegui falar com ${NOME[rede]}.`);
  }
  const texto = await res.text();
  if (!res.ok) throw new ErroRede(traduzir(rede, res.status, texto));
  return (texto ? JSON.parse(texto) : {}) as T;
}

const NOME: Record<RedeComentario, string> = { instagram: "o Instagram", facebook: "o Facebook", youtube: "o YouTube" };
const ROTULO: Record<RedeComentario, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };

function traduzir(rede: RedeComentario, status: number, texto: string): string {
  let msg = texto.slice(0, 200);
  let codigo: number | undefined;
  let motivo: string | undefined;
  try {
    const j = JSON.parse(texto) as { error?: { message?: string; code?: number; errors?: { reason?: string }[] } };
    msg = j.error?.message ?? msg;
    codigo = j.error?.code;
    motivo = j.error?.errors?.[0]?.reason;
  } catch {
    /* texto cru */
  }
  const r = ROTULO[rede];
  if (rede === "youtube") {
    if (motivo === "quotaExceeded") return "A cota diária do YouTube acabou. Tente amanhã.";
    if (motivo === "commentsDisabled") return "Os comentários estão desligados neste vídeo.";
    if (status === 401) return "O acesso ao YouTube venceu. Reconecte a conta do YouTube.";
    if (status === 403 || /insufficient|scope|permission/i.test(msg))
      return `Falta permissão no YouTube. Reconecte a conta do YouTube aceitando todas as permissões. (${motivo ?? msg.slice(0, 120)})`;
  } else {
    if (codigo === 190) return `O acesso ao ${r} venceu. Reconecte a conta do ${r}.`;
    if (codigo === 10 || codigo === 200 || codigo === 3 || /permission|permiss/i.test(msg))
      return `Falta permissão no ${r} para comentários. Reconecte a conta do ${r} aceitando todas as permissões.`;
    if (codigo === 4 || codigo === 17 || codigo === 32 || codigo === 613) return `O ${r} limitou as chamadas por um tempo. Espere alguns minutos.`;
    if (codigo === 100 && /does not exist|cannot be loaded|Unsupported/i.test(msg)) return `O comentário não existe mais no ${r} (pode ter sido apagado).`;
  }
  return `${r} recusou (${status}): ${msg}`;
}

/** Faz as tarefas com no máximo `n` ao mesmo tempo. */
async function emLotes<T, R>(itens: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const saida: R[] = new Array(itens.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, itens.length) }, async () => {
      while (i < itens.length) {
        const k = i++;
        saida[k] = await fn(itens[k]);
      }
    }),
  );
  return saida;
}

// ── Contas ──────────────────────────────────────────────────────────────────
type ContaInterna = { status: ContaStatus; token: () => Promise<string>; externoId: string; username: string | null };

async function carregarContas(loja?: string, rede?: RedeComentario): Promise<ContaInterna[]> {
  const contas: ContaInterna[] = [];
  if (!rede || rede === "instagram") {
    const igs = await prisma.instagramAccount.findMany({ where: { active: true, ...(loja ? { loja } : {}) }, orderBy: { createdAt: "asc" } });
    for (const c of igs) {
      contas.push({
        status: { contaId: c.id, rede: "instagram", loja: c.loja, nome: c.username ? `@${c.username}` : "Instagram", ler: true, responder: true },
        token: async () => decrypt(c.accessToken),
        externoId: c.igUserId,
        username: c.username,
      });
    }
  }
  if (rede === "instagram") return contas;
  const outras = await prisma.socialConta.findMany({
    where: { ativo: true, rede: rede ?? { in: ["facebook", "youtube"] }, ...(loja ? { loja } : {}) },
    orderBy: { createdAt: "asc" },
    select: { id: true, rede: true, loja: true, nome: true, username: true, externoId: true, escopos: true },
  });
  for (const c of outras) {
    const r = c.rede as RedeComentario;
    const podeResponder = r === "youtube" ? c.escopos.split(/[\s,]+/).includes(YT_ESCOPO_COMENTAR) : true;
    contas.push({
      status: {
        contaId: c.id,
        rede: r,
        loja: c.loja,
        nome: c.nome ?? c.username ?? ROTULO[r],
        ler: true,
        responder: podeResponder,
        aviso: podeResponder ? undefined : "Para responder pelo painel, reconecte a conta do YouTube (falta a permissão de comentar).",
      },
      token: async () => {
        const aberta = await abrirConta(c.id);
        if (!aberta) throw new ErroRede("Conta desconectada.");
        return r === "youtube" ? tokenValido(aberta) : aberta.accessToken;
      },
      externoId: c.externoId,
      username: c.username,
    });
  }
  return contas;
}

// ── Instagram ───────────────────────────────────────────────────────────────
type IgMidia = { id: string; caption?: string; media_type?: string; thumbnail_url?: string; media_url?: string; permalink?: string; comments_count?: number };
type IgComentario = {
  id: string;
  text?: string;
  timestamp?: string;
  username?: string;
  from?: { id?: string; username?: string };
  hidden?: boolean;
  replies?: { data?: IgComentario[] };
};

type Lido = { comentarios: Comentario[]; parcial?: string };

async function lerInstagram(c: ContaInterna, porPost: number, ate: number): Promise<Lido> {
  const token = await c.token();
  const midias = await chamar<{ data?: IgMidia[] }>("instagram", `${IG}/me/media?fields=id,caption,media_type,thumbnail_url,media_url,permalink,comments_count&limit=15`, { token, ate });
  const comComentario = (midias.data ?? []).filter((m) => (m.comments_count ?? 0) > 0).slice(0, 12);
  const nossa = (x: IgComentario) =>
    (!!x.from?.id && x.from.id === c.externoId) || (!!c.username && (x.username ?? x.from?.username) === c.username);
  let falhas = 0;
  let parcialRespostas = false;
  // 1) Comentários de todas as publicações primeiro (o mais importante cabe no prazo).
  const porMidia = await emLotes(comComentario, 6, async (m) => {
    const campos = "id,text,timestamp,username,from,hidden,replies{id}";
    try {
      const r = await chamar<{ data?: IgComentario[] }>("instagram", `${IG}/${m.id}/comments?fields=${encodeURIComponent(campos)}&limit=${porPost}`, { token, ate });
      return { m, topo: (r.data ?? []).filter((x) => !nossa(x)) };
    } catch (e) {
      // Uma publicação que falha não derruba as outras; se todas falharem, o erro sobe.
      falhas++;
      if (falhas === comComentario.length) throw e;
      return { m, topo: [] as IgComentario[] };
    }
  });
  // 2) Com o tempo que sobra, as respostas de cada comentário (as aninhadas vêm sem autor),
  //    página a página até achar a da marca, para saber se já respondemos.
  const comResposta = porMidia.flatMap((p) => p.topo).filter((x) => (x.replies?.data?.length ?? 0) > 0);
  await emLotes(comResposta, 6, async (x) => {
    const todas: IgComentario[] = [];
    let url: string | null = `${IG}/${x.id}/replies?fields=id,text,timestamp,username,from&limit=50`;
    try {
      for (let pg = 0; url && pg < 4; pg++) {
        const rr: { data?: IgComentario[]; paging?: { next?: string } } = await chamar("instagram", url, { token, ate });
        todas.push(...(rr.data ?? []));
        if (todas.some(nossa)) break;
        url = rr.paging?.next ?? null;
      }
      if (url && !todas.some(nossa)) parcialRespostas = true;
      x.replies = { data: todas };
    } catch {
      parcialRespostas = true;
      x.replies = { data: todas };
    }
  });
  const comentarios = porMidia.flatMap(({ m, topo }) =>
    topo.map((x): Comentario => {
      const respostas = (x.replies?.data ?? []).map((y) => ({
        autor: y.username ?? y.from?.username ?? "",
        texto: y.text ?? "",
        em: y.timestamp ?? "",
        nossa: nossa(y),
      }));
      return {
        rede: "instagram",
        loja: c.status.loja,
        contaId: c.status.contaId,
        contaNome: c.status.nome,
        id: x.id,
        texto: x.text ?? "",
        autor: x.username ?? x.from?.username ?? "alguém",
        em: x.timestamp ?? "",
        oculto: !!x.hidden,
        podeOcultar: true,
        respondido: respostas.some((y) => y.nossa),
        respostas,
        post: { id: m.id, legenda: (m.caption ?? "").slice(0, 300), miniatura: m.thumbnail_url ?? m.media_url ?? null, link: m.permalink ?? null },
      };
    }),
  );
  const avisos = [
    falhas ? `Não consegui ler ${falhas} publicação(ões); a lista pode estar incompleta.` : "",
    parcialRespostas ? "Algumas respostas não carregaram; confira antes de responder de novo." : "",
  ].filter(Boolean);
  return { comentarios, parcial: avisos.join(" ") || undefined };
}

// ── Facebook ────────────────────────────────────────────────────────────────
type FbComentario = {
  id: string;
  message?: string;
  created_time?: string;
  from?: { id?: string; name?: string };
  is_hidden?: boolean;
  can_hide?: boolean;
  comments?: { data?: FbComentario[] };
};
type FbPost = { id: string; message?: string; permalink_url?: string; full_picture?: string; comments?: { data?: FbComentario[] } };

async function lerFacebook(c: ContaInterna, porPost: number, ate: number): Promise<Lido> {
  const token = await c.token();
  const sub = `comments.order(reverse_chronological).limit(${porPost}){id,message,created_time,from,is_hidden,can_hide,comments.limit(10){id,message,created_time,from}}`;
  const campos = `id,message,permalink_url,full_picture,${sub}`;
  const r = await chamar<{ data?: FbPost[] }>("facebook", `${FB_GRAPH}/${c.externoId}/published_posts?fields=${encodeURIComponent(campos)}&limit=12`, { token, ate });
  const nossa = (x: FbComentario) => x.from?.id === c.externoId;
  const comentarios = (r.data ?? []).flatMap((p) =>
    (p.comments?.data ?? [])
      .filter((x) => !nossa(x))
      .map((x): Comentario => {
        const respostas = (x.comments?.data ?? []).map((y) => ({ autor: y.from?.name ?? "", texto: y.message ?? "", em: y.created_time ?? "", nossa: nossa(y) }));
        return {
          rede: "facebook",
          loja: c.status.loja,
          contaId: c.status.contaId,
          contaNome: c.status.nome,
          id: x.id,
          texto: x.message ?? "",
          autor: x.from?.name ?? "alguém",
          em: x.created_time ?? "",
          oculto: !!x.is_hidden,
          podeOcultar: x.can_hide !== false,
          respondido: respostas.some((y) => y.nossa),
          respostas,
          post: { id: p.id, legenda: (p.message ?? "").slice(0, 300), miniatura: p.full_picture ?? null, link: p.permalink_url ?? null },
        };
      }),
  );
  return { comentarios };
}

// ── YouTube ─────────────────────────────────────────────────────────────────
type YtComentario = { id: string; snippet?: { textOriginal?: string; textDisplay?: string; authorDisplayName?: string; authorChannelId?: { value?: string }; publishedAt?: string } };
type YtThread = {
  id: string;
  snippet?: { videoId?: string; channelId?: string; topLevelComment?: YtComentario; canReply?: boolean; totalReplyCount?: number };
  replies?: { comments?: YtComentario[] };
};

async function lerYoutube(c: ContaInterna, total: number, ate: number): Promise<Lido> {
  const token = await c.token();
  const r = await chamar<{ items?: YtThread[] }>(
    "youtube",
    `${YT}/commentThreads?part=snippet,replies&allThreadsRelatedToChannelId=${encodeURIComponent(c.externoId)}&order=time&maxResults=${Math.min(total, 100)}&textFormat=plainText`,
    { token, ate },
  );
  const threads = r.items ?? [];
  const nossa = (x?: YtComentario) => x?.snippet?.authorChannelId?.value === c.externoId;
  // A lista traz só parte das respostas: quando há mais e a nossa não veio, busca as respostas desse comentário.
  const incompletos = threads
    .filter((t) => (t.snippet?.totalReplyCount ?? 0) > (t.replies?.comments?.length ?? 0) && !(t.replies?.comments ?? []).some(nossa))
    .slice(0, 15);
  let parcial: string | undefined;
  await emLotes(incompletos, 5, async (t) => {
    try {
      const rr = await chamar<{ items?: YtComentario[] }>("youtube", `${YT}/comments?part=snippet&parentId=${encodeURIComponent(t.id)}&maxResults=100&textFormat=plainText`, { token, ate });
      t.replies = { comments: rr.items ?? [] };
    } catch {
      parcial = "Algumas respostas do YouTube não carregaram; confira antes de responder de novo.";
    }
  });
  const ids = [...new Set(threads.map((t) => t.snippet?.videoId).filter((v): v is string => !!v))].slice(0, 50);
  const titulos = new Map<string, string>();
  if (ids.length) {
    try {
      const v = await chamar<{ items?: { id: string; snippet?: { title?: string } }[] }>("youtube", `${YT}/videos?part=snippet&id=${ids.join(",")}`, { token, ate });
      for (const it of v.items ?? []) titulos.set(it.id, it.snippet?.title ?? "");
    } catch {
      /* sem título: segue só com o link */
    }
  }
  const comentarios = threads
    .filter((t) => t.snippet?.topLevelComment && !nossa(t.snippet.topLevelComment))
    .map((t): Comentario => {
      const top = t.snippet!.topLevelComment!;
      const vid = t.snippet?.videoId ?? "";
      const respostas = (t.replies?.comments ?? []).map((y) => ({
        autor: y.snippet?.authorDisplayName ?? "",
        texto: y.snippet?.textOriginal ?? y.snippet?.textDisplay ?? "",
        em: y.snippet?.publishedAt ?? "",
        nossa: nossa(y),
      }));
      return {
        rede: "youtube",
        loja: c.status.loja,
        contaId: c.status.contaId,
        contaNome: c.status.nome,
        // Responder no YouTube usa o id do comentário principal (parentId).
        id: top.id,
        texto: top.snippet?.textOriginal ?? top.snippet?.textDisplay ?? "",
        autor: top.snippet?.authorDisplayName ?? "alguém",
        em: top.snippet?.publishedAt ?? "",
        oculto: false,
        podeOcultar: false,
        respondido: respostas.some((y) => y.nossa),
        respostas,
        post: {
          id: vid,
          legenda: titulos.get(vid) ?? "",
          miniatura: vid ? `https://i.ytimg.com/vi/${vid}/mqdefault.jpg` : null,
          link: vid ? `https://www.youtube.com/watch?v=${vid}&lc=${top.id}` : null,
        },
      };
    });
  return { comentarios, parcial };
}

/** Comentários recentes de todas as contas pedidas, mais novos primeiro, e a situação de cada conta. */
export async function listarComentarios(filtro: { loja?: string; rede?: RedeComentario }): Promise<{ comentarios: Comentario[]; contas: ContaStatus[] }> {
  const contas = await carregarContas(filtro.loja, filtro.rede);
  const ate = Date.now() + PRAZO_LISTA_MS;
  const resultados = await Promise.allSettled(
    contas.map((c) => (c.status.rede === "instagram" ? lerInstagram(c, 30, ate) : c.status.rede === "facebook" ? lerFacebook(c, 25, ate) : lerYoutube(c, 60, ate))),
  );
  const comentarios: Comentario[] = [];
  resultados.forEach((r, i) => {
    if (r.status === "fulfilled") {
      comentarios.push(...r.value.comentarios);
      if (r.value.parcial) contas[i].status.aviso = [contas[i].status.aviso, r.value.parcial].filter(Boolean).join(" ");
    } else {
      const st = contas[i].status;
      st.ler = false;
      st.responder = false;
      st.aviso = r.reason instanceof ErroRede ? r.reason.message : `Falha ao ler ${NOME[st.rede]}.`;
      if (!(r.reason instanceof ErroRede)) console.error("[comentarios] leitura", st.rede, r.reason);
    }
  });
  comentarios.sort((a, b) => (b.em || "").localeCompare(a.em || ""));
  return { comentarios: comentarios.slice(0, 300), contas: contas.map((c) => c.status) };
}

/** Acha a conta (e a loja dela) pelo id e pela rede; nunca mistura BFF com Moranga. */
export async function contaPorId(rede: RedeComentario, contaId: string): Promise<ContaInterna | null> {
  const todas = await carregarContas(undefined, rede);
  return todas.find((c) => c.status.contaId === contaId) ?? null;
}

const idValido = (id: string) => /^[\w.\-:]{3,200}$/.test(id);

/**
 * Confere que o comentário é de uma publicação DESTA conta antes de responder ou ocultar
 * (o token de uma Página ou canal consegue comentar em conteúdo público de outros, e BFF e Moranga não se misturam).
 * Instagram: o token do Instagram Login só enxerga objetos da própria conta; a própria API recusa os de outras.
 */
async function conferirDono(c: ContaInterna, token: string, comentarioId: string): Promise<void> {
  const rede = c.status.rede;
  if (rede === "facebook") {
    // Id de comentário em post de Página: "<numero do post>_<numero do comentário>"; o post é "<id da Página>_<numero do post>".
    const numPost = comentarioId.split("_")[0];
    try {
      const p = await chamar<{ id?: string }>("facebook", `${FB_GRAPH}/${c.externoId}_${numPost}?fields=id`, { token });
      if (p.id === `${c.externoId}_${numPost}`) return;
    } catch {
      /* cai no erro abaixo */
    }
    throw new ErroRede("Este comentário não é de uma publicação desta Página.");
  }
  if (rede === "youtube") {
    const t = await chamar<{ items?: YtThread[] }>("youtube", `${YT}/commentThreads?part=snippet&id=${encodeURIComponent(comentarioId)}`, { token });
    if (t.items?.[0]?.snippet?.channelId !== c.externoId) throw new ErroRede("Este comentário não é de um vídeo deste canal.");
  }
}

/** Publica a resposta embaixo do comentário. Só chamado quando a equipe clica em Enviar. */
export async function responderComentario(rede: RedeComentario, contaId: string, comentarioId: string, texto: string): Promise<{ id?: string }> {
  if (!idValido(comentarioId)) throw new ErroRede("Comentário inválido.");
  const c = await contaPorId(rede, contaId);
  if (!c) throw new ErroRede("Conta não encontrada ou desconectada.");
  if (!c.status.responder) throw new ErroRede(c.status.aviso ?? "Esta conta não pode responder pelo painel.");
  const token = await c.token();
  await conferirDono(c, token, comentarioId);
  if (rede === "instagram") {
    return chamar<{ id?: string }>("instagram", `${IG}/${comentarioId}/replies`, {
      token,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: texto }),
    });
  }
  if (rede === "facebook") {
    return chamar<{ id?: string }>("facebook", `${FB_GRAPH}/${comentarioId}/comments`, { token, method: "POST", body: new URLSearchParams({ message: texto }) });
  }
  return chamar<{ id?: string }>("youtube", `${YT}/comments?part=snippet`, {
    token,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { parentId: comentarioId, textOriginal: texto } }),
  });
}

/** Oculta (ou mostra de novo) um comentário. Só Instagram e Facebook; nada é apagado. */
export async function ocultarComentario(rede: RedeComentario, contaId: string, comentarioId: string, ocultar: boolean): Promise<void> {
  if (!idValido(comentarioId)) throw new ErroRede("Comentário inválido.");
  if (rede === "youtube") throw new ErroRede("Ocultar não está disponível para o YouTube.");
  const c = await contaPorId(rede, contaId);
  if (!c) throw new ErroRede("Conta não encontrada ou desconectada.");
  const token = await c.token();
  await conferirDono(c, token, comentarioId);
  if (rede === "instagram") {
    await chamar("instagram", `${IG}/${comentarioId}?hide=${ocultar}`, { token, method: "POST" });
  } else {
    await chamar("facebook", `${FB_GRAPH}/${comentarioId}`, { token, method: "POST", body: new URLSearchParams({ is_hidden: String(ocultar) }) });
  }
}

export { ErroRede };
