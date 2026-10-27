import { prisma } from "@/lib/prisma";
import { dentroDaJanela, enviarDm, MARGEM_AGENDADO_MS } from "@/lib/instagram";
import { roboPodeFalarConversa } from "@/lib/igEstado";
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
    // Uma atendente assumiu (e está ativa): a sequência não fala por cima dela.
    if (c.status === "HUMAN" && !(await roboPodeFalarConversa(c))) {
      await pararCom("Atendente assumiu a conversa");
      continue;
    }
    // Cliente respondeu depois do último envio (rede de segurança caso o webhook não tenha chamado pararPorResposta).
    if (seq.pararSeResponder && i.ultimoEnvioEm && c.lastCustomerMessageAt && c.lastCustomerMessageAt > i.ultimoEnvioEm) {
      await pararCom("Cliente respondeu");
      continue;
    }
    // Regra da Meta: fora da janela de 24h não se envia nada.
    if (!dentroDaJanela(c.lastCustomerMessageAt, agora, MARGEM_AGENDADO_MS)) {
      await pararCom(`Fora da janela de 24h no passo ${i.passoAtual + 1}`);
      continue;
    }
    // Aguardando atendente: pausa (a reserva acima já empurrou o próximo envio 10 min) em vez de falar por cima dela.
    // Se ela não aparecer, a janela de 24h acaba parando a sequência.
    if (c.status === "NEEDS_HUMAN") continue;

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

export const NOME_POS_PITCH = "Pós-pitch BFF";

/**
 * Passos padrão do acompanhamento depois do pitch de atacado (tempos contados desde o pitch: 3h, 9h e 23h30).
 * A Meta só deixa falar até ~24h depois da última mensagem do cliente, e o agendador roda a cada 5 min com 10 min de margem:
 * a última sai entre 23h30 e ~23h45.
 */
const PASSOS_POS_PITCH: PassoSequencia[] = [
  { atrasoMinutos: 180, texto: "Oi, {nome}! Conseguiu fazer o seu pedido? 😊 Se travou em alguma coisa, me conta aqui que eu te ajudo." },
  { atrasoMinutos: 360, texto: "Ah, {nome}, e segue a gente aqui no Instagram: postamos novidades e ofertas exclusivas só pra quem segue 😉" },
  { atrasoMinutos: 870, texto: "Passando pra saber se você conseguiu finalizar o seu pedido 😊 Se ficou alguma dúvida, é só me responder aqui que eu te ajudo." },
];

/** Versões anteriores do padrão: se a sequência ainda for exatamente uma delas (ninguém editou), troca pela atual. */
const PASSOS_POS_PITCH_ANTIGOS = [
  JSON.stringify([
  { atrasoMinutos: 180, texto: "Oi, {nome}! Conseguiu fazer o seu pedido? 😊 Se travou em alguma coisa, me conta aqui que eu te ajudo." },
  {
    atrasoMinutos: 1215,
    texto:
      "Passando pra saber se você conseguiu finalizar o seu pedido 😊 Se ficou alguma dúvida, é só me responder aqui que eu te ajudo. E segue a gente aqui no Instagram: postamos novidades e ofertas exclusivas só pra quem segue 😉",
  },
]),
  JSON.stringify([
    { atrasoMinutos: 180, texto: "Oi, {nome}! Conseguiu fazer o seu pedido? 😊 Se travou em alguma coisa, me conta aqui que eu te ajudo." },
    { atrasoMinutos: 180, texto: "Ah, {nome}, e segue a gente aqui no Instagram: postamos novidades e ofertas exclusivas só pra quem segue 😉" },
    { atrasoMinutos: 1050, texto: "Passando pra saber se você conseguiu finalizar o seu pedido 😊 Se ficou alguma dúvida, é só me responder aqui que eu te ajudo." },
  ]),
];

/**
 * Coloca a conversa no acompanhamento "Pós-pitch BFF" (cria a sequência na primeira vez; depois ela pode ser editada no painel).
 * Quem já passou por ela só volta se a inscrição anterior tiver mais de 24h (cliente que compra de novo).
 */
