import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { lerAutomacao } from "@/lib/igAutomacaoCampos";

// Lista as automações (de todas as contas conectadas).
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const [automacoes, contas] = await Promise.all([
    prisma.igAutomacao.findMany({ orderBy: { createdAt: "desc" }, include: { account: { select: { username: true, loja: true } } } }),
    prisma.instagramAccount.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, username: true, loja: true } }),
  ]);
  return NextResponse.json({ automacoes, contas });
}

// Cria uma automação (nasce desligada até você ativar).
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const body = (await req.json().catch(() => null)) as { accountId?: string } | null;
  const lido = lerAutomacao(body);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  if (!body?.accountId) return NextResponse.json({ error: "Escolha a conta do Instagram" }, { status: 400 });
  const conta = await prisma.instagramAccount.findUnique({ where: { id: body.accountId }, select: { id: true } });
  if (!conta) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });

  const criada = await prisma.igAutomacao.create({
    data: { ...(lido.dados as Record<string, unknown>), accountId: conta.id } as never,
  });
  return NextResponse.json({ ok: true, id: criada.id });
}
