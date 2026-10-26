import "server-only";
import { prisma } from "@/lib/prisma";

/** Não repete o mesmo aviso: se já há um não lido da mesma conversa nos últimos 10 minutos, não cria outro. */
const INTERVALO_SEM_REPETIR = 10 * 60 * 1000;

/**
 * Avisa a equipe que uma conversa precisa de humano. Grava no sino do painel (IgNotificacao).
 * Não envia e-mail: o projeto não tem envio de e-mail pronto (o Gmail está conectado só para leitura).
 * Nunca lança erro (não pode derrubar o fluxo do robô). Devolve o id do aviso, ou null se não criou.
 */
export async function notificarEquipe(conversationId: string, motivo: string): Promise<string | null> {
  try {
    const texto = motivo.trim().replace(/\s+/g, " ").slice(0, 200) || "Conversa precisa de atendimento";
    const recente = await prisma.igNotificacao.findFirst({
      where: { conversationId, lida: false, createdAt: { gt: new Date(Date.now() - INTERVALO_SEM_REPETIR) } },
      select: { id: true },
    });
    if (recente) return null;
    const n = await prisma.igNotificacao.create({ data: { conversationId, motivo: texto } });
    return n.id;
  } catch (e) {
    console.error("[ig-notificacao]", e);
    return null;
  }
}
