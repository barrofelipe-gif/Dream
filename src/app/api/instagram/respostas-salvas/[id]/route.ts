import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { limparAtalho } from "@/lib/igRespostasSalvas";

type Ctx = { params: Promise<{ id: string }> };

// Edita atalho, título, texto ou conta (accountId "" ou null = todas as contas).
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const atual = await prisma.igRespostaSalva.findUnique({ where: { id } });
  if (!atual) return NextResponse.json({ error: "Resposta não encontrada" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const atalho = typeof b.atalho === "string" ? limparAtalho(b.atalho) : atual.atalho;
  const titulo = typeof b.titulo === "string" ? b.titulo.trim().slice(0, 60) || atalho : atual.titulo;
  const texto = typeof b.texto === "string" ? b.texto.trim().slice(0, 1000) : atual.texto;
  const accountId = b.accountId === undefined ? atual.accountId : typeof b.accountId === "string" && b.accountId ? b.accountId : null;
  if (!atalho || !texto) return NextResponse.json({ error: "Informe o atalho e o texto" }, { status: 400 });
  const repetida = await prisma.igRespostaSalva.findFirst({ where: { atalho, accountId, id: { not: id } }, select: { id: true } });
  if (repetida) return NextResponse.json({ error: `Já existe o atalho /${atalho}` }, { status: 400 });
  const resposta = await prisma.igRespostaSalva.update({ where: { id }, data: { atalho, titulo, texto, accountId } });
  return NextResponse.json({ ok: true, resposta });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  await prisma.igRespostaSalva.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
