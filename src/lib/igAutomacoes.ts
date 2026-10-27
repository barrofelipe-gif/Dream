import "server-only";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { buscarPerfil, comLinksNoTexto, enviarDm } from "@/lib/instagram";
import { aplicarNome } from "@/lib/igBoasVindas";
import { cortarCaracteres, contemPalavra } from "@/lib/igTexto";
import { inscreverSeguidorBff } from "@/lib/igSequencias";

const GRAPH = `${process.env.IG_GRAPH_BASE ?? "https://graph.instagram.com"}/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;

export const PREFIXO_POSTBACK = "AUT:";
const SEGUIR_PADRAO = "Para liberar, segue a gente aqui no Instagram e toca em \"Já segui\" que eu te mando agora.";
const AINDA_NAO_SEGUE = "Vi que você ainda não seguiu a gente 😅 Segue o perfil e toca em \"Já segui\" de novo que eu te mando.";

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
  if (botao.tipo === "link") texto = comLinksNoTexto(texto, [{ url: botao.url }]);
  return {
    attachment: {
      type: "template",
      payload: {
        template_type: "button",
        text: cortarCaracteres(texto, 640),
        buttons: [
          botao.tipo === "link"
            ? { type: "web_url", url: botao.url, title: cortarCaracteres(botao.titulo, 20) }
            : { type: "postback", title: cortarCaracteres(botao.titulo, 20), payload: botao.payload },
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
  // "contém" casa palavra inteira e ignora acento ("oi" não casa dentro de "hoje").
  return lista.some((p) => (modo === "exata" ? limpo === p || t.trim() === p : contemPalavra(texto, p)));
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

async function registrarNaConversa(contaId: string, userId: string, entrada: string | null, saida: string, kind: string, metaMessageId?: string | null) {
  const conv = await prisma.igConversation.upsert({
    where: { accountId_igScopedUserId: { accountId: contaId, igScopedUserId: userId } },
    create: { accountId: contaId, igScopedUserId: userId },
    update: {},
  });
  if (entrada) {
    await prisma.igMessage.create({ data: { conversationId: conv.id, direction: "IN", source: "CLIENTE", text: entrada } });
  }
  await prisma.igMessage.create({
    data: { conversationId: conv.id, direction: "OUT", source: "BOT", text: saida, matchedKind: kind, metaMessageId: metaMessageId || null },
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

  // A mesma pessoa não dispara a mesma automação de novo em 24 h (comentar várias vezes ou em várias mídias).
  const jaDisparou = await prisma.igAutomacaoExec.findFirst({
    where: { automacaoId: alvo.id, igUserId: ev.userId, createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    select: { id: true },
  });
  if (jaDisparou) return;

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
  let enviadoId: string | undefined;
  let etapa = "enviado";
  try {
    if (alvo.exigirSeguir && !jaSegue) {
      enviado = aplicarNome(alvo.seguirTexto || SEGUIR_PADRAO, nome);
      enviadoId = (
        await respostaPrivada(token, conta.igUserId, ev.commentId, enviado, {
          tipo: "postback",
          titulo: alvo.seguirBotao || "Já segui",
          payload: `${PREFIXO_POSTBACK}${alvo.id}`,
        })
      ).message_id;
      etapa = "aguardando_seguir";
    } else {
      // Grava o mesmo texto que sai (com o endereço do botão escrito), para o eco da Meta reconhecer a mensagem do robô.
      enviado = botaoLink?.tipo === "link" ? comLinksNoTexto(dm, [{ url: botaoLink.url }]) : dm;
      enviadoId = (await respostaPrivada(token, conta.igUserId, ev.commentId, dm, botaoLink)).message_id;
    }
  } catch (e) {
    // A DM não saiu: libera o registro para um próximo comentário da pessoa tentar de novo (senão fica bloqueado 24 h).
    await prisma.igAutomacaoExec
      .delete({ where: { automacaoId_commentId: { automacaoId: alvo.id, commentId: ev.commentId } } })
      .catch(() => {});
    throw e;
  }

  // Grava a linha OUT logo após o envio (o eco da Meta chega rápido e precisa achar a linha do robô).
  await registrarNaConversa(conta.id, ev.userId, `[Comentou] ${ev.texto}`, enviado, "automacao", enviadoId);
  await prisma.igAutomacaoExec.update({
    where: { automacaoId_commentId: { automacaoId: alvo.id, commentId: ev.commentId } },
    data: { etapa },
  });
  await prisma.igAutomacao.update({ where: { id: alvo.id }, data: { execucoes: { increment: 1 } } });
}

/** Toque em "Já segui": confere se segue; se sim libera o conteúdo, se não pede de novo. */
export async function processarPostbackAutomacao(contaId: string, userId: string, payload: string): Promise<void> {
  const autoId = payload.slice(PREFIXO_POSTBACK.length);
  const alvo = await prisma.igAutomacao.findUnique({ where: { id: autoId }, include: { account: true } });
  if (!alvo || alvo.account.igUserId !== contaId) return;
  const conta = alvo.account;

  // Já liberado: toques repetidos em "Já segui" não reenviam o conteúdo.
  const liberado = await prisma.igAutomacaoExec.findFirst({
    where: { automacaoId: alvo.id, igUserId: userId, etapa: "liberado" },
    select: { id: true },
  });
  if (liberado) return;
  const token = decrypt(conta.accessToken);

  // Falha aberta: se a Meta não informa o status, libera (não prende quem de fato segue).
  const perfil = await buscarPerfil(conta.accessToken, userId).catch(() => null);
  if (perfil?.seguePagina === false) {
    const msg = AINDA_NAO_SEGUE;
    // Não repete a cobrança se a mesma mensagem acabou de sair.
    const conv = await prisma.igConversation.findUnique({
      where: { accountId_igScopedUserId: { accountId: conta.id, igScopedUserId: userId } },
      select: { id: true },
    });
    if (conv) {
      const repetida = await prisma.igMessage.findFirst({
        where: { conversationId: conv.id, direction: "OUT", text: msg, createdAt: { gt: new Date(Date.now() - 2 * 60 * 1000) } },
        select: { id: true },
      });
      if (repetida) return;
    }
    const r = await diretoComBotao(token, conta.igUserId, userId, msg, {
      tipo: "postback",
      titulo: alvo.seguirBotao || "Já segui",
      payload,
    });
    await registrarNaConversa(conta.id, userId, null, msg, "automacao_seguir", r.message_id);
    return;
  }

  const dm = aplicarNome(alvo.dmTexto, perfil?.nome ?? null);
  // O mesmo texto que sai (com o endereço do botão) é o que fica gravado, para o eco da Meta reconhecer o robô.
  const textoDm = alvo.dmBotaoUrl ? comLinksNoTexto(dm, [{ url: alvo.dmBotaoUrl }]) : dm;
  const sentId = await enviarDm({
    igUserId: conta.igUserId,
    encryptedToken: conta.accessToken,
    recipientId: userId,
    text: textoDm,
    link: alvo.dmBotaoUrl ? { title: alvo.dmBotaoTitulo || "Abrir", url: alvo.dmBotaoUrl } : undefined,
  });
  await prisma.igAutomacaoExec.updateMany({
    where: { automacaoId: alvo.id, igUserId: userId, etapa: "aguardando_seguir" },
    data: { etapa: "liberado" },
  });
  await registrarNaConversa(conta.id, userId, null, textoDm, "automacao", sentId);
  // Confirmou que passou a seguir a BFF: entra nas boas-vindas de seguidor (app, cashback e aquecimento).
  if (conta.loja === "bff" && perfil?.seguePagina === true) {
    const conv = await prisma.igConversation.findUnique({
      where: { accountId_igScopedUserId: { accountId: conta.id, igScopedUserId: userId } },
      select: { id: true },
    });
    if (conv) await inscreverSeguidorBff(conta.id, conv.id).catch((e) => console.warn("[ig-auto] boas-vindas seguidor", e));
  }
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
