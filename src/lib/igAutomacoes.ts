import "server-only";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { buscarPerfil, enviarDm } from "@/lib/instagram";
import { aplicarNome } from "@/lib/igBoasVindas";

const GRAPH = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;

export const PREFIXO_POSTBACK = "AUT:";
const SEGUIR_PADRAO = "Para liberar, segue a gente aqui no Instagram e toca em \"Já segui\" que eu te mando agora.";
const AINDA_NAO_SEGUE = "Ainda não vi o seu follow por aqui. Segue a gente e toca em \"Já segui\" de novo que eu te mando.";

async function post(token: string, path: string, body: unknown): Promise<{ recipient_id?: string; message_id?: string; id?: string }> {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Meta ${res.status} em ${path}: ${(await res.text()).slice(0, 250)}`);
  return res.json();
}

type Botao = { tipo: "link"; titulo: string; url: string } | { tipo: "postback"; titulo: string; payload: string };

function mensagemComBotao(texto: string, botao?: Botao) {
  if (!botao) return { text: texto };
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: texto.slice(0, 640),
        buttons: [
          botao.tipo === "link"
            ? { type: "web_url", url: botao.url, title: botao.titulo.slice(0, 20) }
            : { type: "postback", title: botao.titulo.slice(0, 20), payload: botao.payload },
        ],
      },
    },
  };
}

/** Resposta privada a um comentário (abre a conversa no direct). Uma por comentário, em até 7 dias. */
async function respostaPrivada(token: string, igUserId: string, commentId: string, texto: string, botao?: Botao) {
  return post(token, `${igUserId}/messages`, { recipient: { comment_id: commentId }, message: mensagemComBotao(texto, botao) });
}

/** Direct para quem já está numa conversa, com botão de postback (usado para pedir o follow de novo). */
async function diretoComBotao(token: string, igUserId: string, userId: string, texto: string, botao?: Botao) {
  return post(token, `${igUserId}/messages`, { recipient: { id: userId }, message: mensagemComBotao(texto, botao) });
}

/** Resposta pública, embaixo do comentário. */
async function respostaPublica(token: string, commentId: string, texto: string) {
  return post(token, `${commentId}/replies`, { message: texto });
}

export function casaPalavra(texto: string, palavras: string, modo: string): boolean {
  const lista = palavras
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (lista.length === 0) return true; // sem palavras = qualquer comentário
  const t = texto.toLowerCase();
  const limpo = t.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return lista.some((p) => (modo === "exata" ? limpo === p || t.trim() === p : t.includes(p)));
}

export type ComentarioEvento = {
  contaId: string; // id da conta do Instagram (entry.id do webhook)
  commentId: string;
  texto: string;
  userId: string;
  username?: string;
  midiaId: string;
  parentId?: string;
};

async function registrarNaConversa(contaId: string, userId: string, entrada: string | null, saida: string, kind: string) {
  const conv = await prisma.igConversation.upsert({
    where: { accountId_igScopedUserId: { accountId: contaId, igScopedUserId: userId } },
    create: { accountId: contaId, igScopedUserId: userId },
    update: {},
  });
  if (entrada) {
    await prisma.igMessage.create({ data: { conversationId: conv.id, direction: "IN", source: "CLIENTE", text: entrada } });
  }
  await prisma.igMessage.create({
    data: { conversationId: conv.id, direction: "OUT", source: "BOT", text: saida, matchedKind: kind },
  });
}

/** Um comentário novo: se casa com uma automação ativa, responde em público e abre a conversa por DM. */
export async function processarComentario(ev: ComentarioEvento): Promise<void> {
  const conta = await prisma.instagramAccount.findUnique({ where: { igUserId: ev.contaId } });
  if (!conta?.active) return;
  if (ev.userId === conta.igUserId || ev.parentId) return; // próprio comentário ou resposta a comentário

  const candidatas = await prisma.igAutomacao.findMany({ where: { accountId: conta.id, ativo: true, tipo: "comentario" } });
  const alvo = candidatas
    .filter((a) => (a.midiaId === "" || a.midiaId === ev.midiaId) && casaPalavra(ev.texto, a.palavras, a.modoPalavra))
    .sort((a, b) => (b.midiaId ? 1 : 0) - (a.midiaId ? 1 : 0))[0];
  if (!alvo) return;

  // Um comentário só dispara uma vez (a Meta reenvia webhooks).
  try {
    await prisma.igAutomacaoExec.create({
      data: { automacaoId: alvo.id, commentId: ev.commentId, igUserId: ev.userId, username: ev.username },
    });
  } catch {
    return;
  }
  const token = decrypt(conta.accessToken);

  // 1) Resposta pública (uma das variantes)
  const variantes = alvo.respostasPublicas.split("\n").map((v) => v.trim()).filter(Boolean);
  if (variantes.length) {
    const v = variantes[Math.floor(Math.random() * variantes.length)];
    await respostaPublica(token, ev.commentId, v).catch((e) => console.warn("[ig-auto] resposta pública falhou", e.message));
  }

  // 2) DM (com ou sem a checagem de seguir)
  const nome = ev.username ?? null;
  const dm = aplicarNome(alvo.dmTexto, nome);
  const botaoLink: Botao | undefined = alvo.dmBotaoUrl ? { tipo: "link", titulo: alvo.dmBotaoTitulo || "Abrir", url: alvo.dmBotaoUrl } : undefined;

  let jaSegue = false;
  if (alvo.exigirSeguir) {
    const p = await buscarPerfil(conta.accessToken, ev.userId).catch(() => null);
    jaSegue = p?.seguePagina === true;
  }

  let enviado: string;
  let etapa = "enviado";
  if (alvo.exigirSeguir && !jaSegue) {
    enviado = aplicarNome(alvo.seguirTexto || SEGUIR_PADRAO, nome);
    await respostaPrivada(token, conta.igUserId, ev.commentId, enviado, {
      tipo: "postback",
      titulo: alvo.seguirBotao || "Já segui",
      payload: `${PREFIXO_POSTBACK}${alvo.id}`,
    });
    etapa = "aguardando_seguir";
  } else {
    enviado = dm;
    await respostaPrivada(token, conta.igUserId, ev.commentId, dm, botaoLink);
  }

  await prisma.igAutomacaoExec.update({
    where: { automacaoId_commentId: { automacaoId: alvo.id, commentId: ev.commentId } },
    data: { etapa },
  });
  await prisma.igAutomacao.update({ where: { id: alvo.id }, data: { execucoes: { increment: 1 } } });
  await registrarNaConversa(conta.id, ev.userId, `[Comentou] ${ev.texto}`, enviado, "automacao");
}

/** Toque em "Já segui": confere se segue; se sim libera o conteúdo, se não pede de novo. */
export async function processarPostbackAutomacao(contaId: string, userId: string, payload: string): Promise<void> {
  const autoId = payload.slice(PREFIXO_POSTBACK.length);
  const alvo = await prisma.igAutomacao.findUnique({ where: { id: autoId }, include: { account: true } });
  if (!alvo || alvo.account.igUserId !== contaId) return;
  const conta = alvo.account;
  const token = decrypt(conta.accessToken);

  // Falha aberta: se a Meta não informa o status, libera (não prende quem de fato segue).
  const perfil = await buscarPerfil(conta.accessToken, userId).catch(() => null);
  if (perfil?.seguePagina === false) {
    const msg = AINDA_NAO_SEGUE;
    await diretoComBotao(token, conta.igUserId, userId, msg, {
      tipo: "postback",
      titulo: alvo.seguirBotao || "Já segui",
      payload,
    });
    await registrarNaConversa(conta.id, userId, null, msg, "automacao_seguir");
    return;
  }

  const dm = aplicarNome(alvo.dmTexto, perfil?.nome ?? null);
  await enviarDm({
    igUserId: conta.igUserId,
    encryptedToken: conta.accessToken,
    recipientId: userId,
    text: dm,
    link: alvo.dmBotaoUrl ? { title: alvo.dmBotaoTitulo || "Abrir", url: alvo.dmBotaoUrl } : undefined,
  });
  await prisma.igAutomacaoExec.updateMany({
    where: { automacaoId: alvo.id, igUserId: userId, etapa: "aguardando_seguir" },
    data: { etapa: "liberado" },
  });
  await registrarNaConversa(conta.id, userId, null, dm, "automacao");
}

export type MidiaIg = {
  id: string;
  legenda: string;
  tipo: string;
  miniatura: string | null;
  link: string | null;
  em: string | null;
};

/** Últimas publicações e reels da conta (para escolher em qual publicação a automação vale). */
export async function listarMidias(encryptedToken: string): Promise<MidiaIg[]> {
  const token = decrypt(encryptedToken);
  const url = `${GRAPH}/me/media?fields=id,caption,media_type,media_product_type,thumbnail_url,media_url,permalink,timestamp&limit=24`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Meta ${res.status} ao listar mídias`);
  const j = (await res.json()) as {
    data?: {
      id: string;
      caption?: string;
      media_type?: string;
      media_product_type?: string;
      thumbnail_url?: string;
      media_url?: string;
      permalink?: string;
      timestamp?: string;
    }[];
  };
  return (j.data ?? []).map((m) => ({
    id: m.id,
    legenda: (m.caption ?? "").slice(0, 120),
    tipo: m.media_product_type === "REELS" ? "Reel" : m.media_type === "CAROUSEL_ALBUM" ? "Carrossel" : m.media_type === "VIDEO" ? "Vídeo" : "Foto",
    miniatura: m.thumbnail_url ?? m.media_url ?? null,
    link: m.permalink ?? null,
    em: m.timestamp ?? null,
  }));
}
