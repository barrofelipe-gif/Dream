import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const input = z.object({ orderedIds: z.array(z.string()).min(1) });

// Recebe a lista de ids da categoria na nova ordem e regrava `order` = índice.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = input.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { orderedIds } = parsed.data;
  const columns = await prisma.column.findMany({ where: { id: { in: orderedIds } } });
  if (columns.some((c) => c.ownerId !== session.user.id)) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 403 });
  }

  await prisma.$transaction(
    orderedIds.map((id, index) => prisma.column.update({ where: { id }, data: { order: index } }))
  );

  return NextResponse.json({ ok: true });
}
