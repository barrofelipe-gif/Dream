import "server-only";
import { prisma } from "@/lib/prisma";

// Decisão única: "o robô pode falar agora com esta conversa?". Usada pelo webhook, regras, fluxos,
// sequências, transmissões e seguimento, para nenhuma automação falar por cima da equipe.
//
// - BOT: pode.
// - HUMAN: uma atendente assumiu; o robô fica quieto enquanto ela estiver ativa (menos de 24h desde a
//   última mensagem dela ou desde a assunção). Passado isso, volta a atender.
// - NEEDS_HUMAN: aguardando atendente; o robô não fala (só o próprio fluxo de "procurando atendente" e o
//   seguirSemAtendente, que é quem devolve a conversa ao robô, passam por cima com `permitirNeedsHuman`).
// - CLOSED: encerrada; automações não falam (uma mensagem nova do cliente reabre a conversa no webhook).

export const ATIVIDADE_HUMANA_MS = 24 * 60 * 60 * 1000;

export type ConversaEstado = { id: string; status: string; assumidaEm?: Date | null; updatedAt?: Date | null };

/** Última atividade da atendente: mensagem dela ou o momento em que assumiu. */
async function ultimaAtividadeHumana(c: ConversaEstado): Promise<Date | null> {
  const ult = await prisma.igMessage.findFirst({
    where: { conversationId: c.id, direction: "OUT", source: "HUMANO" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const datas = [c.assumidaEm, ult?.createdAt].filter((d): d is Date => !!d);
  if (datas.length) return new Date(Math.max(...datas.map((d) => d.getTime())));
  // Conversa assumida antes de existir `assumidaEm` e sem mensagem dela: usa a última mudança como referência.
  return c.updatedAt ?? null;
}

/** Uma atendente está ativa nesta conversa (status HUMAN e atividade nas últimas 24h)? */
export async function humanoAtivo(c: ConversaEstado, agora = new Date()): Promise<boolean> {
  if (c.status !== "HUMAN") return false;
  const ultima = await ultimaAtividadeHumana(c);
  return !!ultima && agora.getTime() - ultima.getTime() < ATIVIDADE_HUMANA_MS;
}

/** O robô pode falar agora? (não olha a janela de 24h da Meta: isso é `dentroDaJanela`). */
export async function roboPodeFalarConversa(c: ConversaEstado, opts: { permitirNeedsHuman?: boolean } = {}): Promise<boolean> {
  switch (c.status) {
    case "CLOSED":
      return false;
    case "NEEDS_HUMAN":
      return !!opts.permitirNeedsHuman;
    case "HUMAN":
      return !(await humanoAtivo(c));
    default:
      return true;
  }
}

/** Igual a `roboPodeFalarConversa`, carregando a conversa pelo id. Conversa inexistente = não pode. */
export async function roboPodeFalar(conversationId: string, opts: { permitirNeedsHuman?: boolean } = {}): Promise<boolean> {
  const c = await prisma.igConversation.findUnique({ where: { id: conversationId }, select: { id: true, status: true, assumidaEm: true, updatedAt: true } });
  return !!c && roboPodeFalarConversa(c, opts);
}
