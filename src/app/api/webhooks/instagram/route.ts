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

  // Humano assumiu ou conversa já aguarda humano: o robô fica quieto.
  if (conversa.status !== "BOT") return;
  if (!dentroDaJanela(agora)) return;

  const r = await responder(account.loja as Loja, text);
  if (r.tipo === "humano") {
    // Nunca inventa: passa para uma pessoa (fila NEEDS_HUMAN).
    await prisma.igConversation.update({ where: { id: conversa.id }, data: { status: "NEEDS_HUMAN" } });
    console.warn(`[ig-bot] conversa ${conversa.id} passou para humano: ${r.motivo}`);
    return;
  }

  const sentId = await enviarDm({
    igUserId: account.igUserId,
    encryptedToken: account.accessToken,
    recipientId: ev.sender.id,
    text: r.texto,
  });
  await prisma.igMessage.create({
    data: {
      conversationId: conversa.id,
      direction: "OUT",
      source: "BOT",
      text: r.texto,
      metaMessageId: sentId || null,
      matchedKind: r.kind,
      matchedId: r.id,
      confidence: r.confianca,
    },
  });
}
