import { prisma } from "@/lib/prisma";
import { dentroDaJanela, enviarDm, MARGEM_AGENDADO_MS } from "@/lib/instagram";
import { roboPodeFalarConversa } from "@/lib/igEstado";
import { aplicarNome } from "@/lib/igBoasVindas";
import { etiquetar } from "@/lib/igTags";

const JANELA = 24 * 60 * 60 * 1000;

/** Conversas que podem receber: falaram nas últimas 24h, sem atendente (HUMAN) nem fila da equipe (NEEDS_HUMAN), não encerradas, com alguma etiqueta de "incluir" (se houver) e nenhuma de "excluir". */
export async function destinatarios(accountId: string, incluir: string[], excluir: string[]) {
  const conversas = await prisma.igConversation.findMany({
    where: {
      accountId,
      status: { notIn: ["CLOSED", "HUMAN", "NEEDS_HUMAN"] },
      lastCustomerMessageAt: { gt: new Date(Date.now() - JANELA) },
      ...(incluir.length ? { tags: { hasSome: incluir } } : {}),
    },
    select: { id: true, nome: true, username: true, tags: true },
  });
  return conversas.filter((c) => !excluir.some((t) => c.tags.includes(t)));
}

/** Envia os pendentes (poucos por rodada por causa do limite de 60 s da Vercel). Retorna quantos foram tratados. */
export async function processarTransmissoes(limite = 40): Promise<number> {
  const abertas = await prisma.igTransmissao.findMany({ where: { status: "ENVIANDO" }, include: { account: true }, orderBy: { createdAt: "asc" } });
  let feitas = 0;
  for (const t of abertas) {
    if (feitas >= limite) break;
    const alvos = await prisma.igTransmissaoAlvo.findMany({ where: { transmissaoId: t.id, status: "PENDENTE" }, take: limite - feitas });
    for (const a of alvos) {
      // Reserva o alvo antes de enviar: o agendador e o after() da criação podem rodar ao mesmo tempo, e sem
      // a reserva os dois mandariam a mesma mensagem. Se a função morrer no meio (limite de 60 s), o alvo fica
      // "ENVIANDO" e não é reenviado (melhor perder um envio do que mandar duas vezes).
      const reserva = await prisma.igTransmissaoAlvo.updateMany({ where: { id: a.id, status: "PENDENTE" }, data: { status: "ENVIANDO" } });
      if (reserva.count === 0) continue;
      // Cancelada no meio da rodada: devolve o alvo e para.
      const atual = await prisma.igTransmissao.findUnique({ where: { id: t.id }, select: { status: true } });
      if (atual?.status !== "ENVIANDO") {
        await prisma.igTransmissaoAlvo.update({ where: { id: a.id }, data: { status: "PENDENTE" } });
        break;
      }
      const c = await prisma.igConversation.findUnique({ where: { id: a.conversationId } });
      let status: "ENVIADA" | "FALHOU" | "EXPIRADA" = "ENVIADA";
      let erro: string | null = null;
      // Reconfere na hora de enviar: a equipe pode ter assumido a conversa depois que a lista foi montada.
      if (!c || !dentroDaJanela(c.lastCustomerMessageAt, new Date(), MARGEM_AGENDADO_MS) || !t.account.active || !(await roboPodeFalarConversa(c))) {
        status = "EXPIRADA";
      } else {
        try {
          const texto = aplicarNome(t.texto, c.nome);
          const sentId = await enviarDm({ igUserId: t.account.igUserId, encryptedToken: t.account.accessToken, recipientId: c.igScopedUserId, text: texto });
          await prisma.igMessage.create({
            data: { conversationId: c.id, direction: "OUT", source: "BOT", text: texto, metaMessageId: sentId || null, matchedKind: "transmissao" },
          });
          await etiquetar(c.id, [`Transmissão: ${t.nome}`.slice(0, 40)], [], { automacoes: false }); // só marca: não dispara regras nem fluxos
        } catch (e) {
          status = "FALHOU";
          erro = e instanceof Error ? e.message.slice(0, 200) : "erro";
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      await prisma.igTransmissaoAlvo.update({ where: { id: a.id }, data: { status, erro } });
      await prisma.igTransmissao.update({
        where: { id: t.id },
        data: status === "ENVIADA" ? { enviadas: { increment: 1 } } : status === "FALHOU" ? { falhas: { increment: 1 } } : {},
      });
      feitas++;
    }
    const restam = await prisma.igTransmissaoAlvo.count({ where: { transmissaoId: t.id, status: "PENDENTE" } });
    if (restam === 0) await prisma.igTransmissao.updateMany({ where: { id: t.id, status: "ENVIANDO" }, data: { status: "CONCLUIDA" } });
  }
  return feitas;
}
