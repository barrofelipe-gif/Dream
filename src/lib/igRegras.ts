import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { dentroDaJanela, enviarDm } from "@/lib/instagram";
import { contemPalavra, normaliza } from "@/lib/igTexto";
import { roboPodeFalarConversa } from "@/lib/igEstado";
import { aplicarNome } from "@/lib/igBoasVindas";
import { notificarEquipe } from "@/lib/igNotificacao";

// ── Tipos ────────────────────────────────────────────────────────────────────

export const GATILHOS = ["ETIQUETA_APLICADA", "ETIQUETA_REMOVIDA", "PALAVRA_NA_MENSAGEM", "CONVERSA_TRANSFERIDA"] as const;
export type Gatilho = (typeof GATILHOS)[number];

export const ACOES = [
  "ADICIONAR_ETIQUETA",
  "REMOVER_ETIQUETA",
  "ENVIAR_MENSAGEM",
  "CHAMAR_ATENDENTE",
  "ENCERRAR",
  "DEVOLVER_AO_ROBO",
  "NOTIFICAR_EQUIPE",
] as const;
export type TipoAcao = (typeof ACOES)[number];

/** quando: etiqueta (vazio = qualquer etiqueta) ou palavras separadas por vírgula (obrigatório em PALAVRA_NA_MENSAGEM). */
export type Quando = { tipo: Gatilho; valor?: string };
/** valor = etiqueta (ADICIONAR/REMOVER); texto = mensagem (ENVIAR_MENSAGEM, aceita {nome}); motivo = texto do aviso (NOTIFICAR_EQUIPE). */
export type Acao = { tipo: TipoAcao; valor?: string; texto?: string; motivo?: string };

/** O que aconteceu na conversa. */
export type EventoRegra =
  | { tipo: "ETIQUETA_APLICADA"; etiqueta: string }
  | { tipo: "ETIQUETA_REMOVIDA"; etiqueta: string }
  | { tipo: "PALAVRA_NA_MENSAGEM"; texto: string }
  | { tipo: "CONVERSA_TRANSFERIDA" };

export type ResultadoRegras = { executadas: { regraId: string; nome: string; acoes: string[] }[] };

/** Profundidade máxima da cadeia (regra que dispara regra que dispara regra). */
export const PROFUNDIDADE_MAXIMA = 3;
/** A mesma regra não roda de novo na mesma conversa dentro deste intervalo. */
const TRAVA_MS = 60 * 1000;

// Profundidade da cadeia atual. Passa automaticamente por etiquetar() → aplicarRegras() quando a chamada
// acontece dentro de uma ação de regra, mesmo sem ninguém repassar o número.
const profundidadeAtual = new AsyncLocalStorage<number>();

// ── Validação (usada pela API) ───────────────────────────────────────────────

