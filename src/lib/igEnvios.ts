import { prisma } from "@/lib/prisma";
import { comLinksNoTexto, dentroDaJanela, enviarDm, MARGEM_AGENDADO_MS } from "@/lib/instagram";
import { roboPodeFalar } from "@/lib/igEstado";

export type LinkBotao = { title: string; url: string };

/** Marca uma DM para sair daqui a alguns minutos (quem envia é o agendador de 5 min, então pode levar até ~5 min a mais). */
export async function agendarEnvio(conversationId: string, texto: string, links: LinkBotao[], kind: string, minutos: number) {
  await prisma.igEnvioAgendado.create({
    data: { conversationId, texto, links, kind, enviarEm: new Date(Date.now() + minutos * 60_000) },
  });
}

/** Envia as DMs agendadas que já venceram. Retorna quantas foram tratadas. */
export async function processarEnviosAgendados(limite = 25): Promise<number> {
  // Reserva que ficou presa (a função morreu no meio do envio): marca como falha para aparecer, sem reenviar às cegas
  // (não dá para saber se a Meta chegou a entregar).
  await prisma.igEnvioAgendado
    .updateMany({ where: { status: "ENVIANDO", enviarEm: { lt: new Date(Date.now() - 30 * 60_000) } }, data: { status: "FALHOU", erro: "Envio interrompido" } })
    .catch(() => {});
  const prontos = await prisma.igEnvioAgendado.findMany({
    where: { status: "PENDENTE", enviarEm: { lte: new Date() } },
    orderBy: { enviarEm: "asc" },
    take: limite,
  });
  let feitos = 0;
  for (const e of prontos) {
    // Reserva atômica: dois agendadores ao mesmo tempo não mandam a mesma mensagem.
    const reserva = await prisma.igEnvioAgendado.updateMany({ where: { id: e.id, status: "PENDENTE" }, data: { status: "ENVIANDO" } });
    if (reserva.count === 0) continue;
    feitos++;
    const fim = async (status: "ENVIADA" | "EXPIRADA" | "CANCELADA" | "FALHOU", erro?: string) => {
      await prisma.igEnvioAgendado.update({ where: { id: e.id }, data: { status, erro: erro ?? null } });
    };
    const c = await prisma.igConversation.findUnique({ where: { id: e.conversationId }, include: { account: true } });
    if (!c || !c.account.active) {
      await fim("CANCELADA");
      continue;
    }
    if (!dentroDaJanela(c.lastCustomerMessageAt, new Date(), MARGEM_AGENDADO_MS)) {
      await fim("EXPIRADA");
      continue;
    }
    // Uma atendente assumiu, a conversa foi encerrada ou está aguardando atendente: o robô não fala.
    if (!(await roboPodeFalar(c.id))) {
      await fim("CANCELADA");
      continue;
    }
    try {
      const links = (Array.isArray(e.links) ? e.links : []) as LinkBotao[];
      const textoEnvio = comLinksNoTexto(e.texto, links);
      const sentId = await enviarDm({ igUserId: c.account.igUserId, encryptedToken: c.account.accessToken, recipientId: c.igScopedUserId, text: textoEnvio, links });
      await prisma.igMessage.create({
        data: { conversationId: c.id, direction: "OUT", source: "BOT", text: textoEnvio, metaMessageId: sentId || null, matchedKind: e.kind },
      });
      await fim("ENVIADA");
    } catch (err) {
      await fim("FALHOU", err instanceof Error ? err.message.slice(0, 200) : "erro");
    }
  }
  return feitos;
}
