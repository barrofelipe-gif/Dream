import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { dentroDaJanela, enviarDm } from "@/lib/instagram";

// Resposta manual (da atendente) pela caixa de entrada: envia no Instagram, grava como "equipe"
// e coloca a conversa em HUMAN (o robô para de atender enquanto ela estiver ativa).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const { texto } = (await req.json().catch(() => ({}))) as { texto?: string };
  const msg = texto?.trim();
  if (!msg) return NextResponse.json({ error: "Escreva a mensagem" }, { status: 400 });
  if (msg.length > 1000) return NextResponse.json({ error: "Mensagem longa demais (máx. 1000)" }, { status: 400 });

  const c = await prisma.igConversation.findUnique({ where: { id }, include: { account: true } });
  if (!c) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  // Regra da Meta: só dá para responder até 24h depois da última mensagem do cliente.
  if (!dentroDaJanela(c.lastCustomerMessageAt)) {
    return NextResponse.json(
      { error: "Passaram mais de 24h desde a última mensagem do cliente: o Instagram não permite responder por aqui." },
      { status: 409 },
    );
  }

  let sentId = "";
  try {
    sentId = await enviarDm({
      igUserId: c.account.igUserId,
      encryptedToken: c.account.accessToken,
      recipientId: c.igScopedUserId,
      text: msg,
    });
  } catch (e) {
    console.error("[ig-inbox] falha ao enviar", e);
    return NextResponse.json({ error: "O Instagram recusou o envio. Tente de novo em instantes." }, { status: 502 });
  }

  await prisma.igMessage.create({
    data: { conversationId: c.id, direction: "OUT", source: "HUMANO", text: msg, metaMessageId: sentId || null },
  });
  await prisma.igConversation.update({ where: { id: c.id }, data: { status: "HUMAN", assumidaEm: new Date() } });
  return NextResponse.json({ ok: true });
}
