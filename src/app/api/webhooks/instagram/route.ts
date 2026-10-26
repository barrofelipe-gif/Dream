import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { assinaturaValida, dentroDaJanela, enviarDm } from "@/lib/instagram";
import { responder, escreverApoio, escreverInfoCompra, type Mensagem } from "@/lib/igBot";
import { atualizarPerfil } from "@/lib/igPerfil";
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
  };
  postback?: { mid?: string; title?: string; payload?: string };
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
          await processarComentario({
            contaId: entry.id,
            commentId: c.value.id,
            texto: c.value.text ?? "",
            userId: c.value.from.id,
            username: c.value.from.username,
            midiaId: c.value.media?.id ?? "",
            parentId: c.value.parent_id,
          });
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
  if (mid && (await prisma.igMessage.findUnique({ where: { metaMessageId: mid } }))) return; // foi o robô
  // O eco do envio do robô pode chegar antes de gravarmos o id: tolerância de 30s.
  const recenteNosso = await prisma.igMessage.findFirst({
    where: {
      conversationId: conversa.id,
      direction: "OUT",
      createdAt: { gt: new Date(Date.now() - 30_000) },
      OR: [{ source: "BOT" }, { text: ev.message?.text?.trim() || "[mídia]" }],
    },
  });
  if (recenteNosso) return;

  await prisma.igMessage.create({
    data: {
      conversationId: conversa.id,
      direction: "OUT",
      source: "HUMANO",
      text: ev.message?.text?.trim() || "[mídia]",
      metaMessageId: mid,
    },
  });
  // Quem respondeu pelo Instagram obviamente leu a conversa.
  await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "HUMAN", naoLida: false } });
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
};

/** Envia a mensagem no Instagram e grava na conversa como do robô. */
async function enviarEGravar(conta: Conta, conversaId: string, destinatario: string, s: Saida) {
  const partes = s.partes?.length ? s.partes : [s.texto];
  for (let i = 0; i < partes.length; i++) {
    const ultima = i === partes.length - 1;
    if (i > 0) await new Promise((r) => setTimeout(r, 1200)); // pausa curta: parece digitação, não rajada
    const sentId = await enviarDm({
      igUserId: conta.igUserId,
      encryptedToken: conta.accessToken,
      recipientId: destinatario,
      text: partes[i],
      quickReplies: ultima ? s.quickReplies : undefined,
      link: ultima ? s.link : undefined,
    });
    await prisma.igMessage.create({
      data: {
        conversationId: conversaId,
        direction: "OUT",
        source: "BOT",
        text: partes[i],
        metaMessageId: sentId || null,
        matchedKind: s.kind,
        matchedId: s.id ?? null,
        confidence: s.confianca ?? null,
      },
    });
  }
}

async function tratarEvento(ev: Evento) {
  if (ev.message?.is_echo) return tratarEco(ev);
  // Toque em botão de resposta rápida (message.quick_reply) ou em botão do modelo (postback).
  const botao = ev.message?.quick_reply?.payload ?? ev.postback?.payload;
  // Alguém marcou a loja num story: chega como anexo "story_mention", sem texto.
  const mencionou = !!ev.message?.attachments?.some((a) => a.type === "story_mention");
  const text = ev.message?.text?.trim() || ev.postback?.title?.trim() || (mencionou ? "[Marcou a loja num story]" : undefined);
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
  await prisma.igMessage.create({
    data: { conversationId: conversa.id, direction: "IN", source: "CLIENTE", text, metaMessageId: mid },
  });
  // Conversa com a equipe envolvida (aguardando ou atendendo): cada mensagem nova do cliente
  // volta a aparecer como NÃO LIDA na caixa de entrada.
  const comEquipe = conversa.status === "NEEDS_HUMAN" || conversa.status === "HUMAN";
  await prisma.igConversation.update({
    where: { id: conversa.id },
    data: { lastCustomerMessageAt: agora, ...(comEquipe ? { naoLida: true } : {}) },
  });

  await atualizarPerfil(conversa.id);

  // "Já segui" de uma automação de comentário: confere o follow e libera o conteúdo.
  if (botao?.startsWith(PREFIXO_POSTBACK)) {
    await processarPostbackAutomacao(ev.recipient.id, ev.sender.id, botao);
    return;
  }

  if (conversa.status === "CLOSED") return;
  if (!dentroDaJanela(agora)) return;

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

  // Uma atendente assumiu: o robô fica quieto enquanto ela está ativa (24h desde a
  // última mensagem dela); passado isso, volta a atender.
  if (conversa.status === "HUMAN") {
    const ativa = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, direction: "OUT", source: "HUMANO", createdAt: { gt: HORAS(24) } },
    });
    if (ativa) return;
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
  // A pessoa costuma explicar em várias mensagens: o robô lê as últimas (30 min) juntas.
  const recentes = await prisma.igMessage.findMany({
    where: { conversationId: conversa.id, direction: "IN", createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  const contexto = recentes.map((m) => m.text).reverse().join("\n");
  const ultimasMsgs = await prisma.igMessage.findMany({
    where: { conversationId: conversa.id },
    orderBy: { createdAt: "desc" },
    take: 10,
  });
  const historico: Mensagem[] = ultimasMsgs
    .reverse()
    .map((m) => ({ de: m.direction === "IN" ? ("cliente" as const) : ("loja" as const), texto: m.text }));
  const r = await responder(loja, contexto || text, historico);

  let saida: Saida;
  if (r.tipo === "resposta") {
    // Primeira conversa e a pessoa ainda não segue: a resposta já leva o convite para seguir.
    const convite = primeiroContato && config.pedirSeguir && naoSegue && config.textoSeguir.trim() ? [config.textoSeguir] : [];
    const partes = [...r.partes, ...convite];
    saida = { texto: partes.join("\n"), partes, kind: r.kind, id: r.id, confianca: r.confianca };
    if (conversa.status !== "BOT") {
      await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "BOT" } });
    }
  } else if (r.tipo === "atraso") {
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
    }
  } else if (r.tipo === "saudacao") {
    if (primeiroContato && config.ativo) {
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
    }
  }

  await enviarEGravar(account, conversa.id, ev.sender.id, saida);
}
