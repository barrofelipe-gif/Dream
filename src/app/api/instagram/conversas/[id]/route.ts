import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { dentroDaJanela } from "@/lib/instagram";
import { atualizarPerfil } from "@/lib/igPerfil";
import { etiquetar } from "@/lib/igTags";

// Uma conversa com todas as mensagens (a caixa de entrada atualiza isto a cada poucos segundos).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;

  await atualizarPerfil(id); // só refaz se passou de 12h
  // Abrir a conversa = leu: tira o destaque de não lida.
  await prisma.igConversation.updateMany({ where: { id, naoLida: true }, data: { naoLida: false } });
  const c = await prisma.igConversation.findUnique({
    where: { id },
    include: { account: true, messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!c) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 });

  return NextResponse.json({
    id: c.id,
    nome: c.nome,
    username: c.username,
    fotoUrl: c.fotoUrl,
    seguidores: c.seguidores,
    verificado: c.verificado,
    seguePagina: c.seguePagina,
    primeiroContato: c.createdAt.toISOString(),
    totalMensagens: c.messages.length,
    status: c.status,
    tags: c.tags,
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
  const body = (await req.json().catch(() => ({}))) as { status?: string; naoLida?: boolean; tagAdd?: string; tagRemove?: string };
  if (body.tagAdd || body.tagRemove) {
    const tags = await etiquetar(id, body.tagAdd ? [body.tagAdd] : [], body.tagRemove ? [body.tagRemove] : []);
    return NextResponse.json({ ok: true, tags });
  }
  if (typeof body.naoLida === "boolean") {
    await prisma.igConversation.update({ where: { id }, data: { naoLida: body.naoLida } });
    return NextResponse.json({ ok: true });
  }
  const { status } = body;
  if (!status || !["BOT", "HUMAN", "CLOSED", "NEEDS_HUMAN"].includes(status)) {
    return NextResponse.json({ error: "Status inválido" }, { status: 400 });
  }
  // Assumir grava o momento: o robô fica quieto enquanto a atendente estiver ativa (24h desde a última atividade dela).
  await prisma.igConversation.update({ where: { id }, data: { status, assumidaEm: status === "HUMAN" ? new Date() : null } });
  return NextResponse.json({ ok: true });
}
