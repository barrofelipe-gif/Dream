import { prisma } from "@/lib/prisma";
import { dentroDaJanela, enviarDm, MARGEM_AGENDADO_MS } from "@/lib/instagram";
import { etiquetar, TAG } from "@/lib/igTags";

const MINUTOS = (m: number) => new Date(Date.now() - m * 60 * 1000);

const MINUTOS_SEM_ATENDENTE = 10;
const TIPOS_TRANSFERENCIA = ["atendente", "procurando_atendente"];

/**
 * Trava de conversa parada com a equipe: passou para atendimento humano (NEEDS_HUMAN) e ninguém respondeu em
 * ${MINUTOS_SEM_ATENDENTE} minutos. A conversa volta para o robô; se ainda estiver dentro da janela de 24h, ele avisa que
 * não achou ninguém e oferece continuar por ele. Fora da janela só destrava (a próxima mensagem da pessoa já é atendida).
 * Chamado pelo agendador de 5 em 5 minutos.
 */
export async function seguirSemAtendente(): Promise<number> {
  const paradas = await prisma.igConversation.findMany({
    where: { status: "NEEDS_HUMAN", account: { active: true } },
    include: { account: true },
    orderBy: { updatedAt: "asc" },
    take: 50,
  });

  let enviadas = 0;
  for (const conversa of paradas) {
    const conversationId = conversa.id;
    // Quando foi passada para a equipe: a última mensagem do robô avisando que chamou/procura atendente.
    const aviso = await prisma.igMessage.findFirst({
      where: { conversationId, direction: "OUT", source: "BOT", matchedKind: { in: TIPOS_TRANSFERENCIA } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });
    const desde = aviso?.createdAt ?? conversa.updatedAt;
    if (desde > MINUTOS(MINUTOS_SEM_ATENDENTE)) continue;
    // Uma atendente respondeu depois da transferência: ela está cuidando.
    const humano = await prisma.igMessage.findFirst({ where: { conversationId, createdAt: { gt: desde }, source: "HUMANO" }, select: { id: true } });
    if (humano) continue;
    // Reserva a conversa (NEEDS_HUMAN → BOT) antes de enviar: duas rodadas do agendador ao mesmo tempo
    // mandariam o "não achei atendente" duas vezes. Se o envio falhar, devolve para NEEDS_HUMAN.
    const reserva = await prisma.igConversation.updateMany({ where: { id: conversationId, status: "NEEDS_HUMAN" }, data: { status: "BOT" } });
    if (reserva.count === 0) continue;
    await etiquetar(conversationId, [TAG.naoAtendido]).catch(() => {});

    // Fora da janela de 24h a Meta não deixa enviar: só destrava.
    if (!dentroDaJanela(conversa.lastCustomerMessageAt, new Date(), MARGEM_AGENDADO_MS)) continue;
    const jaAvisou = await prisma.igMessage.findFirst({ where: { conversationId, createdAt: { gt: desde }, matchedKind: "sem_atendente" }, select: { id: true } });
    if (jaAvisou) continue;

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
      enviadas++;
    } catch (e) {
      console.error(`[ig-seguimento] conversa ${conversationId}:`, e);
      await prisma.igConversation
        .updateMany({ where: { id: conversationId, status: "BOT" }, data: { status: "NEEDS_HUMAN" } })
        .catch(() => {});
    }
  }
  return enviadas;
}
