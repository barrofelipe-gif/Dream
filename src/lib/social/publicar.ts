import "server-only";
import { prisma } from "@/lib/prisma";
import { abrirConta } from "@/lib/social/contas";
import { encrypt } from "@/lib/crypto";
import { adaptadorDe } from "@/lib/social";
import { FalhaDefinitiva, PublicacaoPendente, type Midia, type Rede, type SaidaPublicar } from "@/lib/social/types";

/**
 * Rede que aceitou o envio mas ainda processa (Reel do Instagram): o alvo fica PUBLICANDO com
 * externoPostId = "aguardando:<quando>:<referência da rede>" até concluirPendentes() terminar.
 * Enquanto concluirPendentes trabalha num alvo, o prefixo vira "concluindo:" (ninguém pega o mesmo duas vezes).
 */
const AGUARDANDO = "aguardando:";
const CONCLUINDO = "concluindo:";
const PRAZO_REDE_MS = 24 * 3600_000; // o contêiner do Instagram vale 24 h

/** Status da postagem a partir das redes: alguma ainda processando = PUBLICANDO. */
function statusDoPost(finais: { status: string }[]): string {
  if (finais.some((a) => a.status === "PUBLICANDO")) return "PUBLICANDO";
  const ok = finais.filter((a) => a.status === "PUBLICADO").length;
  return finais.length && ok === finais.length ? "PUBLICADO" : ok === 0 ? "ERRO" : "PARCIAL";
}

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

  // PUBLICANDO é de outra execução em andamento: não entra.
  const pendentes = post.alvos.filter((a) => a.status === "PENDENTE" || a.status === "ERRO");
  await Promise.allSettled(
    pendentes.map(async (alvo) => {
      const rede = alvo.conta.rede;
      const adaptador = adaptadorDe(rede);
      try {
        if (!adaptador?.disponivel) throw new Error(`${adaptador?.rotulo ?? rede} ainda não está disponível.`);
        const conta = await abrirConta(alvo.contaId);
        if (!conta) throw new Error("Conta desconectada ou desativada.");

        // Token perto de vencer (ex: TikTok vale só 24h): renova antes de publicar e guarda o novo.
        if (adaptador.renovar && conta.expiraEm && conta.expiraEm.getTime() < Date.now() + 10 * 60_000) {
          const novo = await adaptador.renovar(conta);
          if (novo) {
            conta.accessToken = novo.accessToken;
            if (novo.refreshToken) conta.refreshToken = novo.refreshToken;
            await prisma.socialConta.update({
              where: { id: conta.id },
              data: {
                accessToken: encrypt(novo.accessToken),
                ...(novo.refreshToken ? { refreshToken: encrypt(novo.refreshToken) } : {}),
                expiraEm: novo.expiraEm ?? null,
              },
            });
          }
        }

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

        // Reserva atômica: o cron e o botão do painel ao mesmo tempo não publicam a mesma postagem duas vezes.
        const reserva = await prisma.socialPostAlvo.updateMany({
          where: { id: alvo.id, status: { in: ["PENDENTE", "ERRO"] } },
          data: { status: "PUBLICANDO", tentativas: { increment: 1 }, erro: null },
        });
        if (reserva.count === 0) return;
        const saida = await adaptador.publicar({ ...entrada, conta });
        await prisma.socialPostAlvo.update({
          where: { id: alvo.id },
          data: { status: "PUBLICADO", externoPostId: saida.externoId, url: saida.url ?? null, publicadoEm: new Date(), erro: null },
        });
      } catch (e) {
        if (e instanceof PublicacaoPendente) {
          await prisma.socialPostAlvo.updateMany({
            where: { id: alvo.id, status: "PUBLICANDO" },
            data: { externoPostId: `${AGUARDANDO}${Date.now()}:${e.referencia}`, erro: null },
          });
          return;
        }
        // Só marca ERRO o que esta execução tinha (PENDENTE/PUBLICANDO): não desfaz um PUBLICADO de outra execução.
        await prisma.socialPostAlvo.updateMany({
          where: { id: alvo.id, status: { in: ["PENDENTE", "ERRO", "PUBLICANDO"] } },
          data: { status: "ERRO", erro: (e as Error).message.slice(0, 500) },
        });
      }
    }),
  );

  const finais = await prisma.socialPostAlvo.findMany({ where: { postId }, select: { status: true } });
  const status = statusDoPost(finais);
  await prisma.socialPost.update({ where: { id: postId }, data: { status } });
  return { status };
}

