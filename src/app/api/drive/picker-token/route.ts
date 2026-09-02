import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { clientForConnection } from "@/lib/gmail";

/**
 * Devolve um access_token de curta duração pro Google Picker rodar no
 * navegador. O refresh_token nunca sai do servidor — só esse token temporário,
 * derivado dele, com escopo drive.file (acesso apenas ao que o usuário
 * escolher no Picker).
 *
 * ?connectionId=... escolhe de qual conta Google abrir o Drive; sem isso,
 * usa a primeira conectada.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const connectionId = req.nextUrl.searchParams.get("connectionId") ?? undefined;

  const connection = await prisma.gmailConnection.findFirst({
    where: { userId: session.user.id, ...(connectionId ? { id: connectionId } : {}) },
    orderBy: { createdAt: "asc" },
  });

  if (!connection) {
    return NextResponse.json({ error: "Nenhuma conta Google conectada" }, { status: 400 });
  }

  try {
    const client = clientForConnection(connection.refreshToken);
    const { token } = await client.getAccessToken();
    if (!token) throw new Error("Google não devolveu access_token");

    return NextResponse.json({
      accessToken: token,
      apiKey: process.env.NEXT_PUBLIC_GOOGLE_API_KEY ?? null,
      account: connection.email,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao obter token do Drive";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
