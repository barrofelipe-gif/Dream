import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { lojaDoPainel } from "@/lib/igLoja";
import { limparAtalho } from "@/lib/igRespostasSalvas";

// GET ?accountId=X → respostas da conta X + as que valem para todas. Sem accountId → todas.
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const accountId = req.nextUrl.searchParams.get("accountId");
  const [respostas, contas] = await Promise.all([
    prisma.igRespostaSalva.findMany({
      // Da empresa escolhida no painel (ou das que valem para todas as contas).
      where: { OR: [{ ...(accountId ? { accountId } : {}), account: { loja: await lojaDoPainel() } }, { accountId: null }] },
      orderBy: { atalho: "asc" },
    }),
    prisma.instagramAccount.findMany({ where: { active: true, loja: await lojaDoPainel() }, select: { id: true, username: true, loja: true } }),
  ]);
  return NextResponse.json({ respostas, contas });
}

export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const atalho = limparAtalho(typeof b.atalho === "string" ? b.atalho : "");
  const titulo = typeof b.titulo === "string" ? b.titulo.trim().slice(0, 60) : "";
  const texto = typeof b.texto === "string" ? b.texto.trim().slice(0, 1000) : "";
  const accountId = typeof b.accountId === "string" && b.accountId ? b.accountId : null;
  if (!atalho || !texto) return NextResponse.json({ error: "Informe o atalho e o texto" }, { status: 400 });
  const repetida = await prisma.igRespostaSalva.findFirst({ where: { atalho, accountId }, select: { id: true } });
  if (repetida) return NextResponse.json({ error: `Já existe o atalho /${atalho}` }, { status: 400 });
  const resposta = await prisma.igRespostaSalva.create({ data: { atalho, titulo: titulo || atalho, texto, accountId } });
  return NextResponse.json({ ok: true, resposta });
}