const limpaEtiqueta = (t: string) => t.trim().replace(/\s+/g, " ").slice(0, 40);
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** Confere e limpa o "quando" e o "fazer" vindos do painel. Devolve erro em português se algo estiver faltando. */
export function validarRegra(quandoBruto: unknown, fazerBruto: unknown): { ok: true; quando: Quando; fazer: Acao[] } | { ok: false; erro: string } {
  const q = (quandoBruto ?? {}) as Record<string, unknown>;
  const tipo = q.tipo as Gatilho;
  if (!GATILHOS.includes(tipo)) return { ok: false, erro: "Escolha quando a regra dispara" };
  let valor = str(q.valor).trim();
  if (tipo === "ETIQUETA_APLICADA" || tipo === "ETIQUETA_REMOVIDA") valor = limpaEtiqueta(valor);
  if (tipo === "PALAVRA_NA_MENSAGEM") {
    valor = palavrasDe(valor).join(", ");
    if (!valor) return { ok: false, erro: "Informe ao menos uma palavra" };
  }
  if (tipo === "CONVERSA_TRANSFERIDA") valor = "";
  const quando: Quando = valor ? { tipo, valor: valor.slice(0, 300) } : { tipo };

  if (!Array.isArray(fazerBruto) || fazerBruto.length === 0) return { ok: false, erro: "Adicione ao menos uma ação" };
  if (fazerBruto.length > 10) return { ok: false, erro: "No máximo 10 ações por regra" };
  const fazer: Acao[] = [];
  for (const bruto of fazerBruto) {
    const a = (bruto ?? {}) as Record<string, unknown>;
    const t = a.tipo as TipoAcao;
    if (!ACOES.includes(t)) return { ok: false, erro: "Ação inválida" };
    if (t === "ADICIONAR_ETIQUETA" || t === "REMOVER_ETIQUETA") {
      const v = limpaEtiqueta(str(a.valor));
      if (!v) return { ok: false, erro: "Informe a etiqueta da ação" };
      fazer.push({ tipo: t, valor: v });
    } else if (t === "ENVIAR_MENSAGEM") {
      const texto = str(a.texto).trim().slice(0, 900);
      if (!texto) return { ok: false, erro: "Escreva a mensagem da ação" };
      fazer.push({ tipo: t, texto });
    } else if (t === "NOTIFICAR_EQUIPE") {
      const motivo = str(a.motivo).trim().slice(0, 200);
      fazer.push(motivo ? { tipo: t, motivo } : { tipo: t });
    } else {
      fazer.push({ tipo: t });
    }
  }
  // Regra que reage à própria ação imediatamente (ex.: quando "X" aplicada → adicionar "X") não faz sentido.
  if ((tipo === "ETIQUETA_APLICADA" && valor && fazer.some((a) => a.tipo === "ADICIONAR_ETIQUETA" && a.valor === valor)) ||
      (tipo === "ETIQUETA_REMOVIDA" && valor && fazer.some((a) => a.tipo === "REMOVER_ETIQUETA" && a.valor === valor))) {
    return { ok: false, erro: "A regra não pode repetir a própria etiqueta do gatilho" };
  }
  return { ok: true, quando, fazer };
}

// ── Casamento do gatilho ─────────────────────────────────────────────────────

function palavrasDe(valor: string): string[] {
  return [...new Set(valor.split(/[,\n]/).map((p) => p.trim().replace(/\s+/g, " ")).filter(Boolean))].slice(0, 30);
}

function casa(quando: Quando, evento: EventoRegra): boolean {
  if (quando.tipo !== evento.tipo) return false;
  const valor = (quando.valor ?? "").trim();
  switch (evento.tipo) {
    case "ETIQUETA_APLICADA":
    case "ETIQUETA_REMOVIDA":
      return !valor || normaliza(valor) === normaliza(evento.etiqueta);
    case "PALAVRA_NA_MENSAGEM":
      return palavrasDe(valor).some((p) => contemPalavra(evento.texto, p));
    case "CONVERSA_TRANSFERIDA":
      return true;
  }
}

function lerQuando(j: Prisma.JsonValue): Quando | null {
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const o = j as Record<string, unknown>;
  return GATILHOS.includes(o.tipo as Gatilho) ? { tipo: o.tipo as Gatilho, valor: str(o.valor) } : null;
}

function lerFazer(j: Prisma.JsonValue): Acao[] {
  if (!Array.isArray(j)) return [];
  return j.filter((a): a is Prisma.JsonObject => !!a && typeof a === "object" && !Array.isArray(a) && ACOES.includes((a as Record<string, unknown>).tipo as TipoAcao))
    .map((a) => ({ tipo: a.tipo as TipoAcao, valor: str(a.valor), texto: str(a.texto), motivo: str(a.motivo) }));
}

// ── Motor ────────────────────────────────────────────────────────────────────

/**
 * Roda as regras ativas da conta da conversa que casam com o evento.
 * - Trava contra laço: a mesma regra não roda duas vezes na mesma conversa em 1 minuto, e a cadeia
 *   regra → regra para na profundidade 3.
 * - ENVIAR_MENSAGEM só sai dentro da janela de 24h da Meta (dentroDaJanela); fora dela é pulada.
 * - Nunca lança erro (não pode derrubar o robô nem etiquetar()).
 */
