import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const patchInput = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  isDone: z.boolean().optional(),
});

async function findOwnedColumn(id: string, ownerId: string) {
  const column = await prisma.column.findUnique({ where: { id } });
  if (!column || column.ownerId !== ownerId) return null;
  return column;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const existing = await findOwnedColumn(id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

  const parsed = patchInput.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const column = await prisma.column.update({ where: { id }, data: parsed.data });
  return NextResponse.json(column);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const existing = await findOwnedColumn(id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Não encontrada" }, { status: 404 });

  const columnCount = await prisma.column.count({ where: { ownerId: session.user.id, category: existing.category } });
  if (columnCount <= 1) {
    return NextResponse.json({ error: "Precisa deixar pelo menos uma coluna nessa categoria" }, { status: 400 });
  }

  const itemCount = await prisma.item.count({ where: { columnId: id } });
  if (itemCount > 0) {
    return NextResponse.json(
      { error: `Essa coluna tem ${itemCount} pendência(s). Mova ou apague os cards antes de excluir a coluna.` },
      { status: 400 }
    );
  }

  await prisma.column.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
