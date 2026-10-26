import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { validarRegra } from "@/lib/igRegras";

type Ctx = { params: Promise<{ id: string }> };

// Edita a regra (nome, ativa, quando, fazer). Só os campos enviados mudam.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const atual = await prisma.igRegra.findUnique({ where: { id } });
  if (!atual) return NextResponse.json({ error: "Regra não encontrada" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.IgRegraUpdateInput = {};
  if (typeof b.nome === "string") {
    const nome = b.nome.trim().slice(0, 60);
    if (!nome) return NextResponse.json({ error: "Dê um nome à regra" }, { status: 400 });
    data.nome = nome;
  }
  if (typeof b.ativa === "boolean") data.ativa = b.ativa;
  if (b.quando !== undefined || b.fazer !== undefined) {
    const v = validarRegra(b.quando ?? atual.quando, b.fazer ?? atual.fazer);
    if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
    data.quando = v.quando as unknown as Prisma.InputJsonValue;
    data.fazer = v.fazer as unknown as Prisma.InputJsonValue;
  }
  const regra = await prisma.igRegra.update({ where: { id }, data });
  return NextResponse.json({ ok: true, regra });
}

export async function DELETE(_req: NextRequest, { params }: Ctx) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  await prisma.igRegra.deleteMany({ where: { id } });
  return NextResponse.json({ ok: true });
}
