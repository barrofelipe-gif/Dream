import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ensureDefaultColumns } from "@/lib/columns";

const CATEGORY_VALUES = ["processos", "bff", "emails", "viagens"] as const;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const parsed = z.enum(CATEGORY_VALUES).safeParse(category);
  if (!parsed.success) return NextResponse.json({ error: "Categoria inválida" }, { status: 400 });

  // Pra montar o board de outra pessoa quando você atribui uma pendência a
  // ela ("Atribuir para") — só leitura, mesma lógica de time pequeno/confiança
  // já usada pra listar nomes de usuário.
  const targetUserId = searchParams.get("userId") || session.user.id;
  if (targetUserId !== session.user.id) {
    const targetUser = await prisma.user.findUnique({ where: { id: targetUserId } });
    if (!targetUser) return NextResponse.json({ error: "Usuário inválido" }, { status: 400 });
  }

  const columns = await ensureDefaultColumns(targetUserId, parsed.data);
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
