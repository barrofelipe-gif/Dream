import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

const itemInput = z.object({
  category: z.enum(["processos", "bff", "emails", "viagens"]),
  bffSub: z.enum(["financeiro", "fornecedor", "produto", "outro"]).nullish(),
  title: z.string().trim().min(1, "Título é obrigatório"),
  detail: z.string().trim().nullish(),
  company: z.string().trim().nullish(),
  lawyer: z.string().trim().nullish(),
  processNumber: z.string().trim().nullish(),
  lastMovement: z.string().trim().nullish(),
  due: z.string().datetime().nullish().or(z.literal("").transform(() => null)),
  priority: z.enum(["alta", "media", "baixa"]).default("media"),
  status: z.enum(["pendente", "andamento", "concluido"]).default("pendente"),
  recurring: z.enum(["none", "daily", "weekly", "monthly"]).default("none"),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");
  const status = searchParams.get("status");
  const priority = searchParams.get("priority");
  const q = searchParams.get("q");

  const items = await prisma.item.findMany({
    where: {
      ownerId: session.user.id,
      ...(category ? { category: category as never } : {}),
      ...(status ? { status: status as never } : {}),
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
    orderBy: [{ due: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(items);
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
  const item = await prisma.item.create({
    data: {
      ownerId: session.user.id,
      category: data.category,
      bffSub: data.category === "bff" ? (data.bffSub ?? null) : null,
      title: data.title,
      detail: data.detail || null,
      company: data.company || null,
      lawyer: data.lawyer || null,
      processNumber: data.processNumber || null,
      lastMovement: data.lastMovement || null,
      due: data.due ? new Date(data.due) : null,
      priority: data.priority,
      status: data.status,
      recurring: data.recurring,
      source: "manual",
    },
  });

  return NextResponse.json(item, { status: 201 });
}
