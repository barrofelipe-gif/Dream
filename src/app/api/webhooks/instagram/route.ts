import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { assinaturaValida, dentroDaJanela, enviarDm } from "@/lib/instagram";
import { responder, escreverApoio, escreverInfoCompra, ATACADO_BFF, type Mensagem } from "@/lib/igBot";
import { atualizarPerfil } from "@/lib/igPerfil";
import { etiquetar, TAG } from "@/lib/igTags";
import { aplicarRegras } from "@/lib/igRegras";
import { notificarEquipe } from "@/lib/igNotificacao";
import { roboPodeFalar, roboPodeFalarConversa } from "@/lib/igEstado";
import { agendarEnvio } from "@/lib/igEnvios";
import { declaraCompra, pedeHumano } from "@/lib/igIntencao";
import { pararPorResposta } from "@/lib/igSequencias";
import { continuarComResposta, tentarGatilhoPorComentario, tentarGatilhoPorMensagem } from "@/lib/igFluxos";
import { PREFIXO_POSTBACK, processarComentario, processarPostbackAutomacao } from "@/lib/igAutomacoes";
import {
  aplicarNome,
  BOTAO_DUVIDA,
  carregarConfig,
  PAYLOAD_DUVIDA,
  PAYLOAD_SIM,
} from "@/lib/igBoasVindas";
import type { Loja } from "@/lib/avaliacoesLeitura";

type Evento = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: {
    mid?: string;
    text?: string;
    is_echo?: boolean;
    quick_reply?: { payload?: string };
    attachments?: { type?: string }[];
    reply_to?: { story?: unknown };
    // Conversa que nasceu de um anúncio "clique para o Direct" ou de um link ig.me.
    referral?: { source?: string; type?: string; ad_id?: string; ref?: string };
  };
  postback?: { mid?: string; title?: string; payload?: string; referral?: { source?: string; ad_id?: string; ref?: string } };
};
type Mudanca = {
  field?: string;
  value?: {
    id?: string;
    text?: string;
    parent_id?: string;
    from?: { id?: string; username?: string };
    media?: { id?: string };
  };
};
type Payload = { object?: string; entry?: { id: string; messaging?: Evento[]; changes?: Mudanca[] }[] };

// O robô responde em segundo plano (after) e pode chamar a IA: o plano da Vercel aceita até 60 s.
export const maxDuration = 60;

const MAX_ESCLARECIMENTOS = 2;
const ESCLARECER = [
  "Oi! Não consegui entender bem a sua dúvida. Pode me explicar com mais detalhes o que você quer saber?",
  "Ainda não consegui entender. Pode tentar explicar de outro jeito? Por exemplo, sobre qual produto, pedido ou assunto é a sua dúvida?",
];
// Textos de reserva, usados só se a IA falhar ao escrever a mensagem de apoio.
const CHAMAR_ATENDENTE =
  "Como eu não estou conseguindo entender o que você precisa, vou chamar uma atendente aqui para te ajudar. Já já ela te responde por aqui.";
const PEDIR_DUVIDA = [
  "Claro! Me conta qual é a sua dúvida que eu te ajudo.",
  "Pode mandar! Qual é a sua dúvida?",
];

/** Conversa foi para a equipe: avisa no sino do painel e dispara as regras de "conversa transferida". */
async function transferida(conversaId: string, motivo: string) {
  await notificarEquipe(conversaId, motivo);
  await aplicarRegras({ tipo: "CONVERSA_TRANSFERIDA" }, conversaId);
}

/**
 * Uma automação (regra ou fluxo) já respondeu a esta mensagem do cliente, ou a conversa foi encerrada /
 * assumida por uma atendente no meio do caminho: o robô padrão não responde (evita resposta dupla).
 */