export async function aplicarRegras(evento: EventoRegra, conversationId: string, opcoes: { profundidade?: number } = {}): Promise<ResultadoRegras> {
  const resultado: ResultadoRegras = { executadas: [] };
  const profundidade = opcoes.profundidade ?? profundidadeAtual.getStore() ?? 0;
  if (profundidade >= PROFUNDIDADE_MAXIMA) return resultado;
  try {
    const conversa = await prisma.igConversation.findUnique({ where: { id: conversationId }, select: { id: true, accountId: true } });
    if (!conversa) return resultado;
    const regras = await prisma.igRegra.findMany({ where: { accountId: conversa.accountId, ativa: true }, orderBy: { createdAt: "asc" } });
    const quePassam = regras.filter((r) => {
      const q = lerQuando(r.quando);
      return q && casa(q, evento);
    });
    if (quePassam.length === 0) return resultado;

    if (Math.random() < 0.02) {
      // Faxina de vez em quando: a trava só precisa do último minuto.
      prisma.igRegraExec.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }).catch(() => {});
    }

    for (const regra of quePassam) {
      const recente = await prisma.igRegraExec.findFirst({
        where: { regraId: regra.id, conversationId, createdAt: { gt: new Date(Date.now() - TRAVA_MS) } },
        select: { id: true },
      });
      if (recente) continue;
      const exec = await prisma.igRegraExec.create({ data: { regraId: regra.id, conversationId } });
      // Corrida (dois eventos ao mesmo tempo passaram pela checagem acima): só a execução mais antiga da janela vale.
      const primeira = await prisma.igRegraExec.findFirst({
        where: { regraId: regra.id, conversationId, createdAt: { gt: new Date(Date.now() - TRAVA_MS) } },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { id: true },
      });
      if (primeira && primeira.id !== exec.id) {
        await prisma.igRegraExec.delete({ where: { id: exec.id } }).catch(() => {});
        continue;
      }
      const feitas = await profundidadeAtual.run(profundidade + 1, () => executarAcoes(regra.nome, lerFazer(regra.fazer), conversationId, profundidade + 1, evento.tipo === "CONVERSA_TRANSFERIDA"));
      resultado.executadas.push({ regraId: regra.id, nome: regra.nome, acoes: feitas });
    }
  } catch (e) {
    console.error("[ig-regras]", e);
  }
  return resultado;
}

/**
 * Atalho para chamar de dentro de etiquetar(): compara as etiquetas antes e depois e dispara
 * ETIQUETA_APLICADA / ETIQUETA_REMOVIDA para cada diferença. Nunca lança erro.
 */
export async function aplicarRegrasEtiquetas(conversationId: string, antes: string[], depois: string[]): Promise<ResultadoRegras> {
  const resultado: ResultadoRegras = { executadas: [] };
  const a = new Set(antes);
  const d = new Set(depois);
  const eventos: EventoRegra[] = [
    ...depois.filter((t) => !a.has(t)).map((etiqueta) => ({ tipo: "ETIQUETA_APLICADA" as const, etiqueta })),
    ...antes.filter((t) => !d.has(t)).map((etiqueta) => ({ tipo: "ETIQUETA_REMOVIDA" as const, etiqueta })),
  ];
  for (const ev of eventos) resultado.executadas.push(...(await aplicarRegras(ev, conversationId)).executadas);
  return resultado;
}

/** Muda as etiquetas direto no banco (sem passar por etiquetar(), para não disparar as regras duas vezes). */
async function mudarEtiquetas(conversationId: string, adicionar: string[], remover: string[]) {
  const c = await prisma.igConversation.findUnique({ where: { id: conversationId }, select: { tags: true } });
  if (!c) return { antes: [] as string[], depois: [] as string[] };
  const rem = new Set(remover.map(limpaEtiqueta));
  const depois = [...new Set([...c.tags, ...adicionar.map(limpaEtiqueta)])].filter((t) => t && !rem.has(t));
  const igual = depois.length === c.tags.length && depois.every((t, i) => t === c.tags[i]);
  if (!igual) await prisma.igConversation.update({ where: { id: conversationId }, data: { tags: depois } });
  return { antes: c.tags, depois: igual ? c.tags : depois };
}

