import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";
import { analisarFormatos, analisarHorario, resumirPublico, topPostagens, evolucaoDiaria, totaisPeriodo } from "@/lib/social/metricas/analise";
import { COLETORES } from "@/lib/social/metricas";
import type { Rede } from "@/lib/social/types";

const DIA_MS = 86_400_000;

// Resumo completo (já analisado) das métricas de uma conta. Só administrador.
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const contaId = req.nextUrl.searchParams.get("contaId");
  const dias = Math.min(Math.max(Number(req.nextUrl.searchParams.get("dias") ?? 30) || 30, 1), 90);

  const contas = await prisma.socialConta.findMany({
    where: { ativo: true },
    orderBy: [{ rede: "asc" }, { createdAt: "asc" }],
    select: { id: true, rede: true, loja: true, nome: true, username: true },
  });
  const redes = Object.values(COLETORES).map((c) => ({ rede: c.rede, rotulo: c.rotulo, disponivel: c.disponivel }));
  const contasComColeta = contas.map((c) => ({ ...c, coletaDisponivel: COLETORES[c.rede as Rede]?.disponivel ?? false }));
  if (!contaId) return NextResponse.json({ contas: contasComColeta, redes });

  const conta = contas.find((c) => c.id === contaId);
  if (!conta) return NextResponse.json({ error: "Conta não encontrada" }, { status: 404 });

  const agora = Date.now();
  const desde = new Date(agora - dias * DIA_MS);
  const desde90 = new Date(agora - 90 * DIA_MS);
  const [diasConta, posts90, publico, ultima] = await Promise.all([
    prisma.socialMetricaConta.findMany({ where: { contaId, data: { gte: desde } }, orderBy: { data: "asc" } }),
    prisma.socialMetricaPost.findMany({ where: { contaId, publicadoEm: { gte: desde90 } }, orderBy: { publicadoEm: "desc" } }),
    prisma.socialMetricaPublico.findFirst({ where: { contaId }, orderBy: { data: "desc" } }),
    prisma.socialMetricaPost.findFirst({ where: { contaId }, orderBy: { coletadoEm: "desc" }, select: { coletadoEm: true } }),
  ]);
  const postsPeriodo = posts90.filter((p) => p.publicadoEm >= desde);

  const semDados = diasConta.length === 0 && posts90.length === 0 && !publico;
  return NextResponse.json({
    contas: contasComColeta,
    redes,
    conta,
    dias,
    semDados,
    coletadoEm: ultima?.coletadoEm ?? diasConta.at(-1)?.coletadoEm ?? null,
    totais: totaisPeriodo(diasConta),
    evolucao: evolucaoDiaria(diasConta),
    // Horário: sempre os últimos 90 dias (mais postagens = resposta mais confiável).
    horario: analisarHorario(posts90),
    horarioBaseDias: 90,
    formatos: analisarFormatos(postsPeriodo),
    top: topPostagens(postsPeriodo, 10),
    totalPostagensPeriodo: postsPeriodo.length,
    publico: resumirPublico(publico),
  });
}
