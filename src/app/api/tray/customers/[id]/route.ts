import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasSectorAccess } from "@/lib/permissions";
import { getCustomer, listOrdersByCustomer, summarizeCustomer } from "@/lib/trayCustomers";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const allowed = await hasSectorAccess(session.user.id, session.user.role, "clientes");
  if (!allowed) return NextResponse.json({ error: "Sem acesso a Clientes" }, { status: 403 });

  const { id } = await params;

  try {
    const [customer, orders] = await Promise.all([getCustomer(id), listOrdersByCustomer(id)]);
    return NextResponse.json(summarizeCustomer(customer, orders));
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro desconhecido";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
