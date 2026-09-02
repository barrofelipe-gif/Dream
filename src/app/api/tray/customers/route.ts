import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasSectorAccess } from "@/lib/permissions";
import { listCustomers } from "@/lib/trayCustomers";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const allowed = await hasSectorAccess(session.user.id, session.user.role, "clientes");
  if (!allowed) return NextResponse.json({ error: "Sem acesso a Clientes" }, { status: 403 });

  const page = Number(req.nextUrl.searchParams.get("page") ?? "1");
  const search = req.nextUrl.searchParams.get("search") ?? undefined;

  try {
    const { customers, paging } = await listCustomers({ page, search });
    return NextResponse.json({ customers, paging });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido";
    // Sem conexão configurada ainda (ver /conectar-tray) — não é um erro de bug.
    return NextResponse.json({ error: message, notConnected: message.includes("conexão") }, { status: 502 });
  }
}
