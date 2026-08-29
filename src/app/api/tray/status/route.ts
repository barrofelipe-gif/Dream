import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const connection = await prisma.trayConnection.findFirst({
    orderBy: { createdAt: "desc" },
    select: { storeId: true, apiAddress: true, lastSyncAt: true, accessTokenExpiresAt: true, createdAt: true },
  });

  return NextResponse.json({ connected: !!connection, ...connection });
}
