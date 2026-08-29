import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { itemInclude, serializeItem } from "@/lib/serialize";

const itemInput = z.object({
  category: z.enum(["processos", "bff", "emails", "viagens"]),
  bffSub: z.enum(["financeiro", "fornecedor", "produto", "outro"]).nullish(),
  columnId: z.string().min(1, "Escolha uma coluna"),
  ownerId: z.string().optional(), // pra quem a pendência é atribuída; default = quem está criando
  title: z.string().trim().min(1, "Título é obrigatório"),
  detail: z.string().trim().nullish(),
  company: z.string().trim().nullish(),
  lawyer: z.string().trim().nullish(),
  processNumber: z.string().trim().nullish(),
  lastMovement: z.string().trim().nullish(),
  due: z.string().datetime().nullish().or(z.literal("").transform(() => null)),
  priority: z.enum(["alta", "media", "baixa"]).default("media"),
  recurring: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const priority = searchParams.get("priority");
  const q = searchParams.get("q");

  const items = await prisma.item.findMany({
    where: {
      ownerId: session.user.id,
      ...(category ? { category: category as never } : {}),
      ...(priority ? { priority: priority as never } : {}),
      ...(q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { detail: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } },
              { processNumber: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    include: itemInclude,
    orderBy: [{ due: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(items.map(serializeItem));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const body = await req.json();
  const parsed = itemInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const data = parsed.data;
  const targetOwnerId = data.ownerId || session.user.id;

  if (targetOwnerId !== session.user.id) {
    const targetUser = await prisma.user.findUnique({ where: { id: targetOwnerId } });
    if (!targetUser) return NextResponse.json({ error: "Usuário inválido" }, { status: 400 });
  }

  const column = await prisma.column.findUnique({ where: { id: data.columnId } });
  if (!column || column.ownerId !== targetOwnerId || column.category !== data.category) {
    return NextResponse.json({ error: "Coluna inválida pra essa categoria/pessoa" }, { status: 400 });
  }

  const item = await prisma.item.create({
    data: {
      ownerId: targetOwnerId,
      assignedById: targetOwnerId !== session.user.id ? session.user.id : null,
      category: data.category,
      bffSub: data.category === "bff" ? (data.bffSub ?? null) : null,
      columnId: data.columnId,
      title: data.title,
      detail: data.detail || null,
      company: data.company || null,
      lawyer: data.lawyer || null,
      processNumber: data.processNumber || null,
      lastMovement: data.lastMovement || null,
      due: data.due ? new Date(data.due) : null,
      priority: data.priority,
      recurring: data.recurring,
      source: "manual",
    },
    include: itemInclude,
  });

  return NextResponse.json(serializeItem(item), { status: 201 });
}
