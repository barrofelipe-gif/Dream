import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoPainel } from "@/lib/igLoja";
import { exigirAdmin } from "@/lib/igAdmin";

// Sino do painel. GET → { naoLidas, itens } (últimos 30; ?todas=1 inclui as lidas).
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const todas = req.nextUrl.searchParams.get("todas") === "1";
  // Só avisos de conversas da empresa escolhida no painel (o aviso guarda só o id da conversa, sem relação no banco).
  const loja = await lojaDoPainel();
  const daLoja = { conversationId: { in: (await prisma.igConversation.findMany({ where: { account: { loja } }, select: { id: true } })).map((c) => c.id) } };
  const [naoLidas, itens] = await Promise.all([
    prisma.igNotificacao.count({ where: { ...daLoja, lida: false } }),
    prisma.igNotificacao.findMany({ where: todas ? daLoja : { ...daLoja, lida: false }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  const conversas = await prisma.igConversation.findMany({
    where: { id: { in: [...new Set(itens.map((i) => i.conversationId))] } },
    select: { id: true, nome: true, username: true, status: true, account: { select: { username: true, loja: true } } },
  });
  const porId = new Map(conversas.map((c) => [c.id, c]));
  return NextResponse.json({
    naoLidas,
    itens: itens.map((i) => ({ ...i, conversa: porId.get(i.conversationId) ?? null })),
  });
}

// POST { ids?: string[] } → marca como lidas (sem ids = todas). POST { conversationId } → marca as dessa conversa.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === "string") : null;
  const conversationId = typeof b.conversationId === "string" ? b.conversationId : null;
  const r = await prisma.igNotificacao.updateMany({
    where: { lida: false, ...(ids ? { id: { in: ids } } : {}), ...(conversationId ? { conversationId } : {}) },
    data: { lida: true },
  });
  return NextResponse.json({ ok: true, marcadas: r.count });
}
