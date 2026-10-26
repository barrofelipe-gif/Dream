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
const textoWhatsapp = (loja: Loja) =>
  `Oi! Para esse assunto, o melhor é falar com a nossa equipe no WhatsApp, que costuma responder mais rápido: https://wa.me/${WHATSAPP[loja]}`;

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
  const r = await responder(loja, text);

  let resposta: { texto: string; kind: string; id: number | null; confianca: string | null };
  if (r.tipo === "humano") {
    console.warn(`[ig-bot] conversa ${conversa.id} sem resposta na base: ${r.motivo}`);
    await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "NEEDS_HUMAN" } });
    // Não repete o encaminhamento para a mesma pessoa em 12h.
    const jaEncaminhou = await prisma.igMessage.findFirst({
      where: { conversationId: conversa.id, matchedKind: "whatsapp", createdAt: { gt: new Date(Date.now() - 12 * 60 * 60 * 1000) } },
    });
    if (jaEncaminhou) return;
    resposta = { texto: textoWhatsapp(loja), kind: "whatsapp", id: null, confianca: null };
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
