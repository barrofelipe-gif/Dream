import { prisma } from "@/lib/prisma";
import { dentroDaJanela, enviarDm } from "@/lib/instagram";
import { aplicarNome } from "@/lib/igBoasVindas";
import { etiquetar } from "@/lib/igTags";

/** Um passo da sequência: espera `atrasoMinutos` (desde o passo anterior ou da inscrição) e envia `texto`. */
export type PassoSequencia = { atrasoMinutos: number; texto: string };

export const MAX_PASSOS = 20;
const MAX_ATRASO = 60 * 24 * 365; // 1 ano
const TRAVA_MS = 10 * 60 * 1000; // reserva o inscrito enquanto envia (evita envio duplo entre cron e after())

/** Lê e limpa a lista de passos (vinda do banco ou do corpo da requisição). */
export function lerPassos(v: unknown): PassoSequencia[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((p) => {
      const o = (p ?? {}) as Record<string, unknown>;
      const atraso = Math.round(Number(o.atrasoMinutos));
      const texto = typeof o.texto === "string" ? o.texto.trim().slice(0, 900) : "";
      return { atrasoMinutos: Number.isFinite(atraso) ? Math.min(Math.max(atraso, 0), MAX_ATRASO) : 0, texto };
    })
    .filter((p) => p.texto)
    .slice(0, MAX_PASSOS);
}

const emMin = (agora: Date, minutos: number) => new Date(agora.getTime() + minutos * 60_000);

export type ResultadoInscricao = { ok: true; id: string } | { ok: false; motivo: string };

/**
 * Inscreve uma conversa na sequência. Já inscrita e ATIVA: não faz nada.
 * Já CONCLUIDA/PARADA: só recomeça do passo 1 se `reiniciar` for true.
 */
export async function inscrever(sequenciaId: string, conversationId: string, opts: { reiniciar?: boolean } = {}): Promise<ResultadoInscricao> {
  const [seq, conversa] = await Promise.all([
    prisma.igSequencia.findUnique({ where: { id: sequenciaId } }),
    prisma.igConversation.findUnique({ where: { id: conversationId }, select: { id: true, accountId: true } }),
  ]);
  if (!seq) return { ok: false, motivo: "Sequência não encontrada" };
  if (!conversa) return { ok: false, motivo: "Conversa não encontrada" };
  if (conversa.accountId !== seq.accountId) return { ok: false, motivo: "A conversa é de outra conta do Instagram" };
  const passos = lerPassos(seq.passos);
  if (passos.length === 0) return { ok: false, motivo: "Sequência sem passos" };

  const agora = new Date();
  const existente = await prisma.igSequenciaInscrito.findUnique({ where: { sequenciaId_conversationId: { sequenciaId, conversationId } } });
  if (existente) {
    if (existente.status === "ATIVA") return { ok: false, motivo: "Já está na sequência" };
    if (!opts.reiniciar) return { ok: false, motivo: existente.status === "CONCLUIDA" ? "Já concluiu a sequência" : "Já passou pela sequência (parada)" };
  }
  const dados = { passoAtual: 0, proximoEm: emMin(agora, passos[0].atrasoMinutos), status: "ATIVA", motivo: null, ultimoEnvioEm: null };
  const inscrito = existente
    ? await prisma.igSequenciaInscrito.update({ where: { id: existente.id }, data: { ...dados, createdAt: agora } })
    : await prisma.igSequenciaInscrito.create({ data: { sequenciaId, conversationId, ...dados } });
  if (seq.etiquetaAoEntrar) await etiquetar(conversationId, [seq.etiquetaAoEntrar]);
  return { ok: true, id: inscrito.id };
}

/** Para todas as sequências ativas da conversa (ex.: a equipe assumiu ou o cliente pediu para não receber). Retorna quantas parou. */
export async function parar(conversationId: string, motivo = "Parada manualmente"): Promise<number> {
  const r = await prisma.igSequenciaInscrito.updateMany({ where: { conversationId, status: "ATIVA" }, data: { status: "PARADA", motivo: motivo.slice(0, 200) } });
  return r.count;
}

/**
 * Chamar no webhook quando o CLIENTE manda mensagem: para as sequências ativas que têm "parar se responder".
 * Só conta como resposta se já houve pelo menos um envio da sequência (quem acabou de se inscrever não é parado pela própria mensagem que o inscreveu).
 */
