import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { exigirAdmin } from "@/lib/igAdmin";

// Lista da caixa de entrada: conversas recentes com a última mensagem.
export async function GET() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;

  const conversas = await prisma.igConversation.findMany({
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: { account: true, messages: { orderBy: { createdAt: "desc" }, take: 1 } },
  });

  return NextResponse.json({
    conversas: conversas.map((c) => ({
      id: c.id,
      status: c.status,
      naoLida: c.naoLida,
      tags: c.tags,
      cliente: c.igScopedUserId.slice(-6),
      nome: c.nome,
      username: c.username,
      fotoUrl: c.fotoUrl,
      seguidores: c.seguidores,
      verificado: c.verificado,
      conta: c.account.username,
      loja: c.account.loja,
      ultimaEm: (c.messages[0]?.createdAt ?? c.updatedAt).toISOString(),
      ultima: c.messages[0]
        ? { de: c.messages[0].direction === "IN" ? "cliente" : c.messages[0].source === "HUMANO" ? "equipe" : "robo", texto: c.messages[0].text }
        : null,
    })),
  });
}
