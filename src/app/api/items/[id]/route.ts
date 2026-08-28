import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const itemPatch = z.object({
  category: z.enum(["processos", "bff", "emails", "viagens"]).optional(),
  bffSub: z.enum(["financeiro", "fornecedor", "produto", "outro"]).nullish(),
  title: z.string().trim().min(1).optional(),
  detail: z.string().trim().nullish(),
  company: z.string().trim().nullish(),
  lawyer: z.string().trim().nullish(),
  processNumber: z.string().trim().nullish(),
  lastMovement: z.string().trim().nullish(),
  due: z.string().datetime().nullish().or(z.literal("").transform(() => null)),
  priority: z.enum(["alta", "media", "baixa"]).optional(),
  status: z.enum(["pendente", "andamento", "concluido"]).optional(),
  recurring: z.enum(["none", "daily", "weekly", "monthly"]).optional(),
});

async function findOwnedItem(id: string, ownerId: string) {
  const item = await prisma.item.findUnique({ where: { id } });
  if (!item || item.ownerId !== ownerId) return null;
  return item;
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const item = await findOwnedItem(id, session.user.id);
  if (!item) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  return NextResponse.json(item);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const existing = await findOwnedItem(id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  const body = await req.json();
  const parsed = itemPatch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const data = parsed.data;

  const nextCategory = data.category ?? existing.category;

  const item = await prisma.item.update({
    where: { id },
    data: {
      ...data,
      bffSub: nextCategory === "bff" ? (data.bffSub ?? existing.bffSub) : null,
      due: data.due === undefined ? undefined : data.due ? new Date(data.due) : null,
    },
  });

  return NextResponse.json(item);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { id } = await params;
  const existing = await findOwnedItem(id, session.user.id);
  if (!existing) return NextResponse.json({ error: "Não encontrado" }, { status: 404 });

  await prisma.item.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