export async function pararPorResposta(conversationId: string): Promise<number> {
  const r = await prisma.igSequenciaInscrito.updateMany({
    where: { conversationId, status: "ATIVA", ultimoEnvioEm: { not: null }, sequencia: { pararSeResponder: true } },
    data: { status: "PARADA", motivo: "Cliente respondeu" },
  });
  return r.count;
}

/** Envia os passos vencidos (poucos por rodada por causa do limite de 60 s da Vercel). Retorna quantos inscritos foram tratados. */
export async function processarSequencias(limite = 40): Promise<number> {
  const agora = new Date();
  const vencidos = await prisma.igSequenciaInscrito.findMany({
    where: { status: "ATIVA", proximoEm: { lte: agora }, sequencia: { ativa: true, account: { active: true } } },
    include: { sequencia: { include: { account: true } } },
    orderBy: { proximoEm: "asc" },
    take: limite,
  });
  let feitos = 0;
  for (const i of vencidos) {
    // Reserva: se outra execução já pegou este inscrito, pula.
    const reserva = await prisma.igSequenciaInscrito.updateMany({
      where: { id: i.id, status: "ATIVA", passoAtual: i.passoAtual, proximoEm: i.proximoEm },
      data: { proximoEm: new Date(Date.now() + TRAVA_MS) },
    });
    if (reserva.count === 0) continue;
    feitos++;

    const seq = i.sequencia;
    const passos = lerPassos(seq.passos);
    const pararCom = (motivo: string) => prisma.igSequenciaInscrito.update({ where: { id: i.id }, data: { status: "PARADA", motivo: motivo.slice(0, 200) } });

    // A sequência pode ter sido encurtada depois da inscrição.
    if (i.passoAtual >= passos.length) {
      await prisma.igSequenciaInscrito.update({ where: { id: i.id }, data: { status: "CONCLUIDA", motivo: null } });
      if (seq.etiquetaAoConcluir) await etiquetar(i.conversationId, [seq.etiquetaAoConcluir]);
      continue;
    }

    const c = await prisma.igConversation.findUnique({ where: { id: i.conversationId } });
    if (!c) {
      await pararCom("Conversa não existe mais");
      continue;
    }
    if (c.status === "CLOSED") {
      await pararCom("Conversa encerrada");
      continue;
    }
    // Uma atendente assumiu: a sequência não fala por cima dela.
    if (c.status === "HUMAN") {
      await pararCom("Atendente assumiu a conversa");
      continue;
    }
    // Cliente respondeu depois do último envio (rede de segurança caso o webhook não tenha chamado pararPorResposta).
    if (seq.pararSeResponder && i.ultimoEnvioEm && c.lastCustomerMessageAt && c.lastCustomerMessageAt > i.ultimoEnvioEm) {
      await pararCom("Cliente respondeu");
      continue;
    }
    // Regra da Meta: fora da janela de 24h não se envia nada.
    if (!dentroDaJanela(c.lastCustomerMessageAt)) {
      await pararCom(`Fora da janela de 24h no passo ${i.passoAtual + 1}`);
      continue;
    }

    const texto = aplicarNome(passos[i.passoAtual].texto, c.nome);
    try {
      const sentId = await enviarDm({ igUserId: seq.account.igUserId, encryptedToken: seq.account.accessToken, recipientId: c.igScopedUserId, text: texto });
      await prisma.igMessage.create({
        data: { conversationId: c.id, direction: "OUT", source: "BOT", text: texto, metaMessageId: sentId || null, matchedKind: "sequencia" },
      });
    } catch (e) {
      await pararCom(`Falha ao enviar o passo ${i.passoAtual + 1}: ${e instanceof Error ? e.message : "erro"}`);
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }

    const enviadoEm = new Date();
    const proximo = i.passoAtual + 1;
    if (proximo >= passos.length) {
      await prisma.igSequenciaInscrito.update({ where: { id: i.id }, data: { passoAtual: proximo, status: "CONCLUIDA", motivo: null, ultimoEnvioEm: enviadoEm } });
      if (seq.etiquetaAoConcluir) await etiquetar(c.id, [seq.etiquetaAoConcluir]);
    } else {
      await prisma.igSequenciaInscrito.update({
        where: { id: i.id },
        data: { passoAtual: proximo, proximoEm: emMin(enviadoEm, passos[proximo].atrasoMinutos), ultimoEnvioEm: enviadoEm },
      });
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return feitos;
}
