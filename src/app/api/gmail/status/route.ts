import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// Lista todas as contas Google conectadas do usuário (pessoal, empresa, etc.)
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const accounts = await prisma.gmailConnection.findMany({
    where: { userId: session.user.id },
    select: { id: true, email: true, lastSyncAt: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ connected: accounts.length > 0, accounts });
}
