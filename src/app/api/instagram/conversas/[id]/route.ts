import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { dentroDaJanela } from "@/lib/instagram";

// Uma conversa com todas as mensagens (a caixa de entrada atualiza isto a cada poucos segundos).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;

  const c = await prisma.igConversation.findUnique({
    where: { id },
    include: { account: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!c) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

  return NextResponse.json({
    id: c.id,
    status: c.status,
    cliente: c.igScopedUserId.slice(-6),
    conta: c.account.username,
    loja: c.account.loja,
    janelaAberta: dentroDaJanela(c.lastCustomerMessageAt),
    lastCustomerMessageAt: c.lastCustomerMessageAt?.toISOString() ?? null,
    mensagens: c.messages.map((m) => ({
      id: m.id,
      de: m.direction === "IN" ? "cliente" : m.source === "HUMANO" ? "equipe" : "robo",
      texto: m.text,
      em: m.createdAt.toISOString(),
      origem: m.matchedKind,
    })),
  });
}

// Assumir (HUMAN), devolver ao robô (BOT) ou encerrar (CLOSED).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (!status || !["BOT", "HUMAN", "CLOSED", "NEEDS_HUMAN"].includes(status)) {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }
  await prisma.igConversation.update({ where: { id }, data: { status } });
  return NextResponse.json({ ok: true });
}
