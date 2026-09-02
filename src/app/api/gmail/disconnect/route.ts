import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

/**
 * Desconecta uma conta Google. Com `connectionId` no corpo, desconecta só
 * aquela; sem nada, desconecta todas (compatível com o botão antigo).
 * Os itens já importados continuam no painel — some só a conexão.
 */
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  let connectionId: string | undefined;
  try {
    const body = await req.json();
    connectionId = typeof body?.connectionId === "string" ? body.connectionId : undefined;
  } catch {
    // corpo vazio = desconectar todas
  }

  // O filtro por userId garante que ninguém desconecte a conta de outra pessoa.
  await prisma.gmailConnection.deleteMany({
    where: { userId: session.user.id, ...(connectionId ? { id: connectionId } : {}) },
  });

  return NextResponse.json({ ok: true });
}
