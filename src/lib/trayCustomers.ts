import "server-only";
import { trayGet } from "@/lib/tray";

/**
 * CRM de Clientes — consome a API clássica da Tray (/customers, /orders),
 * campos confirmados contra a doc oficial (developers.tray.com.br).
 */

export interface TrayCustomer {
  id: string;
  name: string;
  email: string | null;
  cpf: string | null;
  cnpj: string | null;
  phone: string | null;
  cellphone: string | null;
  city: string | null;
  state: string | null;
  // A lista de clientes devolve `count_orders`; o detalhe devolve `total_orders`.
  // Os dois vêm zerados mesmo para quem tem pedido (comportamento da Tray na loja
  // real), então não dá pra confiar neles — o número real sai de /orders.
  total_orders: string | null;
  count_orders: string | null;
  last_purchase: string | null;
  last_visit: string | null;
  created: string | null;
  blocked: string | null;
}

interface CustomersListResponse {
  paging: { total: number; page: number; offset: number; limit: number; maxLimit: number };
  Customers: { Customer: TrayCustomer }[];
}

interface CustomerDetailResponse {
  Customer: TrayCustomer;
}

export interface TrayOrder {
  id: string;
  status: string;
  date: string;
  customer_id: string;
  total: string;
  payment_form: string | null;
  shipment: string | null;
}

interface OrdersListResponse {
  paging: { total: number; page: number; offset: number; limit: number; maxLimit: number };
  Orders: { Order: TrayOrder }[];
}

export async function listCustomers(opts: { page?: number; limit?: number; search?: string } = {}) {
  const params: Record<string, string> = {
    page: String(opts.page ?? 1),
    limit: String(Math.min(opts.limit ?? 30, 50)),
    sort: "name_asc",
  };
  if (opts.search) params.email = opts.search; // API da Tray filtra por email exato; busca por nome é feita client-side na página inteira
  const data = await trayGet<CustomersListResponse>("customers", params);
  return { customers: data.Customers.map((c) => c.Customer), paging: data.paging };
}

export async function getCustomer(id: string) {
  const data = await trayGet<CustomerDetailResponse>(`customers/${id}`);
  return data.Customer;
}

export async function listOrdersByCustomer(customerId: string) {
  const data = await trayGet<OrdersListResponse>("orders", { customer_id: customerId, limit: "50", sort: "date_desc" });
  return data.Orders.map((o) => o.Order);
}

export type RecencyStatus = "ativo" | "esfriando" | "sumido" | "nunca_comprou";

export interface CustomerSummary {
  customer: TrayCustomer;
  orders: TrayOrder[];
  totalOrders: number;
  totalSpent: number;
  avgTicket: number;
  lastOrderDate: string | null;
  daysSinceLastOrder: number | null;
  recency: RecencyStatus;
}

export function summarizeCustomer(customer: TrayCustomer, orders: TrayOrder[]): CustomerSummary {
  const validOrders = orders.filter((o) => o.status && o.status.toUpperCase() !== "CANCELADO");
  const totalSpent = validOrders.reduce((sum, o) => sum + (parseFloat(o.total) || 0), 0);
  const totalOrders = validOrders.length;
  const avgTicket = totalOrders > 0 ? totalSpent / totalOrders : 0;

  const dates = validOrders.map((o) => new Date(o.date)).filter((d) => !isNaN(d.getTime()));
  const lastOrderDate = dates.length > 0 ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  const daysSinceLastOrder = lastOrderDate
    ? Math.floor((Date.now() - lastOrderDate.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  let recency: RecencyStatus = "nunca_comprou";
  if (daysSinceLastOrder !== null) {
    if (daysSinceLastOrder <= 30) recency = "ativo";
    else if (daysSinceLastOrder <= 90) recency = "esfriando";
    else recency = "sumido";
  }

  return {
    customer,
    orders: validOrders,
    totalOrders,
    totalSpent,
    avgTicket,
    lastOrderDate: lastOrderDate ? lastOrderDate.toISOString() : null,
    daysSinceLastOrder,
    recency,
  };
}

export const RECENCY_LABEL: Record<RecencyStatus, { label: string; hex: string }> = {
  ativo: { label: "Ativo (até 30 dias)", hex: "#0ca30c" },
  esfriando: { label: "Esfriando (31–90 dias)", hex: "#fab219" },
  sumido: { label: "Sumido (90+ dias)", hex: "#d03b3b" },
  nunca_comprou: { label: "Nunca comprou", hex: "#71717a" },
};
