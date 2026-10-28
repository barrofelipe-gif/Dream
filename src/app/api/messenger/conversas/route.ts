import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { lojaDoPainel } from "@/lib/igLoja";
import { exigirAdmin } from "@/lib/igAdmin";

// Caixa de entrada do Messenger: conversas recentes com a última mensagem (filtro por loja).
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  // Sempre a empresa escolhida no topo do painel (BFF ou Moranga), nunca as duas.
  const loja = await lojaDoPainel();
  const conversas = await prisma.fbConversa.findMany({
    where: loja ? { loja } : {},
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { mensagens: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
  const paginas = await prisma.socialConta.findMany({ where: { rede: "facebook" }, select: { externoId: true, nome: true } });
  return NextResponse.json({
    conversas: conversas.map((c) => ({
      id: c.id,
      status: c.status,
      naoLida: c.naoLida,
      nome: c.nome,
      fotoUrl: c.fotoUrl,
      cliente: c.psid.slice(-6),
      loja: c.loja,
      pagina: paginas.find((p) => p.externoId === c.paginaId)?.nome ?? "Página",
      ultimaEm: (c.mensagens[0]?.createdAt ?? c.updatedAt).toISOString(),
      ultima: c.mensagens[0]
        ? { de: c.mensagens[0].direction === "IN" ? "cliente" : c.mensagens[0].source === "BOT" ? "robo" : "equipe", texto: c.mensagens[0].text }
        : null,
    })),
  });
}
