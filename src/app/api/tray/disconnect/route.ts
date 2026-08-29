import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Só admin desconecta a Tray" }, { status: 403 });
  }

  await prisma.trayConnection.deleteMany({});
  return NextResponse.json({ ok: true });
}
