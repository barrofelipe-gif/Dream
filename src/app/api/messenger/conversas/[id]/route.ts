import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { janela } from "@/lib/messenger";

// Uma conversa do Messenger com as mensagens; abrir marca como lida.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const c = await prisma.fbConversa.findUnique({ where: { id }, include: { mensagens: { orderBy: { createdAt: "desc" }, take: 300 } } });
  if (!c) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  if (c.naoLida) await prisma.fbConversa.update({ where: { id }, data: { naoLida: false } });
  return NextResponse.json({
    id: c.id,
    status: c.status,
    nome: c.nome,
    fotoUrl: c.fotoUrl,
    cliente: c.psid.slice(-6),
    loja: c.loja,
    janela: janela(c.lastCustomerMessageAt),
    // As 300 mais recentes, em ordem de leitura.
    mensagens: [...c.mensagens].reverse().map((m) => ({
      id: m.id,
      de: m.direction === "IN" ? "cliente" : m.source === "BOT" ? "robo" : "equipe",
      texto: m.text,
      em: m.createdAt.toISOString(),
    })),
  });
}

const STATUS = ["BOT", "NEEDS_HUMAN", "HUMAN", "CLOSED"];

// Muda quem atende: devolver ao robô, assumir, encerrar.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const { status } = (await req.json().catch(() => ({}))) as { status?: string };
  if (!status || !STATUS.includes(status)) return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  const r = await prisma.fbConversa.updateMany({ where: { id }, data: { status } });
  if (r.count === 0) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