/** Publica o que estava agendado e já passou da hora. Chamado por um agendador externo (a cada ~5 min). */
export async function publicarAgendados(opts: { prazo?: number } = {}): Promise<{ processados: number }> {
  const devidos = await prisma.socialPost.findMany({
    where: { status: "AGENDADO", agendadoPara: { lte: new Date() } },
    select: { id: true },
    take: 10,
    orderBy: { agendadoPara: "asc" },
  });
  let processados = 0;
  for (const p of devidos) {
    if (opts.prazo && Date.now() > opts.prazo) break; // sem tempo para outra postagem: fica para a próxima rodada
    // Reserva o post: duas rodadas do agendador ao mesmo tempo não pegam o mesmo agendado.
    const reserva = await prisma.socialPost.updateMany({ where: { id: p.id, status: "AGENDADO" }, data: { status: "PUBLICANDO" } });
    if (reserva.count === 0) continue;
    await publicarPost(p.id).catch((e) => console.error("[social] falha ao publicar", p.id, e));
    processados++;
  }
  return { processados };
}

/**
 * Postagem que ficou em PUBLICANDO por mais de 15 min: a função morreu no meio (vídeos longos do TikTok e do Pinterest
 * esperam a rede processar e passam do limite de 60 s). Marca as redes que não terminaram como ERRO, sem republicar
 * sozinho (a rede pode ter publicado mesmo assim), para a equipe conferir e tentar de novo pelo painel.
 */
/** Alvo travado de verdade: PUBLICANDO sem estar esperando a rede (aguardando/concluindo é com concluirPendentes). */
const TRAVADO = {
  status: "PUBLICANDO",
  OR: [{ externoPostId: null }, { AND: [{ NOT: { externoPostId: { startsWith: AGUARDANDO } } }, { NOT: { externoPostId: { startsWith: CONCLUINDO } } }] }],
};

export async function destravarPublicacoes(): Promise<number> {
  // Só posts com algum alvo travado de verdade: os que só esperam a rede não ocupam a vez dos outros.
  const presos = await prisma.socialPost.findMany({
    where: { status: "PUBLICANDO", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) }, alvos: { some: TRAVADO } },
    select: { id: true },
    take: 20,
  });
  for (const p of presos) {
    await prisma.socialPostAlvo.updateMany({
      where: { postId: p.id, ...TRAVADO },
      data: { status: "ERRO", erro: "A publicação foi interrompida no meio. Confira na rede se saiu antes de tentar de novo." },
    });
    const finais = await prisma.socialPostAlvo.findMany({ where: { postId: p.id }, select: { status: true } });
    const status = statusDoPost(finais);
    if (status !== "PUBLICANDO") await prisma.socialPost.updateMany({ where: { id: p.id, status: "PUBLICANDO" }, data: { status } });
  }
  // Post que ficou PUBLICANDO sem nenhuma rede ainda em andamento (a função morreu entre gravar a rede e o post).
  const orfaos = await prisma.socialPost.findMany({
    where: { status: "PUBLICANDO", updatedAt: { lt: new Date(Date.now() - 15 * 60_000) }, alvos: { none: { status: "PUBLICANDO" } } },
    select: { id: true },
    take: 20,
  });
  for (const p of orfaos) await atualizarStatusPost(p.id);
  return presos.length;
}

/** Reserva de concluirPendentes que ficou velha (a função morreu no meio): volta para a fila depois disto. */
const RESERVA_VENCE_MS = 5 * 60_000;

/**
 * Lê a marca do alvo. "aguardando:<início>:<referência>" ou "concluindo:<reserva>:<início>:<referência>".
 * A referência pode ter ":" (ex.: "ig-container:123"), por isso só os primeiros campos são números.
 */
