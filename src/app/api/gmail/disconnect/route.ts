import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  await prisma.gmailConnection.deleteMany({ where: { userId: session.user.id } });
  return NextResponse.json({ ok: true });
}
