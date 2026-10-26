import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { TIPOS_CAMPO } from "@/lib/igContatos";

// Campos personalizados dos contatos (por conta do Instagram).
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const accountId = req.nextUrl.searchParams.get("conta") || undefined;
  const campos = await prisma.igCampo.findMany({
    where: accountId ? { accountId } : {},
    orderBy: [{ accountId: "asc" }, { nome: "asc" }],
    include: { account: { select: { username: true } } },
  });
  return NextResponse.json({
    campos: campos.map((c) => ({ id: c.id, accountId: c.accountId, conta: c.account.username, nome: c.nome, tipo: c.tipo })),
  });
}

// Cria um campo: { accountId, nome, tipo: TEXTO | NUMERO | DATA | SIM_NAO }
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const nome = typeof b.nome === "string" ? b.nome.trim().replace(/\s+/g, " ").slice(0, 40) : "";
  const tipo = typeof b.tipo === "string" ? b.tipo : "TEXTO";
  if (!accountId || !nome) return NextResponse.json({ error: "Escolha a conta e dê um nome ao campo" }, { status: 400 });
  if (!(TIPOS_CAMPO as readonly string[]).includes(tipo)) return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  const conta = await prisma.instagramAccount.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!conta) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  try {
    const c = await prisma.igCampo.create({ data: { accountId, nome, tipo } });
    return NextResponse.json({ ok: true, campo: { id: c.id, accountId: c.accountId, nome: c.nome, tipo: c.tipo } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "Já existe um campo com esse nome nesta conta" }, { status: 409 });
    }
    throw e;
  }
}

// Apaga um campo (?id=) e tira o valor dele de todos os contatos da conta.
export async function DELETE(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const c = await prisma.igCampo.findUnique({ where: { id } });
  if (!c) return NextResponse.json({ error: "Campo não encontrado" }, { status: 404 });
  const [, limpos] = await prisma.$transaction([
    prisma.igCampo.delete({ where: { id } }),
    prisma.$executeRaw`UPDATE "IgConversation" SET "campos" = "campos" - ${c.nome}::text WHERE "accountId" = ${c.accountId} AND jsonb_exists("campos", ${c.nome}::text)`,
  ]);
  return NextResponse.json({ ok: true, contatosLimpos: limpos });
}