async function automacaoJaCuidou(conversaId: string, desde: Date, statusInicial: string) {
  const [c, enviada] = await Promise.all([
    prisma.igConversation.findUnique({ where: { id: conversaId }, select: { status: true } }),
    prisma.igMessage.findFirst({
      where: { conversationId: conversaId, direction: "OUT", matchedKind: { in: ["regra", "fluxo"] }, createdAt: { gte: desde } },
      select: { id: true },
    }),
  ]);
  if (enviada) return true;
  return c?.status === "CLOSED" || (c?.status === "HUMAN" && statusInicial !== "HUMAN");
}

/** O robô (ou uma automação) já respondeu depois da última mensagem do cliente? Evita resposta dupla quando a pessoa manda várias mensagens seguidas. */
async function jaRespondeuDepoisDaUltimaEntrada(conversaId: string) {
  const ultima = await prisma.igMessage.findFirst({
    where: { conversationId: conversaId, direction: "IN" },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (!ultima) return false;
  const resposta = await prisma.igMessage.findFirst({
    where: { conversationId: conversaId, direction: "OUT", source: "BOT", createdAt: { gt: ultima.createdAt } },
    select: { id: true },
  });
  return !!resposta;
}

const HORAS = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);
const APP_BFF = "https://converta.app/redirectbff.html";

// Handshake de verificação da Meta ao cadastrar o webhook no app.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const token = process.env.META_VERIFY_TOKEN;
  if (token && p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === token) {
    return new NextResponse(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return NextResponse.json({ error: "Verificação recusada" }, { status: 403 });
}

// Eventos de DM. A Meta exige 200 rápido: valida a assinatura, responde e
// processa depois (after). Sem assinatura válida, nada é processado.
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!assinaturaValida(raw, req.headers.get("x-hub-signature-256"))) {
    return NextResponse.json({ error: "Assinatura inválida" }, { status: 401 });
  }
  let payload: Payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  if (payload.object !== "instagram") return NextResponse.json({ ok: true });

  after(async () => {
    for (const entry of payload.entry ?? []) {
      // Comentários nas publicações: automação "comentário -> resposta pública + DM".
      for (const c of entry.changes ?? []) {
        if (c.field !== "comments" || !c.value?.id || !c.value.from?.id) continue;
        try {
          const evento = {
            contaId: entry.id,
            commentId: c.value.id,
            texto: c.value.text ?? "",
            userId: c.value.from.id,
            username: c.value.from.username,
            midiaId: c.value.media?.id ?? "",
            parentId: c.value.parent_id,
          };
          // Um fluxo visual com gatilho de comentário tem prioridade; senão vale a automação de comentário.
          // Falha no fluxo não pode impedir a automação de comentário de sempre.
          const fluxoAssumiu = await tentarGatilhoPorComentario(evento).catch((err) => {
            console.error("[ig-webhook] falha no fluxo de comentário", err);
            return false;
          });
          if (!fluxoAssumiu) await processarComentario(evento);
        } catch (err) {
          console.error("[ig-webhook] falha na automação de comentário", err);
        }
      }
      for (const ev of entry.messaging ?? []) {
        try {
          await tratarEvento(ev);
        } catch (err) {
          console.error("[ig-webhook] falha ao tratar evento", err);
        }
      }
    }
  });
  return NextResponse.json({ ok: true });
}

