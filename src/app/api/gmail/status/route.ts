import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const connection = await prisma.gmailConnection.findUnique({
    where: { userId: session.user.id },
    select: { email: true, lastSyncAt: true, createdAt: true },
  });

  return NextResponse.json({ connected: !!connection, ...connection });
}
