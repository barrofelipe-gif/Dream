import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { listarMidias } from "@/lib/igAutomacoes";

// Últimas publicações e reels da conta, para escolher em qual a automação vale.
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const contaId = req.nextUrl.searchParams.get("conta");
  if (!contaId) return NextResponse.json({ error: "Informe ?conta=" }, { status: 400 });
  const conta = await prisma.instagramAccount.findUnique({ where: { id: contaId } });
  if (!conta) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  try {
    return NextResponse.json({ midias: await listarMidias(conta.accessToken) });
  } catch (e) {
    console.warn("[ig-midias]", e);
    return NextResponse.json({ error: "Não consegui buscar as publicações no Instagram." }, { status: 502 });
  }
}