// Mensagem que SAIU da conta (eco). Se não foi o robô que mandou, uma pessoa da
// equipe respondeu pelo Instagram: o robô sai da conversa e a resposta é guardada
// (é o material para a base aprender).
async function tratarEco(ev: Evento) {
  if (!ev.sender?.id || !ev.recipient?.id) return;
  const account = await prisma.instagramAccount.findUnique({ where: { igUserId: ev.sender.id } });
  if (!account) return;
  const conversa = await prisma.igConversation.findUnique({
    where: { accountId_igScopedUserId: { accountId: account.id, igScopedUserId: ev.recipient.id } },
  });
  if (!conversa) return;

  const mid = ev.message?.mid;
  const textoEco = ev.message?.text?.trim() || "";
  const foiORobo = async () => !!mid && !!(await prisma.igMessage.findUnique({ where: { metaMessageId: mid }, select: { id: true } }));
  if (await foiORobo()) return;
  // O eco do envio do robô pode chegar antes de gravarmos o id da Meta: espera um instante e confere de novo.
  await new Promise((r) => setTimeout(r, 2500));
  if (await foiORobo()) return;
  // Envio do robô (com ou sem id gravado): compara o TEXTO EXATO que ele acabou de mandar. Nunca "qualquer mensagem do robô
  // nos últimos 30 s", senão a resposta de uma atendente logo depois do robô seria descartada.
  if (textoEco) {
    const recenteNosso = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, direction: "OUT", source: "BOT", text: textoEco, createdAt: { gt: new Date(Date.now() - 30_000) } },
      select: { id: true },
    });
    if (recenteNosso) return;
  }

  await prisma.igMessage.create({
    data: {
      conversationId: conversa.id,
      direction: "OUT",
      source: "HUMANO",
      text: textoEco || "[mídia]",
      metaMessageId: mid,
    },
  });
  // Quem respondeu pelo Instagram obviamente leu a conversa.
  await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "HUMAN", naoLida: false, assumidaEm: new Date() } });
  await etiquetar(conversa.id, [TAG.atendidoEquipe], [TAG.naoAtendido]);
}

type Conta = { id: string; igUserId: string; accessToken: string };
type Saida = {
  texto: string;
  /** Várias mensagens curtas em sequência (botões e link vão só na última). */
  partes?: string[];
  kind: string;
  id?: number | null;
  confianca?: string | null;
  quickReplies?: { title: string; payload: string }[];
  link?: { title: string; url: string };
  links?: { title: string; url: string }[];
  /** Segunda mensagem (com botão de link) enviada alguns segundos depois da primeira. */
  seguinte?: { texto: string; links: { title: string; url: string }[]; depoisMin: number };
};

/** Envia a mensagem no Instagram e grava na conversa como do robô. */
async function enviarEGravar(conta: Conta, conversaId: string, destinatario: string, s: Saida) {
  const partes = s.partes?.length ? s.partes : [s.texto];
  for (let i = 0; i < partes.length; i++) {
    const ultima = i === partes.length - 1;
    if (i > 0) await new Promise((r) => setTimeout(r, 1200)); // pausa curta: parece digitação, não rajada
    // Grava a linha ANTES do envio (sem id da Meta) para encolher a janela de duas execuções mandarem o mesmo texto
    // e para o eco achar a linha por texto; o id da Meta entra depois do envio.
    const linha = await prisma.igMessage.create({
      data: {
        conversationId: conversaId,
        direction: "OUT",
        source: "BOT",
        text: partes[i],
        metaMessageId: null,
        matchedKind: s.kind,
        matchedId: s.id ?? null,
        confidence: s.confianca ?? null,
      },
      select: { id: true },
    });
    let sentId: string | null | undefined;
    try {
      sentId = await enviarDm({
        igUserId: conta.igUserId,
        encryptedToken: conta.accessToken,
        recipientId: destinatario,
        text: partes[i],
        quickReplies: ultima ? s.quickReplies : undefined,
        link: ultima ? s.link : undefined,
        links: ultima ? s.links : undefined,
      });
    } catch (err) {
      // Envio falhou: não deixa mensagem fantasma no painel.
      await prisma.igMessage.delete({ where: { id: linha.id } }).catch(() => {});
      throw err;
    }
    if (sentId) await prisma.igMessage.update({ where: { id: linha.id }, data: { metaMessageId: sentId } }).catch(() => {});
  }
}

