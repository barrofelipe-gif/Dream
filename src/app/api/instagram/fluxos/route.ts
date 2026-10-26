import { NextRequest, NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { SUGESTOES_TAGS } from "@/lib/igTags";
import { grafoInicial, noGatilho, validarGrafo } from "@/lib/igFluxosModelo";

// Lista os fluxos (de todas as contas), com quantas pessoas estão em cada estado.
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const [fluxos, contas, contagem] = await Promise.all([
    prisma.igFluxo.findMany({ orderBy: { updatedAt: "desc" }, include: { account: { select: { username: true, loja: true } } } }),
    prisma.instagramAccount.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, username: true, loja: true } }),
    prisma.igFluxoExec.groupBy({ by: ["fluxoId", "status"], _count: { _all: true } }),
  ]);
  const stats: Record<string, Record<string, number>> = {};
  for (const c of contagem) (stats[c.fluxoId] ??= {})[c.status] = c._count._all;
  return NextResponse.json({
    fluxos: fluxos.map((f) => ({ ...f, stats: stats[f.id] ?? {} })),
    contas,
    etiquetas: SUGESTOES_TAGS,
  });
}

// Cria um fluxo (nasce desligado) ou duplica um existente ({ duplicarDe }).
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const body = (await req.json().catch(() => null)) as { accountId?: string; nome?: string; grafo?: unknown; duplicarDe?: string } | null;

  if (body?.duplicarDe) {
    const orig = await prisma.igFluxo.findUnique({ where: { id: body.duplicarDe } });
    if (!orig) return NextResponse.json({ error: "Fluxo não encontrado" }, { status: 404 });
    const copia = await prisma.igFluxo.create({
      data: {
        accountId: orig.accountId,
        nome: `${orig.nome} (cópia)`.slice(0, 80),
        ativo: false,
        gatilho: orig.gatilho as Prisma.InputJsonValue,
        grafo: orig.grafo as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ ok: true, id: copia.id });
  }

  if (!body?.accountId) return NextResponse.json({ error: "Escolha a conta do Instagram" }, { status: 400 });
  const conta = await prisma.instagramAccount.findUnique({ where: { id: body.accountId }, select: { id: true } });
  if (!conta) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });
  const lido = validarGrafo(body.grafo ?? grafoInicial());
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const g = noGatilho(lido.grafo);

  const criado = await prisma.igFluxo.create({
    data: {
      accountId: conta.id,
      nome: (body.nome ?? "").trim().slice(0, 80) || "Novo fluxo",
      ativo: false,
      gatilho: (g?.dados ?? {}) as Prisma.InputJsonValue,
      grafo: lido.grafo as unknown as Prisma.InputJsonValue,
    },
  });
  return NextResponse.json({ ok: true, id: criado.id });
}
