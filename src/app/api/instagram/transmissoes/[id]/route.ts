import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";

// Cancela uma transmissão que ainda está enviando.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  await prisma.igTransmissao.updateMany({ where: { id, status: "ENVIANDO" }, data: { status: "CANCELADA" } });
  return NextResponse.json({ ok: true });
}