function lerMarca(marca: string): { inicio: number; referencia: string; reservaEm: number | null } | null {
  const partes = marca.split(":");
  if (marca.startsWith(AGUARDANDO) && partes.length >= 3) return { inicio: Number(partes[1]), referencia: partes.slice(2).join(":"), reservaEm: null };
  if (marca.startsWith(CONCLUINDO) && partes.length >= 4) return { inicio: Number(partes[2]), referencia: partes.slice(3).join(":"), reservaEm: Number(partes[1]) };
  return null;
}

/**
 * Termina as publicações que ficaram processando na rede (Reel do Instagram que passou dos 60 s da função).
 * Chamado pelo agendador de 5 min e pela tela do publicador aberta. Devolve quantas terminaram.
 * Cada alvo é reservado ("concluindo:" com a hora da reserva); reserva com mais de 5 min volta para a fila.
 * Publicar o mesmo contêiner duas vezes não duplica: o Instagram recusa contêiner já publicado.
 */
export async function concluirPendentes(opts: { prazo?: number } = {}): Promise<number> {
  const candidatos = await prisma.socialPostAlvo.findMany({
    where: { status: "PUBLICANDO", OR: [{ externoPostId: { startsWith: AGUARDANDO } }, { externoPostId: { startsWith: CONCLUINDO } }] },
    select: { id: true, postId: true, contaId: true, externoPostId: true, conta: { select: { rede: true } } },
    take: 50,
  });
  // Ordem aleatória: vídeos que demoram não tomam sempre a vez dos que já ficaram prontos.
  const alvos = candidatos
    .map((a) => ({ a, m: lerMarca(a.externoPostId ?? "") }))
    .filter((x) => x.m && (x.m.reservaEm === null || Date.now() - x.m.reservaEm > RESERVA_VENCE_MS))
    .sort(() => Math.random() - 0.5);
  let feitos = 0;
  for (const { a, m } of alvos) {
    if (opts.prazo && Date.now() > opts.prazo) break;
    const { inicio, referencia } = m!;
    const espera = `${AGUARDANDO}${inicio}:${referencia}`;
    const reservaMarca = `${CONCLUINDO}${Date.now()}:${inicio}:${referencia}`;
    const reserva = await prisma.socialPostAlvo.updateMany({ where: { id: a.id, status: "PUBLICANDO", externoPostId: a.externoPostId }, data: { externoPostId: reservaMarca } });
    if (reserva.count === 0) continue;
    // Toda gravação final só vale se a reserva ainda é desta execução.
    const finalizar = (data: Record<string, unknown>) => prisma.socialPostAlvo.updateMany({ where: { id: a.id, externoPostId: reservaMarca }, data });
    let saida: SaidaPublicar | null;
    try {
      const adaptador = adaptadorDe(a.conta.rede as Rede);
      const conta = await abrirConta(a.contaId);
      if (!adaptador?.concluir || !conta) throw new Error("Conta desconectada ou rede sem como terminar a publicação.");
      saida = await adaptador.concluir(conta, referencia);
    } catch (e) {
      // Falha passageira (rede fora, resposta perdida): volta para a fila e tenta na próxima rodada, até 24 h.
      // Só a rede desistindo de vez vira erro na hora.
      const msg = (e as Error).message.slice(0, 500);
      const desistiu = e instanceof FalhaDefinitiva || Date.now() - inicio > PRAZO_REDE_MS;
      await finalizar(desistiu ? { status: "ERRO", externoPostId: null, erro: msg } : { externoPostId: espera, erro: msg });
      await atualizarStatusPost(a.postId);
      continue;
    }
    if (saida) {
      await finalizar({ status: "PUBLICADO", externoPostId: saida.externoId, url: saida.url ?? null, publicadoEm: new Date(), erro: null });
      feitos++;
    } else if (Date.now() - inicio > PRAZO_REDE_MS) {
      await finalizar({ status: "ERRO", externoPostId: null, erro: "A rede não terminou de processar o vídeo em 24 h. Tente de novo." });
    } else {
      await finalizar({ externoPostId: espera });
    }
    await atualizarStatusPost(a.postId);
  }
  return feitos;
}

async function atualizarStatusPost(postId: string) {
  const finais = await prisma.socialPostAlvo.findMany({ where: { postId }, select: { status: true } });
  await prisma.socialPost.update({ where: { id: postId }, data: { status: statusDoPost(finais) } });
}
