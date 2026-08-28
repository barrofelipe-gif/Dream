import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureDefaultColumns } from "@/lib/columns";

const CATEGORY_VALUES = ["processos", "bff", "emails", "viagens"] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const category = new URL(req.url).searchParams.get("category");
  const parsed = z.enum(CATEGORY_VALUES).safeParse(category);
  if (!parsed.success) return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });

  const columns = await ensureDefaultColumns(session.user.id, parsed.data);
  return NextResponse.json(columns);
}

const createInput = z.object({
  category: z.enum(CATEGORY_VALUES),
  name: z.string().trim().min(1, "Dá um nome pra coluna").max(40),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const parsed = createInput.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  // garante que as padrão já existem antes de acrescentar a nova no final
  const existing = await ensureDefaultColumns(session.user.id, parsed.data.category);
  const maxOrder = existing.reduce((max, c) => Math.max(max, c.order), -1);

  const column = await prisma.column.create({
    data: {
      ownerId: session.user.id,
      category: parsed.data.category,
      name: parsed.data.name,
      order: maxOrder + 1,
    },
  });

  return NextResponse.json(column, { status: 201 });
}
