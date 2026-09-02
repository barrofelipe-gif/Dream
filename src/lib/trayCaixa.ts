import "server-only";
import { trayGet } from "@/lib/tray";

/**
 * Fluxo de caixa a partir dos pedidos da Tray.
 *
 * Diferença importante para o relatório de vendas: aqui o que conta é a DATA DO
 * PAGAMENTO (`payment_date`), não a data do pedido. Um pedido feito dia 30 e pago
 * dia 2 é faturamento de um mês e caixa do outro — misturar os dois é o erro
 * clássico que faz o dono achar que tem dinheiro que ainda não entrou.
 *
 * Também separa BRUTO de LÍQUIDO: a Tray informa `payment_method_rate`, a taxa
 * que a adquirente retém. É esse desconto que explica a diferença entre o que
 * foi vendido e o que cai na conta.
 */

export interface PedidoCaixa {
  id: string;
  status: string;
  date: string;
  payment_date: string | null;
  payment_form: string | null;
  payment_method_rate: string | null;
  has_payment: string | null;
  total: string;
  partial_total?: string | null;
  shipment_value?: string | null;
  discount?: string | null;
  interest?: string | null;
}

interface OrdersListResponse {
  paging: { total: number; page: number; offset: number; limit: number; maxLimit: number };
  Orders?: { Order: PedidoCaixa }[];
}

const num = (v: string | null | undefined): number => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** A Tray usa "0000-00-00" para "sem data" — precisa virar null. */
export function dataValida(v: string | null | undefined): string | null {
  if (!v) return null;
  const d = v.slice(0, 10);
  if (d === "0000-00-00" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return d;
}

export function foiPago(p: PedidoCaixa): boolean {
  return p.has_payment === "1" && dataValida(p.payment_date) !== null;
}

export async function buscarPedidosCaixa(
  desdeISO: string,
  maxPedidos = 1000
): Promise<PedidoCaixa[]> {
  const limit = 50;
  const todos: PedidoCaixa[] = [];
  let page = 1;

  while (todos.length < maxPedidos) {
    const data = await trayGet<OrdersListResponse>("orders", {
      limit: String(limit),
      page: String(page),
      sort: "date_desc",
      date: desdeISO, // na Tray, `date` funciona como "a partir de"
    });
    const lote = (data.Orders ?? []).map((o) => o.Order);
    todos.push(...lote);
    if (lote.length < limit) break;
    page += 1;
  }

  return todos.slice(0, maxPedidos);
}

export interface EntradaDia {
  dia: string;
  pedidos: number;
  bruto: number;
  taxas: number;
  liquido: number;
}

export interface ResumoForma {
  forma: string;
  pedidos: number;
  bruto: number;
  taxas: number;
  liquido: number;
  taxaMediaPct: number;
}

export interface FluxoCaixa {
  desde: string;
  periodoDias: number;
  // realizado (dinheiro que já entrou)
  pedidosPagos: number;
  bruto: number;
  taxas: number;
  liquido: number;
  frete: number;
  descontos: number;
  juros: number;
  taxaMediaPct: number;
  // a receber (pedido feito, pagamento ainda não confirmado)
  pedidosAguardando: number;
  valorAguardando: number;
  // perdido
  pedidosCancelados: number;
  valorCancelado: number;
  porDia: EntradaDia[];
  porForma: ResumoForma[];
}

const ehCancelado = (s: string | null | undefined) =>
  ["CANCELADO", "CANCELADA"].includes((s ?? "").trim().toUpperCase());

export function montarFluxoCaixa(
  pedidos: PedidoCaixa[],
  periodoDias: number,
  desde: string
): FluxoCaixa {
  const pagos = pedidos.filter(foiPago);
  const cancelados = pedidos.filter((p) => ehCancelado(p.status));
  // Aguardando = ainda não pago e não cancelado. É o que deve entrar.
  const aguardando = pedidos.filter((p) => !foiPago(p) && !ehCancelado(p.status));

  const bruto = pagos.reduce((s, p) => s + num(p.total), 0);
  const taxas = pagos.reduce((s, p) => s + num(p.payment_method_rate), 0);

  const porDiaMap = new Map<string, EntradaDia>();
  for (const p of pagos) {
    const dia = dataValida(p.payment_date)!;
    const cur = porDiaMap.get(dia) ?? { dia, pedidos: 0, bruto: 0, taxas: 0, liquido: 0 };
    cur.pedidos += 1;
    cur.bruto += num(p.total);
    cur.taxas += num(p.payment_method_rate);
    cur.liquido = cur.bruto - cur.taxas;
    porDiaMap.set(dia, cur);
  }

  const porFormaMap = new Map<string, ResumoForma>();
  for (const p of pagos) {
    const forma = (p.payment_form ?? "não informado").trim();
    const cur =
      porFormaMap.get(forma) ??
      { forma, pedidos: 0, bruto: 0, taxas: 0, liquido: 0, taxaMediaPct: 0 };
    cur.pedidos += 1;
    cur.bruto += num(p.total);
    cur.taxas += num(p.payment_method_rate);
    cur.liquido = cur.bruto - cur.taxas;
    cur.taxaMediaPct = cur.bruto > 0 ? cur.taxas / cur.bruto : 0;
    porFormaMap.set(forma, cur);
  }

  return {
    desde,
    periodoDias,
    pedidosPagos: pagos.length,
    bruto,
    taxas,
    liquido: bruto - taxas,
    frete: pagos.reduce((s, p) => s + num(p.shipment_value), 0),
    descontos: pagos.reduce((s, p) => s + num(p.discount), 0),
    juros: pagos.reduce((s, p) => s + num(p.interest), 0),
    taxaMediaPct: bruto > 0 ? taxas / bruto : 0,
    pedidosAguardando: aguardando.length,
    valorAguardando: aguardando.reduce((s, p) => s + num(p.total), 0),
    pedidosCancelados: cancelados.length,
    valorCancelado: cancelados.reduce((s, p) => s + num(p.total), 0),
    porDia: [...porDiaMap.values()].sort((a, b) => a.dia.localeCompare(b.dia)),
    porForma: [...porFormaMap.values()].sort((a, b) => b.bruto - a.bruto),
  };
}
