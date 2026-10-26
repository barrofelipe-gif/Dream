import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { trayGet } from "@/lib/tray";

// Diagnóstico (só administrador): mostra QUAIS campos a Tray devolve num pedido e os valores dos campos
// de data, status e entrega (sem nome, e-mail, telefone ou endereço). Serve para configurar a regra
// "pedido atrasado". /api/instagram/diagnostico-pedido?id=123 (sem id usa o pedido mais recente).
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  try {
    let id = req.nextUrl.searchParams.get("id");
    if (!id) {
      const lista = await trayGet<{ Orders?: { Order: { id: string } }[] }>("orders", { limit: "1", sort: "date_desc" });
      id = lista.Orders?.[0]?.Order.id ?? null;
    }
    if (!id) return NextResponse.json({ error: "Nenhum pedido encontrado" }, { status: 404 });

    const cheio = await trayGet<Record<string, unknown>>(`orders/${id}/complete`).catch(() => null);
    const simples = await trayGet<Record<string, unknown>>(`orders/${id}`).catch(() => null);
    const pedido = ((cheio?.Order ?? simples?.Order) ?? {}) as Record<string, unknown>;

    const seguros: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(pedido)) {
      if (/date|time|hour|status|shipment|delivery|deliver|send|track|prazo|dias|days|expected|estimat/i.test(k) && (typeof v !== "object" || v === null)) {
        seguros[k] = v;
      }
    }
    return NextResponse.json({
      id,
      campos: Object.keys(pedido),
      valores: seguros,
      temCompleto: !!cheio,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
