import "server-only";
import { prisma } from "@/lib/prisma";
import { abrirConta } from "@/lib/social/contas";
import { adaptadorDe } from "@/lib/social";
import type { Midia } from "@/lib/social/types";

const json = <T>(texto: string, padrao: T): T => {
  try {
    return JSON.parse(texto) as T;
  } catch {
    return padrao;
  }
};

/**
 * Publica uma postagem em todas as contas escolhidas que ainda não saíram (PENDENTE ou ERRO).
 * Cada rede é independente: se uma falhar, as outras seguem e o resultado fica por rede.
 */
export async function publicarPost(postId: string): Promise<{ status: string }> {
  const post = await prisma.socialPost.findUnique({ where: { id: postId }, include: { alvos: { include: { conta: true } } } });
  if (!post) throw new Error("Postagem não encontrada");

  await prisma.socialPost.update({ where: { id: postId }, data: { status: "PUBLICANDO" } });
  const midias = json<Midia[]>(post.midias, []);
  const porRede = json<Record<string, { legenda?: string; titulo?: string; opcoes?: Record<string, unknown> }>>(post.porRede, {});

  const pendentes = post.alvos.filter((a) => a.status !== "PUBLICADO");
  await Promise.allSettled(
    pendentes.map(async (alvo) => {
      const rede = alvo.conta.rede;
      const adaptador = adaptadorDe(rede);
      try {
        if (!adaptador?.disponivel) throw new Error(`${adaptador?.rotulo ?? rede} ainda não está disponível.`);
        const conta = await abrirConta(alvo.contaId);
        if (!conta) throw new Error("Conta desconectada ou desativada.");

        const ajuste = porRede[rede] ?? {};
        const entrada = {
          legenda: (ajuste.legenda ?? post.legenda).trim(),
          titulo: ajuste.titulo ?? (post.titulo || undefined),
          tipo: post.tipo as "imagem" | "video" | "carrossel" | "texto",
          midias,
          opcoes: ajuste.opcoes ?? {},
        };
        const erros = adaptador.validar(entrada);
        if (erros.length) throw new Error(erros.join(" "));

        await prisma.socialPostAlvo.update({ where: { id: alvo.id }, data: { status: "PUBLICANDO", tentativas: { increment: 1 }, erro: null } });
        const saida = await adaptador.publicar({ ...entrada, conta });
        await prisma.socialPostAlvo.update({
          where: { id: alvo.id },
          data: { status: "PUBLICADO", externoPostId: saida.externoId, url: saida.url ?? null, publicadoEm: new Date(), erro: null },
        });
      } catch (e) {
        await prisma.socialPostAlvo.update({
          where: { id: alvo.id },
          data: { status: "ERRO", erro: (e as Error).message.slice(0, 500), tentativas: { increment: 0 } },
        });
      }
    }),
  );

  const finais = await prisma.socialPostAlvo.findMany({ where: { postId }, select: { status: true } });
  const ok = finais.filter((a) => a.status === "PUBLICADO").length;
  const status = ok === finais.length ? "PUBLICADO" : ok === 0 ? "ERRO" : "PARCIAL";
  await prisma.socialPost.update({ where: { id: postId }, data: { status } });
  return { status };
}

/** Publica o que estava agendado e já passou da hora. Chamado por um agendador externo (a cada ~5 min). */
export async function publicarAgendados(): Promise<{ processados: number }> {
  const devidos = await prisma.socialPost.findMany({
    where: { status: "AGENDADO", agendadoPara: { lte: new Date() } },
    select: { id: true },
    take: 10,
    orderBy: { agendadoPara: "asc" },
  });
  for (const p of devidos) await publicarPost(p.id).catch((e) => console.error("[social] falha ao publicar", p.id, e));
  return { processados: devidos.length };
}
