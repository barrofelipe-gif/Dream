import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { lojaDoPainel } from "@/lib/igLoja";
import { lerPassos } from "@/lib/igSequencias";

const etiqueta = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().replace(/\s+/g, " ").slice(0, 40) : null);

// Lista as sequências com a contagem de inscritos por status.
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const loja = await lojaDoPainel();
  const [sequencias, contagem, contas] = await Promise.all([
    prisma.igSequencia.findMany({ where: { account: { loja } }, orderBy: { createdAt: "desc" }, include: { account: { select: { username: true, loja: true } } } }),
    prisma.igSequenciaInscrito.groupBy({ by: ["sequenciaId", "status"], _count: { _all: true } }),
    prisma.instagramAccount.findMany({ where: { active: true, loja }, select: { id: true, username: true, loja: true } }),
  ]);
  const porSeq = new Map<string, { ativos: number; concluidos: number; parados: number }>();
  for (const c of contagem) {
    const x = porSeq.get(c.sequenciaId) ?? { ativos: 0, concluidos: 0, parados: 0 };
    if (c.status === "ATIVA") x.ativos += c._count._all;
    else if (c.status === "CONCLUIDA") x.concluidos += c._count._all;
    else x.parados += c._count._all;
    porSeq.set(c.sequenciaId, x);
  }
  return NextResponse.json({
    sequencias: sequencias.map((s) => ({ ...s, passos: lerPassos(s.passos), contagem: porSeq.get(s.id) ?? { ativos: 0, concluidos: 0, parados: 0 } })),
    contas,
  });
}

export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const accountId = typeof b.accountId === "string" ? b.accountId : "";
  const nome = typeof b.nome === "string" ? b.nome.trim().slice(0, 60) : "";
  const passos = lerPassos(b.passos);
  if (!accountId || !nome) return NextResponse.json({ error: "Escolha a conta e dê um nome à sequência" }, { status: 400 });
  if (passos.length === 0) return NextResponse.json({ error: "Escreva pelo menos uma mensagem" }, { status: 400 });
  const conta = await prisma.instagramAccount.findUnique({ where: { id: accountId }, select: { id: true } });
  if (!conta) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  const s = await prisma.igSequencia.create({
    data: {
      accountId,
      nome,
      passos,
      ativa: b.ativa !== false,
      pararSeResponder: b.pararSeResponder !== false,
      etiquetaAoEntrar: etiqueta(b.etiquetaAoEntrar),
      etiquetaAoConcluir: etiqueta(b.etiquetaAoConcluir),
    },
  });
  return NextResponse.json({ ok: true, id: s.id });
}
