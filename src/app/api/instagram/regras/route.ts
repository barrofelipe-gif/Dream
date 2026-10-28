import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { lojaDoPainel } from "@/lib/igLoja";
import { validarRegra } from "@/lib/igRegras";

export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const loja = await lojaDoPainel();
  const [regras, contas] = await Promise.all([
    prisma.igRegra.findMany({ where: { account: { loja } }, orderBy: { createdAt: "desc" }, include: { account: { select: { username: true, loja: true } } } }),
    prisma.instagramAccount.findMany({ where: { active: true, loja }, select: { id: true, username: true, loja: true } }),
  ]);
  return NextResponse.json({ regras, contas });
}

export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const nome = typeof b.nome === "string" ? b.nome.trim().slice(0, 60) : "";
  if (!accountId || !nome) return NextResponse.json({ error: "Escolha a conta e dê um nome à regra" }, { status: 400 });
  const conta = await prisma.instagramAccount.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!conta) return NextResponse.json({ error: "Conta não encontrada" }, { status: 400 });
  const v = validarRegra(b.quando, b.fazer);
  if (!v.ok) return NextResponse.json({ error: v.erro }, { status: 400 });
  const regra = await prisma.igRegra.create({
    data: {
      accountId,
      nome,
      ativa: b.ativa !== false,
      quando: v.quando as unknown as Prisma.InputJsonValue,
      fazer: v.fazer as unknown as Prisma.InputJsonValue,
    },
  });
  return NextResponse.json({ ok: true, regra });
}
