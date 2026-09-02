import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { fetchOrdersSince, summarizeSales, dataDiasAtras } from "@/lib/traySales";

// GET /api/tray/sales?dias=30 — resumo de vendas do período, direto da Tray
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const conn = await prisma.trayConnection.findFirst();
  if (!conn) {
    return NextResponse.json({ notConnected: true, error: "Tray não conectada" }, { status: 400 });
  }

  const diasParam = Number(req.nextUrl.searchParams.get("dias") ?? 30);
  const dias = [7, 30, 90].includes(diasParam) ? diasParam : 30;
  const desde = dataDiasAtras(dias);

  try {
    const { orders, truncated } = await fetchOrdersSince(desde);
    const resumo = summarizeSales(orders, dias, desde, truncated);
    return NextResponse.json(resumo);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao buscar vendas na Tray";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
