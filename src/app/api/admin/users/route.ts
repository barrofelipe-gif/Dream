import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
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

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;

  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
      sectorAccess: { select: { sector: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(
    users.map((u) => ({ ...u, sectors: u.sectorAccess.map((a) => a.sector), sectorAccess: undefined }))
  );
}

const createInput = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().email(),
  password: z.string().min(6, "Senha precisa de pelo menos 6 caracteres"),
  role: z.enum(["admin", "membro"]).default("membro"),
  sectors: z.array(z.enum(SECTOR_VALUES)).default([]),
});

export async function POST(req: NextRequest) {
  const { error } = await requireAdmin();
  if (error) return error;

  const parsed = createInput.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const data = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email: data.email.toLowerCase() } });
  if (existing) return NextResponse.json({ error: "Já existe um usuário com esse e-mail" }, { status: 409 });

  const passwordHash = await bcrypt.hash(data.password, 10);

  const user = await prisma.user.create({
    data: {
      name: data.name,
      email: data.email.toLowerCase(),
      passwordHash,
      role: data.role,
      sectorAccess: { create: data.sectors.map((sector) => ({ sector: sector as PrismaSector })) },
    },
    select: { id: true, name: true, email: true, role: true },
  });

  return NextResponse.json(user, { status: 201 });
}
