import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { assinaturaValida, dentroDaJanela, enviarDm } from "@/lib/instagram";
import { responder } from "@/lib/igBot";
import type { Loja } from "@/lib/avaliacoesLeitura";

type Evento = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};
type Payload = { object?: string; entry?: { id: string; messaging?: Evento[] }[] };

const MAX_ESCLARECIMENTOS = 2;
const ESCLARECER = [
  "Oi! Não consegui entender bem a sua dúvida. Pode me explicar com mais detalhes o que você quer saber?",
  "Ainda não consegui entender. Pode tentar explicar de outro jeito? Por exemplo, sobre qual produto, pedido ou assunto é a sua dúvida?",
];
const CHAMAR_ATENDENTE =
  "Como eu não estou conseguindo entender o que você precisa, vou chamar uma atendente aqui para te ajudar. Já já ela te responde por aqui.";

function saudacao(): string {
  const hora = Number(
    new Intl.DateTimeFormat("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" }).format(new Date()),
  );
  const periodo = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const variantes = [
    `${periodo}! Tudo bem? O que eu posso te ajudar hoje?`,
    `Ei, ${periodo.toLowerCase()}! O que eu posso fazer por você hoje?`,
    `Oi, ${periodo.toLowerCase()}! Qual é a sua dúvida? Pode me contar que eu te ajudo.`,
  ];
  return variantes[Math.floor(Math.random() * variantes.length)];
}

const HORAS = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

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
  const recenteDoRobo = await prisma.igMessage.findFirst({
    where: { conversationId: conversa.id, direction: "OUT", source: "BOT", createdAt: { gt: new Date(Date.now() - 30_000) } },
  });
  if (recenteDoRobo) return;

  await prisma.igMessage.create({
    data: {
      conversationId: conversa.id,
      direction: "OUT",
      source: "HUMANO",
      text: ev.message?.text?.trim() || "[mídia]",
      metaMessageId: mid,
    },
  });
  await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "HUMAN" } });
}

async function tratarEvento(ev: Evento) {
  if (ev.message?.is_echo) return tratarEco(ev);
  const text = ev.message?.text?.trim();
  if (!text || !ev.sender?.id || !ev.recipient?.id) return;

  const account = await prisma.instagramAccount.findUnique({ where: { igUserId: ev.recipient.id } });
  if (!account?.active) return;

  // Idempotência: a Meta reenvia o mesmo webhook se demorarmos ou falharmos.
  const mid = ev.message?.mid;
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
  await prisma.igConversation.update({ where: { id: conversa.id }, data: { lastCustomerMessageAt: agora } });

  if (conversa.status === "CLOSED") return;
  if (!dentroDaJanela(agora)) return;

  // Uma atendente assumiu: o robô fica quieto enquanto ela está ativa (24h desde a
  // última mensagem dela); passado isso, volta a atender.
  if (conversa.status === "HUMAN") {
    const ativa = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, direction: "OUT", source: "HUMANO", createdAt: { gt: HORAS(24) } },
    });
    if (ativa) return;
  }

  const loja = account.loja as Loja;

  // A pessoa costuma explicar em várias mensagens: o robô lê as últimas (30 min) juntas.
  const recentes = await prisma.igMessage.findMany({
    where: { conversationId: conversa.id, direction: "IN", createdAt: { gt: new Date(Date.now() - 30 * 60 * 1000) } },
    orderBy: { createdAt: "desc" },
    take: 3,
  });
  const contexto = recentes.map((m) => m.text).reverse().join("\n");
  const r = await responder(loja, contexto || text);

  let resposta: { texto: string; kind: string; id: number | null; confianca: string | null };
  if (r.tipo === "resposta") {
    resposta = { texto: r.texto, kind: r.kind, id: r.id, confianca: r.confianca };
    if (conversa.status !== "BOT") {
      await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "BOT" } });
    }
  } else if (r.tipo === "saudacao") {
    // Só cumprimentou ou disse que tem uma dúvida: convida a perguntar (não conta como falha).
    resposta = { texto: saudacao(), kind: "saudacao", id: null, confianca: null };
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
      resposta = { texto: ESCLARECER[seguidos], kind: "esclarecer", id: null, confianca: null };
    } else {
      resposta = { texto: CHAMAR_ATENDENTE, kind: "atendente", id: null, confianca: null };
      // Fila da equipe: a atendente responde pelo próprio Instagram.
      await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "NEEDS_HUMAN" } });
    }
  }

  const sentId = await enviarDm({
    igUserId: account.igUserId,
    encryptedToken: account.accessToken,
    recipientId: ev.sender.id,
    text: resposta.texto,
  });
  await prisma.igMessage.create({
    data: {
      conversationId: conversa.id,
      direction: "OUT",
      source: "BOT",
      text: resposta.texto,
      metaMessageId: sentId || null,
      matchedKind: resposta.kind,
      matchedId: resposta.id,
      confidence: resposta.confianca,
    },
  });
}