/** `anunciaTransferencia`: a regra roda por causa da transferência para a equipe, então a mensagem de aviso ("já te passo para uma atendente") pode sair mesmo em NEEDS_HUMAN. */
async function executarAcoes(nomeRegra: string, acoes: Acao[], conversationId: string, profundidade: number, anunciaTransferencia = false): Promise<string[]> {
  const feitas: string[] = [];
  for (const acao of acoes) {
    try {
      switch (acao.tipo) {
        case "ADICIONAR_ETIQUETA":
        case "REMOVER_ETIQUETA": {
          if (!acao.valor) break;
          const { antes, depois } = await mudarEtiquetas(
            conversationId,
            acao.tipo === "ADICIONAR_ETIQUETA" ? [acao.valor] : [],
            acao.tipo === "REMOVER_ETIQUETA" ? [acao.valor] : [],
          );
          if (antes !== depois) {
            feitas.push(`${acao.tipo}:${acao.valor}`);
            await aplicarRegrasEtiquetas(conversationId, antes, depois); // profundidade vem do AsyncLocalStorage
          }
          break;
        }
        case "ENVIAR_MENSAGEM": {
          if (!acao.texto) break;
          const c = await prisma.igConversation.findUnique({ where: { id: conversationId }, include: { account: true } });
          if (!c || !c.account.active || !dentroDaJanela(c.lastCustomerMessageAt)) {
            feitas.push("ENVIAR_MENSAGEM:fora_da_janela");
            break;
          }
          // Atendente assumiu, conversa na fila da equipe ou encerrada: o robô não fala por cima da equipe.
          if (!(await roboPodeFalarConversa(c, { permitirNeedsHuman: anunciaTransferencia }))) {
            feitas.push("ENVIAR_MENSAGEM:com_atendente");
            break;
          }
          const texto = aplicarNome(acao.texto, c.nome);
          const sentId = await enviarDm({ igUserId: c.account.igUserId, encryptedToken: c.account.accessToken, recipientId: c.igScopedUserId, text: texto });
          await prisma.igMessage.create({
            data: { conversationId, direction: "OUT", source: "BOT", text: texto, metaMessageId: sentId || null, matchedKind: "regra" },
          });
          feitas.push("ENVIAR_MENSAGEM");
          break;
        }
        case "CHAMAR_ATENDENTE": {
          const c = await prisma.igConversation.findUnique({ where: { id: conversationId }, select: { status: true } });
          if (!c) break;
          const jaComEquipe = c.status === "NEEDS_HUMAN" || c.status === "HUMAN";
          if (!jaComEquipe) await prisma.igConversation.update({ where: { id: conversationId }, data: { status: "NEEDS_HUMAN", naoLida: true } });
          await notificarEquipe(conversationId, `Regra "${nomeRegra}" chamou uma atendente`);
          feitas.push("CHAMAR_ATENDENTE");
          if (!jaComEquipe) await aplicarRegras({ tipo: "CONVERSA_TRANSFERIDA" }, conversationId, { profundidade });
          break;
        }
        case "ENCERRAR":
          await prisma.igConversation.update({ where: { id: conversationId }, data: { status: "CLOSED", naoLida: false } });
          feitas.push("ENCERRAR");
          break;
        case "DEVOLVER_AO_ROBO":
          await prisma.igConversation.update({ where: { id: conversationId }, data: { status: "BOT", assumidaEm: null } });
          feitas.push("DEVOLVER_AO_ROBO");
          break;
        case "NOTIFICAR_EQUIPE":
          await notificarEquipe(conversationId, acao.motivo || `Regra "${nomeRegra}"`);
          feitas.push("NOTIFICAR_EQUIPE");
          break;
      }
    } catch (e) {
      // Uma ação que falha (ex.: Meta recusou o envio) não impede as próximas.
      console.error("[ig-regras] ação", acao.tipo, e);
      feitas.push(`${acao.tipo}:falhou`);
    }
  }
  return feitas;
}
