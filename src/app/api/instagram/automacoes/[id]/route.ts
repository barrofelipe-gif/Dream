import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { lerAutomacao } from "@/lib/igAutomacaoCampos";

// Atualiza a automação inteira (ou só liga/desliga com { soAtivo: true, ativo }).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { soAtivo?: boolean; ativo?: boolean } | null;

  if (body?.soAtivo) {
    await prisma.igAutomacao.update({ where: { id }, data: { ativo: !!body.ativo } });
    return NextResponse.json({ ok: true });
  }
  const lido = lerAutomacao(body);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  await prisma.igAutomacao.update({ where: { id }, data: lido.dados as never });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  await prisma.igAutomacao.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
