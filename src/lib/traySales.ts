import "server-only";
import { trayGet } from "@/lib/tray";

/**
 * Agregação de vendas a partir dos pedidos da Tray (/orders).
 *
 * Por que não usar o `count_orders` do cadastro do cliente: esse campo vem
 * zerado na API mesmo para clientes que têm pedido (verificado na loja real),
 * então a única fonte confiável de faturamento/recorrência são os pedidos.
 */

export interface TraySaleOrder {
  id: string;
  status: string;
  date: string;
  customer_id: string;
  total: string;
  partial_total?: string;
  shipment_value?: string;
  discount?: string;
  payment_form?: string | null;
  shipment?: string | null;
}

interface OrdersListResponse {
  paging: { total: number; page: number; offset: number; limit: number; maxLimit: number };
  Orders?: { Order: TraySaleOrder }[];
}

// Status que NÃO contam como venda. O resto (ENVIADO, A ENVIAR VINDI,
// AGUARDANDO VINDI etc.) entra no faturamento.
const STATUS_CANCELADOS = ["CANCELADO", "CANCELADA"];

export function isCancelado(status: string | null | undefined): boolean {
  if (!status) return false;
  return STATUS_CANCELADOS.includes(status.trim().toUpperCase());
}

/** Pedidos a partir de uma data (YYYY-MM-DD), paginando até acabar ou bater o teto. */
export async function fetchOrdersSince(
  sinceISO: string,
  maxOrders = 1000
): Promise<{ orders: TraySaleOrder[]; total: number; truncated: boolean }> {
  const limit = 50; // maxLimit da Tray
  const all: TraySaleOrder[] = [];
  let page = 1;
  let total = 0;

  // A Tray pagina de 50 em 50; o teto evita estourar o tempo da função serverless
  // numa loja com muito histórico (o limite de requisição da Tray é 180/min).
  while (all.length < maxOrders) {
    const data = await trayGet<OrdersListResponse>("orders", {
      limit: String(limit),
      page: String(page),
      sort: "date_desc",
      date_start: sinceISO,
    });

    total = data.paging?.total ?? 0;
    const batch = (data.Orders ?? []).map((o) => o.Order);
    all.push(...batch);

    if (batch.length < limit) break; // acabou
    page += 1;
  }

  return { orders: all.slice(0, maxOrders), total, truncated: all.length >= maxOrders && all.length < total };
}

export interface SalesSummary {
  periodoDias: number;
  desde: string;
  pedidosValidos: number;
  pedidosCancelados: number;
  faturamento: number;
  ticketMedio: number;
  clientesUnicos: number;
  taxaCancelamento: number;
  porStatus: { status: string; pedidos: number; valor: number }[];
  porDia: { dia: string; pedidos: number; valor: number }[];
  topClientes: { customerId: string; pedidos: number; valor: number }[];
  truncado: boolean;
}

export function summarizeSales(
  orders: TraySaleOrder[],
  periodoDias: number,
  desde: string,
  truncado = false
): SalesSummary {
  const validos = orders.filter((o) => !isCancelado(o.status));
  const cancelados = orders.length - validos.length;

  const faturamento = validos.reduce((s, o) => s + (parseFloat(o.total) || 0), 0);
  const ticketMedio = validos.length > 0 ? faturamento / validos.length : 0;

  const porStatusMap = new Map<string, { pedidos: number; valor: number }>();
  for (const o of orders) {
    const key = (o.status || "SEM STATUS").trim().toUpperCase();
    const cur = porStatusMap.get(key) ?? { pedidos: 0, valor: 0 };
    cur.pedidos += 1;
    cur.valor += parseFloat(o.total) || 0;
    porStatusMap.set(key, cur);
  }

  const porDiaMap = new Map<string, { pedidos: number; valor: number }>();
  for (const o of validos) {
    const dia = (o.date || "").slice(0, 10);
    if (!dia) continue;
    const cur = porDiaMap.get(dia) ?? { pedidos: 0, valor: 0 };
    cur.pedidos += 1;
    cur.valor += parseFloat(o.total) || 0;
    porDiaMap.set(dia, cur);
  }

  const porClienteMap = new Map<string, { pedidos: number; valor: number }>();
  for (const o of validos) {
    if (!o.customer_id) continue;
    const cur = porClienteMap.get(o.customer_id) ?? { pedidos: 0, valor: 0 };
    cur.pedidos += 1;
    cur.valor += parseFloat(o.total) || 0;
    porClienteMap.set(o.customer_id, cur);
  }

  return {
    periodoDias,
    desde,
    pedidosValidos: validos.length,
    pedidosCancelados: cancelados,
    faturamento,
    ticketMedio,
    clientesUnicos: porClienteMap.size,
    taxaCancelamento: orders.length > 0 ? cancelados / orders.length : 0,
    porStatus: [...porStatusMap.entries()]
      .map(([status, v]) => ({ status, ...v }))
      .sort((a, b) => b.pedidos - a.pedidos),
    porDia: [...porDiaMap.entries()]
      .map(([dia, v]) => ({ dia, ...v }))
      .sort((a, b) => a.dia.localeCompare(b.dia)),
    topClientes: [...porClienteMap.entries()]
      .map(([customerId, v]) => ({ customerId, ...v }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 10),
    truncado,
  };
}

export function dataDiasAtras(dias: number): string {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
}
