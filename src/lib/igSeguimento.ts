import { prisma } from "@/lib/prisma";
import { dentroDaJanela, enviarDm } from "@/lib/instagram";

const MINUTOS = (m: number) => new Date(Date.now() - m * 60 * 1000);

/**
 * Conversas em que o robô disse "vou tentar localizar uma atendente" e ninguém da equipe respondeu
 * em ~10 minutos: o robô volta, avisa que não achou ninguém e oferece continuar o atendimento por ele.
 * Chamado pelo agendador de 5 em 5 minutos.
 */
export async function seguirSemAtendente(): Promise<number> {
  const procurando = await prisma.igMessage.findMany({
    where: { direction: "OUT", source: "BOT", matchedKind: "procurando_atendente", createdAt: { lt: MINUTOS(10), gt: MINUTOS(20 * 60) } },
    orderBy: { createdAt: "desc" },
    select: { conversationId: true, createdAt: true },
  });
  // Só a busca mais recente de cada conversa conta.
  const ultima = new Map<string, Date>();
  for (const p of procurando) if (!ultima.has(p.conversationId)) ultima.set(p.conversationId, p.createdAt);

  let enviadas = 0;
  for (const [conversationId, desde] of ultima) {
    const conversa = await prisma.igConversation.findUnique({ where: { id: conversationId }, include: { account: true } });
    if (!conversa || conversa.status !== "NEEDS_HUMAN" || !conversa.account.active) continue;
    if (!dentroDaJanela(conversa.lastCustomerMessageAt)) continue;
    const depois = await prisma.igMessage.findFirst({
      where: {
        conversationId,
        createdAt: { gt: desde },
        OR: [{ source: "HUMANO" }, { matchedKind: "sem_atendente" }],
      },
      select: { id: true },
    });
    if (depois) continue;

    const partes = [
      "Não consegui achar nenhuma atendente disponível agora 😕",
      "Quer tentar resolver por aqui comigo? Me conta qual é a sua dúvida.",
    ];
    try {
      for (let i = 0; i < partes.length; i++) {
        if (i > 0) await new Promise((r) => setTimeout(r, 1200));
        const sentId = await enviarDm({
          igUserId: conversa.account.igUserId,
          encryptedToken: conversa.account.accessToken,
          recipientId: conversa.igScopedUserId,
          text: partes[i],
        });
        await prisma.igMessage.create({
          data: { conversationId, direction: "OUT", source: "BOT", text: partes[i], metaMessageId: sentId || null, matchedKind: "sem_atendente" },
        });
      }
      // Volta para o robô atender; continua marcada como não lida para a equipe ver.
      await prisma.igConversation.update({ where: { id: conversationId }, data: { status: "BOT" } });
      enviadas++;
    } catch (e) {
      console.error(`[ig-seguimento] conversa ${conversationId}:`, e);
    }
  }
  return enviadas;
}
