import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { cancelarExecucoes } from "@/lib/igFluxos";
import { noGatilho, problemasParaAtivar, validarGrafo } from "@/lib/igFluxosModelo";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const fluxo = await prisma.igFluxo.findUnique({ where: { id }, include: { account: { select: { username: true, loja: true } } } });
  if (!fluxo) return NextResponse.json({ error: "Fluxo não encontrado" }, { status: 404 });
  return NextResponse.json({ fluxo });
}

// Atualiza nome, grafo e/ou ativo. Ativar exige o fluxo completo; desligar para quem estava no meio dele.
export async function PUT(req: NextRequest, { params }: Params) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const atual = await prisma.igFluxo.findUnique({ where: { id } });
  if (!atual) return NextResponse.json({ error: "Fluxo não encontrado" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { nome?: string; grafo?: unknown; ativo?: boolean } | null;
  if (!body) return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });

  const data: Prisma.IgFluxoUpdateInput = {};
  if (typeof body.nome === "string") data.nome = body.nome.trim().slice(0, 80) || atual.nome;

  let grafo = validarGrafo(atual.grafo);
  if (body.grafo !== undefined) {
    grafo = validarGrafo(body.grafo);
    if ("erro" in grafo) return NextResponse.json({ error: grafo.erro }, { status: 400 });
    data.grafo = grafo.grafo as unknown as Prisma.InputJsonValue;
    data.gatilho = (noGatilho(grafo.grafo)?.dados ?? {}) as Prisma.InputJsonValue;
  }

  if (typeof body.ativo === "boolean") {
    if (body.ativo) {
      if ("erro" in grafo) return NextResponse.json({ error: grafo.erro }, { status: 400 });
      const faltando = problemasParaAtivar(grafo.grafo);
      const irPara = grafo.grafo.nos.filter((n) => n.tipo === "irpara").map((n) => (n.dados as { fluxoId: string }).fluxoId).filter(Boolean);
      if (irPara.length) {
        const existentes = await prisma.igFluxo.count({ where: { id: { in: irPara }, accountId: atual.accountId } });
        if (existentes < new Set(irPara).size) faltando.push("Um bloco Ir para outro fluxo aponta para um fluxo que não existe (ou é de outra conta)");
      }
      if (faltando.length) return NextResponse.json({ error: `Não dá para ativar ainda: ${faltando.join("; ")}.`, problemas: faltando }, { status: 400 });
    }
    data.ativo = body.ativo;
  }

  await prisma.igFluxo.update({ where: { id }, data });
  if (body.ativo === false && atual.ativo) await cancelarExecucoes(id);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  await prisma.igFluxo.delete({ where: { id } }).catch(() => null); // as execuções caem junto (cascade)
  return NextResponse.json({ ok: true });
}
