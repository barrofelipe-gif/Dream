import "server-only";
import { NextResponse } from "next/server";
import { auth } from "@/auth";

/** Só administradores do app mexem nas conversas do Instagram (têm dados de clientes). */
export async function exigirAdmin() {
  const session = await auth();
  if (!session?.user?.id) return { erro: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (session.user.role !== "admin") return { erro: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { session };
}