export async function inscreverPosPitch(accountId: string, conversationId: string): Promise<void> {
  let seq = await prisma.igSequencia.findFirst({ where: { accountId, nome: NOME_POS_PITCH } });
  if (!seq) seq = await prisma.igSequencia.create({ data: { accountId, nome: NOME_POS_PITCH, passos: PASSOS_POS_PITCH, pararSeResponder: true } });
  if (PASSOS_POS_PITCH_ANTIGOS.includes(JSON.stringify(seq.passos))) {
    seq = await prisma.igSequencia.update({ where: { id: seq.id }, data: { passos: PASSOS_POS_PITCH } });
  }
  if (!seq.ativa) return;
  const anterior = await prisma.igSequenciaInscrito.findUnique({ where: { sequenciaId_conversationId: { sequenciaId: seq.id, conversationId } } });
  const reiniciar = !!anterior && anterior.status !== "ATIVA" && Date.now() - anterior.createdAt.getTime() > 24 * 60 * 60 * 1000;
  await inscrever(seq.id, conversationId, { reiniciar });
}

export const NOME_SEGUIDOR_BFF = "Boas-vindas ao seguir BFF";
const LINK_APP_BFF = "https://converta.app/redirectbff.html";

/**
 * Passos de quem acabou de seguir a BFF (tempos desde o passo anterior; o agendador roda a cada 5 min):
 * na hora, 2 mensagens curtas mandando baixar o app e ativar as notificações (a 2ª com o link); ~3h depois o cashback
 * (a pessoa responde e o robô explica); e ~23h30 depois da inscrição, perto do fim da janela de 24h da Meta, o aviso
 * de novidades. Se ela responder no meio, a sequência para e a janela reabre.
 */
const PASSOS_SEGUIDOR: PassoSequencia[] = [
  { atrasoMinutos: 0, texto: "Que bom ter você com a gente, {nome}! 💜 Baixa o nosso app e vê todas as novidades e promoções por lá 📲" },
  { atrasoMinutos: 1, texto: `Ativa as notificações 🔔 Sempre que tiver promoção, a gente avisa pelo app. Baixa aqui: ${LINK_APP_BFF}` },
  { atrasoMinutos: 180, texto: "Comprando pelo app, você pode ganhar até 50% de cashback pra usar na sua próxima compra 🤑" },
  { atrasoMinutos: 1229, texto: "A gente acabou de postar novidades e promoções no app 🔥 Dá uma olhada lá e aproveita, que acaba rápido!" },
];

/** Versão anterior do padrão (sem edição do painel): é trocada pela atual. */
const PASSOS_SEGUIDOR_ANTIGOS = JSON.stringify([
  { atrasoMinutos: 0, texto: `Que bom ter você com a gente, {nome}! 💜 Baixa o nosso app e faz o seu pedido por lá: ${LINK_APP_BFF}` },
  { atrasoMinutos: 20, texto: "E comprando pelo app você ainda ganha cashback de 10% a 30% do valor do pedido pra usar na próxima compra 😉" },
  { atrasoMinutos: 1300, texto: "Oi, {nome}! Passando pra te lembrar que as novidades e ofertas do atacado estão no app 😊 Se tiver qualquer dúvida, é só me chamar aqui." },
]);

/**
 * Quem acabou de passar a seguir a loja entra nas 3 mensagens de boas-vindas (cria a sequência na primeira vez; depois dá para editar no painel).
 * Uma pessoa só passa por ela uma vez.
 */
export async function inscreverSeguidorBff(accountId: string, conversationId: string): Promise<void> {
  let seq = await prisma.igSequencia.findFirst({ where: { accountId, nome: NOME_SEGUIDOR_BFF } });
  if (!seq) seq = await prisma.igSequencia.create({ data: { accountId, nome: NOME_SEGUIDOR_BFF, passos: PASSOS_SEGUIDOR, pararSeResponder: true } });
  if (JSON.stringify(seq.passos) === PASSOS_SEGUIDOR_ANTIGOS) seq = await prisma.igSequencia.update({ where: { id: seq.id }, data: { passos: PASSOS_SEGUIDOR } });
  if (!seq.ativa) return;
  await inscrever(seq.id, conversationId);
}
