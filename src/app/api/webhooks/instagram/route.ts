import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { assinaturaValida, dentroDaJanela, enviarDm } from "@/lib/instagram";
import { responder } from "@/lib/igBot";
import type { Loja } from "@/lib/avaliacoesLeitura";

// Quando o robô não tem resposta, encaminha para o WhatsApp da loja (a equipe
// responde mais rápido por lá). Números dos próprios sites das lojas.
const WHATSAPP: Record<Loja, string> = {
  bff: "5527936187331",
  moranga: "5527998924839",
};
const MAX_ESCLARECIMENTOS = 2;
const ESCLARECER = [
  "Oi! Não consegui entender bem a sua dúvida. Pode me explicar com mais detalhes o que você quer saber?",
  "Ainda não consegui entender. Pode tentar explicar de outro jeito? Por exemplo, sobre qual produto, pedido ou assunto é a sua dúvida?",
];
const textoWhatsapp = (loja: Loja) =>
  `Acho que não estou conseguindo entender o que você quer saber. Melhor falar com a nossa equipe no WhatsApp, que resolve isso com você: https://wa.me/${WHATSAPP[loja]}`;

type Evento = {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};
type Payload = { object?: string; entry?: { id: string; messaging?: Evento[] }[] };

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

async function tratarEvento(ev: Evento) {
  const text = ev.message?.text?.trim();
  if (!text || ev.message?.is_echo || !ev.sender?.id || !ev.recipient?.id) return;

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
  await prisma.igConversation.update({
    where: { id: conversa.id },
    data: { lastCustomerMessageAt: agora },
  });

  // Humano assumiu ou conversa encerrada: o robô fica quieto.
  if (conversa.status === "HUMAN" || conversa.status === "CLOSED") return;
  if (!dentroDaJanela(agora)) return;

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
  if (r.tipo === "humano") {
    console.warn(`[ig-bot] conversa ${conversa.id} sem resposta na base: ${r.motivo}`);
    await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "NEEDS_HUMAN" } });
    // Já encaminhou ao WhatsApp nas últimas 12h: não insiste (lá a loja paga por mensagem).
    const jaEncaminhou = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, matchedKind: "whatsapp", createdAt: { gt: new Date(Date.now() - 12 * 60 * 60 * 1000) } },
    });
    if (jaEncaminhou) return;
    // Quantos pedidos de esclarecimento seguidos o robô já fez (para no primeiro envio de outro tipo).
    const ultimas = await prisma.igMessage.findMany({
      where: { conversationId: conversa.id, direction: "OUT", createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { createdAt: "desc" },
      take: MAX_ESCLARECIMENTOS,
    });
    let seguidos = 0;
    for (const m of ultimas) {
      if (m.matchedKind !== "esclarecer") break;
      seguidos++;
    }
    resposta =
      seguidos < MAX_ESCLARECIMENTOS
        ? { texto: ESCLARECER[seguidos], kind: "esclarecer", id: null, confianca: null }
        : { texto: textoWhatsapp(loja), kind: "whatsapp", id: null, confianca: null };
  } else {
    resposta = { texto: r.texto, kind: r.kind, id: r.id, confianca: r.confianca };
    if (conversa.status !== "BOT") {
      await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "BOT" } });
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