async function tratarEvento(ev: Evento) {
  if (ev.message?.is_echo) return tratarEco(ev);
  // Toque em botão de resposta rápida (message.quick_reply) ou em botão do modelo (postback).
  const botao = ev.message?.quick_reply?.payload ?? ev.postback?.payload;
  // Alguém marcou a loja num story: chega como anexo "story_mention", sem texto.
  const mencionou = !!ev.message?.attachments?.some((a) => a.type === "story_mention");
  // Foto, vídeo, áudio ou compartilhamento sem texto: grava como "[mídia]" (renova a janela e avisa a equipe), sem o robô responder.
  const midia = !ev.message?.text?.trim() && !mencionou && !!ev.message?.attachments?.length;
  const text = ev.message?.text?.trim() || ev.postback?.title?.trim() || (mencionou ? "[Marcou a loja num story]" : undefined) || (midia ? "[mídia]" : undefined);
  if (!text || !ev.sender?.id || !ev.recipient?.id) return;

  const account = await prisma.instagramAccount.findUnique({ where: { igUserId: ev.recipient.id } });
  if (!account?.active) return;

  // Idempotência: a Meta reenvia o mesmo webhook se demorarmos ou falharmos.
  const mid = ev.message?.mid ?? ev.postback?.mid;
  if (mid && (await prisma.igMessage.findUnique({ where: { metaMessageId: mid } }))) return;

  const conversa = await prisma.igConversation.upsert({
    where: { accountId_igScopedUserId: { accountId: account.id, igScopedUserId: ev.sender.id } },
    create: { accountId: account.id, igScopedUserId: ev.sender.id },
    update: {},
  });

  const agora = new Date(ev.timestamp ?? Date.now());
  const entrada = await prisma.igMessage.create({
    data: { conversationId: conversa.id, direction: "IN", source: "CLIENTE", text, metaMessageId: mid },
    select: { id: true, createdAt: true },
  });
  // Conversa encerrada que recebe mensagem nova é REABERTA: volta para o robô (ou para a fila da equipe, se uma atendente
  // falou com ela na última semana) e aparece como não lida. Uma regra "Encerrar" desta mesma mensagem ainda pode fechar de novo.
  const reabrir = conversa.status === "CLOSED";
  if (reabrir) {
    const atendida = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, direction: "OUT", source: "HUMANO", createdAt: { gt: HORAS(24 * 7) } },
      select: { id: true },
    });
    conversa.status = atendida ? "NEEDS_HUMAN" : "BOT";
    conversa.assumidaEm = null;
    if (atendida) await notificarEquipe(conversa.id, "Conversa encerrada recebeu mensagem nova").catch(() => {});
  }
  const statusInicial = conversa.status;
  // Conversa com a equipe envolvida (aguardando ou atendendo): cada mensagem nova do cliente
  // volta a aparecer como NÃO LIDA na caixa de entrada.
  // A janela de 24h é renovada ANTES das etiquetas/regras/fluxos, para que eles vejam a janela certa.
  const comEquipe = conversa.status === "NEEDS_HUMAN" || conversa.status === "HUMAN";
  await prisma.igConversation.update({
    where: { id: conversa.id },
    data: {
      lastCustomerMessageAt: agora,
      ...(reabrir ? { status: conversa.status, assumidaEm: null, naoLida: true } : comEquipe ? { naoLida: true } : {}),
    },
  });
  if (midia) {
    await pararPorResposta(conversa.id).catch((err) => console.error("[ig-webhook] pararPorResposta", err));
    return;
  }

  // Origem da conversa (anúncio ou orgânico) e autodeclaração de comprador, para etiquetar sozinho.
  const ref = ev.message?.referral ?? ev.postback?.referral;
  const veioDeAnuncio = ref?.source === "ADS" || !!ref?.ad_id;
  const entradas = await prisma.igMessage.count({ where: { conversationId: conversa.id, direction: "IN" } });
  const novasTags: string[] = [];
  if (veioDeAnuncio) novasTags.push(TAG.veioAnuncio);
  else if (entradas === 1) novasTags.push(mencionou ? TAG.origemStory : TAG.organico);
  if (declaraCompra(text)) novasTags.push(TAG.comprador);
  if (novasTags.length) await etiquetar(conversa.id, novasTags, veioDeAnuncio ? [TAG.organico] : []);
  // A pessoa respondeu: sequências em andamento param e as regras de palavra-chave rodam antes do robô responder.
  await pararPorResposta(conversa.id).catch((err) => console.error("[ig-webhook] pararPorResposta", err));
  await aplicarRegras({ tipo: "PALAVRA_NA_MENSAGEM", texto: text }, conversa.id);
  // Regras (ENCERRAR, CHAMAR_ATENDENTE, DEVOLVER_AO_ROBO) podem ter mudado o status: usa o atual daqui em diante.
  const aposRegras = await prisma.igConversation.findUnique({ where: { id: conversa.id }, select: { status: true } });
  if (aposRegras) conversa.status = aposRegras.status;

  await atualizarPerfil(conversa.id);

  // "Já segui" de uma automação de comentário: confere o follow e libera o conteúdo.
  if (botao?.startsWith(PREFIXO_POSTBACK)) {
    await processarPostbackAutomacao(ev.recipient.id, ev.sender.id, botao);
    return;
  }

  if (conversa.status === "CLOSED") return;
  if (!dentroDaJanela(agora)) return;
  // Uma regra ou um fluxo (disparado por etiqueta) já respondeu esta mensagem: o robô não responde de novo.
  if (await automacaoJaCuidou(conversa.id, entrada.createdAt, statusInicial)) return;
  // Decisão central: atendente ativa (HUMAN < 24h) ou conversa aguardando atendente (NEEDS_HUMAN) = o robô fica quieto
  // (a conversa já foi marcada como não lida acima). HUMAN vencido (atendente sumiu há mais de 24h): o robô volta a atender.
  if (!(await roboPodeFalarConversa(conversa))) return;
  if (conversa.status === "HUMAN") {
    await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "BOT", assumidaEm: null } });
    conversa.status = "BOT";
  }

  // Fluxos visuais: continuam uma pergunta/botão em andamento ou começam por palavra-chave, story ou botão do menu.
  // Falha num fluxo não pode calar o robô padrão: em erro, segue como se nenhum fluxo tivesse casado.
  {
    const semFluxo = (err: unknown) => {
      console.error("[ig-webhook] falha no fluxo", err);
      return false;
    };
    if (await continuarComResposta(conversa.id, text, botao).catch(semFluxo)) return;
    if (await tentarGatilhoPorMensagem(conversa.id, text, { payload: botao, story: mencionou || !!ev.message?.reply_to?.story }).catch(semFluxo)) return;
  }

  // Agradece a marcação no story (uma vez por dia por pessoa) e não passa pela triagem.
  if (mencionou) {
    const jaAgradeceu = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, matchedKind: "story_mencao", createdAt: { gt: HORAS(24) } },
      select: { id: true },
    });
    if (!jaAgradeceu) {
      await enviarEGravar(account, conversa.id, ev.sender.id, {
        texto: "Obrigada por marcar a gente! 💜",
        kind: "story_mencao",
      });
    }
    return;
  }

  const loja = account.loja as Loja;
  const config = await carregarConfig(loja);
  // Perfil já atualizado acima: nome e se a pessoa segue a loja.
  const perfil = await prisma.igConversation.findUnique({
    where: { id: conversa.id },
    select: { nome: true, seguePagina: true },
  });
  const naoSegue = perfil?.seguePagina === false;
  const primeiroContato = !(await prisma.igMessage.findFirst({
    where: { conversationId: conversa.id, direction: "OUT" },
    select: { id: true },
  }));

  // ── Botões da automação de boas-vindas ──────────────────────────────────────
  if (botao === PAYLOAD_SIM) {
    const jaConvidou = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, matchedKind: "boasvindas", text: { contains: config.textoSeguir.slice(0, 30) } },
      select: { id: true },
    });
    let info = config.infoTexto.trim() ? aplicarNome(config.infoTexto, perfil?.nome ?? null) : await escreverInfoCompra(loja).catch(() => null);
    if (!info) {
      // Sem texto seguro para mandar: uma atendente envia as informações.
      await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "NEEDS_HUMAN", naoLida: true } });
      await transferida(conversa.id, "Botão de informações sem texto seguro");
      await enviarEGravar(account, conversa.id, ev.sender.id, {
        texto: "Vou pedir para uma atendente te mandar essas informações agora mesmo, só um instante.",
        kind: "atendente",
      });
      return;
    }
    if (config.pedirSeguir && naoSegue && !jaConvidou) info += `\n\n${config.textoSeguir}`;
    await enviarEGravar(account, conversa.id, ev.sender.id, {
      texto: info,
      kind: "boasvindas_info",
      link: config.linkUrl ? { title: config.linkTitulo || "Ver o site", url: config.linkUrl } : undefined,
    });
    return;
  }
  if (botao === PAYLOAD_DUVIDA) {
    await enviarEGravar(account, conversa.id, ev.sender.id, {
      texto: PEDIR_DUVIDA[Math.floor(Math.random() * PEDIR_DUVIDA.length)],
      kind: "saudacao",
    });
    return;
  }

  // ── Conversa normal ─────────────────────────────────────────────────────────
  // Só a execução da ÚLTIMA mensagem do cliente responde (duas mensagens seguidas disparam duas execuções).
  const souAUltima = async () => {
    const ultimaEntrada = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, direction: "IN" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return !ultimaEntrada || ultimaEntrada.id === entrada.id;
  };

  // A pessoa costuma explicar em várias mensagens: o robô lê as últimas (30 min) juntas.
  const recentes = await prisma.igMessage.findMany({
    where: { conversationId: conversa.id, direction: "IN", createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  const contexto = recentes.map((m) => m.text).filter((t) => t !== "[mídia]").reverse().join("\n");
  const ultimasMsgs = await prisma.igMessage.findMany({
    where: { conversationId: conversa.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const historico: Mensagem[] = ultimasMsgs
    .reverse()
    .map((m) => ({ de: m.direction === "IN" ? ("cliente" as const) : ("loja" as const), texto: m.text }));
  // Pedido de humano sem dúvida dita: antes de transferir, o robô descobre a pergunta (quase sempre
  // dá para ele mesmo responder). Só chama a atendente se a pessoa insistir ou se a base não responder.
  const pediuHumano = text.length <= 90 && pedeHumano(text);
  const contextoSemPedido = contexto
    .split("\n")
    .filter((l) => !(l.length <= 90 && pedeHumano(l)))
    .join("\n")
    .trim();
  // A pessoa mandou várias mensagens seguidas e outra execução já respondeu a última: não responde de novo.
  if (await jaRespondeuDepoisDaUltimaEntrada(conversa.id)) return;
  if (!(await souAUltima())) return;
  // Roteiro de compra da BFF já foi mandado nas últimas 12 h: segue o fluxo normal (triagem/FAQ) em vez de repetir.
  const jaMandouRoteiro =
    loja === "bff" &&
    !!(await prisma.igMessage.findFirst({
      where: {
        conversationId: conversa.id,
        direction: "OUT",
        source: "BOT",
        createdAt: { gt: HORAS(12) },
        OR: [{ matchedId: 9004 }, { matchedKind: "boasvindas" }],
      },
      select: { id: true },
    }));
  const r = pediuHumano && !contextoSemPedido
    ? ({ tipo: "pedir_duvida" } as const)
    : await responder(loja, (pediuHumano ? contextoSemPedido : contexto) || text, historico, { ultimaMensagem: text, semRoteiroCompra: jaMandouRoteiro });

  // A IA demora: confere de novo antes de qualquer efeito (etiqueta, transferência, envio).
  if (await jaRespondeuDepoisDaUltimaEntrada(conversa.id)) return;
  if (!(await souAUltima())) return;

  if (pediuHumano) await etiquetar(conversa.id, [TAG.pediuHumano]);

  let saida: Saida;
  if (r.tipo === "pedir_duvida") {
    const pedidos = await prisma.igMessage.count({
      where: { conversationId: conversa.id, direction: "OUT", matchedKind: "pedir_duvida", createdAt: { gt: HORAS(24) } },
    });
    if (pedidos === 0) {
      saida = { texto: "Claro! Me conta qual é a sua dúvida? 😊", kind: "pedir_duvida" };
    } else if (pedidos === 1) {
      await etiquetar(conversa.id, [TAG.semDuvida]);
      saida = {
        texto: "Então, primeiro preciso saber qual é a sua dúvida pra te direcionar certinho 😊",
        partes: [
          "Então, primeiro preciso saber qual é a sua dúvida pra te direcionar certinho 😊",
          "Me conta aqui que, se eu não conseguir resolver, eu passo pra uma atendente.",
        ],
        kind: "pedir_duvida",
      };
    } else {
      // Insistiu: procura uma atendente (fica não lida). Sem resposta em ~10 min, o robô volta e oferece
      // continuar o atendimento (igSeguimento, chamado pelo agendador).
      const jaProcurando = await prisma.igMessage.findFirst({
        where: { conversationId: conversa.id, matchedKind: "procurando_atendente", createdAt: { gt: HORAS(1) } },
        select: { id: true },
      });
      saida = {
        texto: jaProcurando ? "Ainda estou tentando localizar uma atendente, já já ela te responde 🙏" : "Tá, vou tentar localizar uma atendente disponível, só um instante 🙏",
        kind: "procurando_atendente",
      };
      await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "NEEDS_HUMAN", naoLida: true } });
      await transferida(conversa.id, "Pediu atendente e insistiu sem dizer a dúvida");
    }
  } else if (r.tipo === "resposta") {
    // Primeira conversa e a pessoa ainda não segue: a resposta já leva o convite para seguir.
    const convite = primeiroContato && config.pedirSeguir && naoSegue && config.textoSeguir.trim() ? [config.textoSeguir] : [];
    const partes = [...r.partes, ...convite];
    saida = { texto: partes.join("\n"), partes, kind: r.kind, id: r.id, confianca: r.confianca };
    // O status não muda aqui: conversa NEEDS_HUMAN nem chega até este ponto (o robô fica quieto) e HUMAN vencido já voltou para BOT.
    await etiquetar(conversa.id, [r.id === 9004 ? TAG.querComprar : TAG.resolvidoRobo], [TAG.semDuvida]);
  } else if (r.tipo === "atraso") {
    await etiquetar(conversa.id, [TAG.atraso, TAG.comprador]); // reclamar de pedido = já comprou
    // Pedido atrasado: 1ª vez orienta a conferir no app (todo mundo para dentro do app);
    // se a pessoa volta dizendo que já passou do prazo, chama a atendente.
    const jaOrientou = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, matchedKind: "atraso", createdAt: { gt: HORAS(24) } },
      select: { id: true },
    });
    if (!jaOrientou) {
      saida = {
        texto: "Entendi, vou te ajudar com isso.",
        partes: [
          "Entendi, vou te ajudar com isso 😊",
          `Primeiro confere no app: entra na sua conta, vai em Minha conta e vê a movimentação do seu pedido. ${APP_BFF}`,
          "Se por lá já passou do prazo de entrega, me avisa aqui que eu chamo uma atendente.",
        ],
        kind: "atraso",
      };
    } else {
      saida = {
        texto: "Vou chamar uma atendente pra verificar o seu pedido, já já ela te responde por aqui.",
        kind: "atendente",
      };
      await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "NEEDS_HUMAN", naoLida: true } });
      await transferida(conversa.id, "Pedido atrasado depois do prazo");
    }
  } else if (r.tipo === "saudacao") {
    // Já cumprimentou nas últimas 6 h: não manda outra saudação.
    const jaSaudou = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, direction: "OUT", matchedKind: { in: ["boasvindas", "saudacao"] }, createdAt: { gt: HORAS(6) } },
      select: { id: true },
    });
    if (jaSaudou) return;
    if (primeiroContato && config.ativo && loja === "bff") {
      // BFF: quem chega só cumprimentando recebe direto o caminho de compra no atacado (a galera não explica o que quer).
      const abertura = aplicarNome(ATACADO_BFF.texto, perfil?.nome ?? null);
      saida = { texto: abertura, kind: "boasvindas", id: 9004, link: ATACADO_BFF.link, seguinte: ATACADO_BFF.seguinte };
    } else if (primeiroContato && config.ativo) {
      // Boas-vindas com botões (como no ManyChat): convida a receber as informações e a seguir a loja.
      const abertura = aplicarNome(config.mensagem, perfil?.nome ?? null);
      const convite = config.pedirSeguir && naoSegue && config.textoSeguir.trim() ? [config.textoSeguir] : [];
      saida = {
        texto: abertura,
        // Uma pergunta só e espera a resposta; o convite para seguir vai numa mensagem curta separada.
        partes: [abertura, ...convite],
        kind: "boasvindas",
        // Botões só se o texto do botão estiver preenchido no editor.
        quickReplies: config.botao.trim()
          ? [
              { title: config.botao, payload: PAYLOAD_SIM },
              { title: BOTAO_DUVIDA, payload: PAYLOAD_DUVIDA },
            ]
          : undefined,
      };
    } else {
      // Só cumprimentou ou disse que tem uma dúvida: convida a perguntar (não conta como falha).
      saida = { texto: r.texto, kind: "saudacao" };
    }
  } else {
    console.warn(`[ig-bot] conversa ${conversa.id} sem resposta na base: ${r.motivo}`);
    // Já chamou atendente nas últimas 12h: não insiste, a equipe vai responder.
    const jaChamou = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, matchedKind: "atendente", createdAt: { gt: HORAS(12) } },
    });
    if (jaChamou) return;
    // Quantos pedidos de detalhes seguidos o robô já fez.
    const ultimas = await prisma.igMessage.findMany({
      where: { conversationId: conversa.id, direction: "OUT", createdAt: { gt: HORAS(24) } },
      orderBy: { createdAt: "desc" },
      take: MAX_ESCLARECIMENTOS,
    });
    let seguidos = 0;
    for (const m of ultimas) {
      if (m.matchedKind !== "esclarecer") break;
      seguidos++;
    }
    if (seguidos < MAX_ESCLARECIMENTOS) {
      const texto = await escreverApoio(loja, seguidos === 0 ? "esclarecer1" : "esclarecer2", historico).catch(() => ESCLARECER[seguidos]);
      saida = { texto: texto || ESCLARECER[seguidos], kind: "esclarecer" };
    } else {
      const texto = await escreverApoio(loja, "atendente", historico).catch(() => CHAMAR_ATENDENTE);
      saida = { texto: texto || CHAMAR_ATENDENTE, kind: "atendente" };
      // Fila da equipe: a atendente responde pelo próprio Instagram. Fica NÃO LIDA até alguém abrir.
      await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "NEEDS_HUMAN", naoLida: true } });
      await transferida(conversa.id, "Robô não entendeu a dúvida");
    }
  }

  // As etiquetas aplicadas acima (Pediu humano, Pedido atrasado…) podem ter disparado uma regra/fluxo que já respondeu.
  if (await automacaoJaCuidou(conversa.id, entrada.createdAt, statusInicial)) return;
  // Uma atendente pode ter respondido enquanto a IA pensava: NEEDS_HUMAN ainda vale (é o próprio "procurando atendente"), HUMAN ativo não.
  if (!(await roboPodeFalar(conversa.id, { permitirNeedsHuman: true }))) return;
  if (!(await souAUltima())) return;
  await enviarEGravar(account, conversa.id, ev.sender.id, saida);
  if (saida.seguinte) {
    // Segunda mensagem (botões do app, do catálogo e do grupo VIP) alguns minutos depois: o agendador de 5 min envia,
    // e só se ninguém assumiu a conversa nesse meio tempo.
    await agendarEnvio(conversa.id, saida.seguinte.texto, saida.seguinte.links, saida.kind, saida.seguinte.depoisMin).catch((err) =>
      console.error("[ig-webhook] não consegui agendar a segunda mensagem", err),
    );
  }}
