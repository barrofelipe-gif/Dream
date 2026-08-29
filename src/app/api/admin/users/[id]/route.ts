import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { Sector as PrismaSector } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { SECTORS } from "@/lib/sectors";

const SECTOR_VALUES = SECTORS.map((s) => s.value) as [string, ...string[]];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return { error: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (session.user.role !== "admin") {
    return { error: NextResponse.json({ error: "Só admin gerencia usuários" }, { status: 403 }) };
  }
  return { session };
}

const patchInput = z.object({
  sectors: z.array(z.enum(SECTOR_VALUES)).optional(),
  role: z.enum(["admin", "membro"]).optional(),
});

// Substitui a lista de setores liberados pro usuário (e opcionalmente o role).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  const parsed = patchInput.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  if (parsed.data.sectors) {
    await prisma.sectorAccess.deleteMany({ where: { userId: id } });
    await prisma.sectorAccess.createMany({
      data: parsed.data.sectors.map((sector) => ({ userId: id, sector: sector as PrismaSector })),
    });
  }

  if (parsed.data.role) {
    await prisma.user.update({ where: { id }, data: { role: parsed.data.role } });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, session } = await requireAdmin();
  if (error) return error;

  const { id } = await params;
  if (id === session!.user.id) {
    return NextResponse.json({ error: "Não dá pra excluir o próprio usuário logado" }, { status: 400 });
  }

  await prisma.user.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
