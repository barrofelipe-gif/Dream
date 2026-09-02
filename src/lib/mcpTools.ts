import "server-only";
import { prisma } from "@/lib/prisma";
import { listCustomers, getCustomer, listOrdersByCustomer, summarizeCustomer } from "@/lib/trayCustomers";
import { fetchOrdersSince, summarizeSales, dataDiasAtras } from "@/lib/traySales";

/**
 * Ferramentas expostas via MCP (Model Context Protocol) para clientes externos
 * — Claude (inclusive no celular) e ChatGPT — consultarem os dados da BFF.
 *
 * Tudo aqui é SOMENTE LEITURA de propósito: um assistente conectado pode
 * consultar vendas, clientes e pendências, mas não altera nada.
 */

export interface McpTool {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, { type: string; description: string; enum?: unknown[] }>;
    required?: string[];
  };
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "vendas_resumo",
    description:
      "Resumo de vendas da loja BFF Fitness num período: faturamento, número de pedidos, ticket médio, clientes únicos, taxa de cancelamento, quebra por status e faturamento por dia. Use para responder qualquer pergunta sobre desempenho comercial, faturamento ou volume de pedidos.",
    inputSchema: {
      type: "object",
      properties: {
        dias: {
          type: "number",
          description: "Período em dias a analisar. Aceita 7, 30 ou 90. Padrão: 30.",
        },
      },
    },
  },
  {
    name: "clientes_listar",
    description:
      "Lista clientes cadastrados na loja, com nome, e-mail, cidade e estado. Aceita busca por e-mail exato. Use para achar um cliente específico ou ver o tamanho da base.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Filtra por e-mail exato do cliente (opcional)." },
        pagina: { type: "number", description: "Página da listagem, começa em 1. Padrão: 1." },
      },
    },
  },
  {
    name: "cliente_detalhe",
    description:
      "Detalhe de um cliente com o histórico real de pedidos: total gasto, ticket médio, data da última compra, dias desde a última compra e classificação de recência (ativo, esfriando, sumido, nunca comprou).",
    inputSchema: {
      type: "object",
      properties: {
        customer_id: { type: "string", description: "ID do cliente na Tray." },
      },
      required: ["customer_id"],
    },
  },
  {
    name: "pendencias_listar",
    description:
      "Lista as pendências do painel do Felipe (processos jurídicos, empresa BFF, e-mails, viagens), com prazo, prioridade e se já está concluída. Use para responder o que está pendente, atrasado ou vencendo.",
    inputSchema: {
      type: "object",
      properties: {
        categoria: {
          type: "string",
          description: "Filtra por categoria.",
          enum: ["processos", "bff", "emails", "viagens"],
        },
        incluir_concluidas: {
          type: "boolean",
          description: "Se true, inclui as já concluídas. Padrão: false.",
        },
      },
    },
  },
  {
    name: "setores_status",
    description:
      "Status atual dos setores da empresa (financeiro, marketing/vendas, estoque, logística, clientes, suporte, jurídico, desenvolvimento de produto) — o semáforo do Mapa da Empresa, com os valores preenchidos manualmente.",
    inputSchema: { type: "object", properties: {} },
  },
];

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string | null) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—";

/** Executa uma ferramenta e devolve texto pronto pro assistente ler. */
export async function runMcpTool(name: string, args: Record<string, unknown>): Promise<string> {
  switch (name) {
    case "vendas_resumo": {
      const pedido = Number(args.dias ?? 30);
      const dias = [7, 30, 90].includes(pedido) ? pedido : 30;
      const desde = dataDiasAtras(dias);
      const { orders, truncated } = await fetchOrdersSince(desde);
      const r = summarizeSales(orders, dias, desde, truncated);

      const linhas = [
        `Vendas dos últimos ${dias} dias (desde ${dataBR(r.desde)}):`,
        `- Faturamento: ${brl(r.faturamento)}`,
        `- Pedidos válidos: ${r.pedidosValidos}`,
        `- Pedidos cancelados: ${r.pedidosCancelados} (${(r.taxaCancelamento * 100).toFixed(1)}% do total)`,
        `- Ticket médio: ${brl(r.ticketMedio)}`,
        `- Clientes únicos que compraram: ${r.clientesUnicos}`,
        "",
        "Pedidos por status:",
        ...r.porStatus.map((s) => `- ${s.status}: ${s.pedidos} pedido(s), ${brl(s.valor)}`),
        "",
        "Faturamento por dia:",
        ...r.porDia.map((d) => `- ${dataBR(d.dia)}: ${brl(d.valor)} em ${d.pedidos} pedido(s)`),
      ];
      if (r.truncado) {
        linhas.push("", "(Período grande: considerados apenas os pedidos mais recentes.)");
      }
      return linhas.join("\n");
    }

    case "clientes_listar": {
      const { customers, paging } = await listCustomers({
        page: Number(args.pagina ?? 1),
        search: typeof args.email === "string" ? args.email : undefined,
      });
      if (customers.length === 0) return "Nenhum cliente encontrado com esse filtro.";
      return [
        `${paging.total} cliente(s) no total. Mostrando página ${paging.page}:`,
        "",
        ...customers.map(
          (c) =>
            `- [${c.id}] ${c.name} · ${c.email ?? "sem e-mail"}` +
            (c.city ? ` · ${c.city}/${c.state}` : "") +
            (c.last_visit ? ` · última visita ${dataBR(c.last_visit)}` : "")
        ),
        "",
        "Use cliente_detalhe com o ID entre colchetes para ver o histórico de compras.",
      ].join("\n");
    }

    case "cliente_detalhe": {
      const id = String(args.customer_id ?? "");
      if (!id) return "Informe o customer_id.";
      const [cliente, pedidos] = await Promise.all([getCustomer(id), listOrdersByCustomer(id)]);
      const s = summarizeCustomer(cliente, pedidos);
      return [
        `Cliente ${s.customer.name} (ID ${s.customer.id})`,
        `- E-mail: ${s.customer.email ?? "—"}`,
        `- Cidade: ${s.customer.city ?? "—"}/${s.customer.state ?? "—"}`,
        `- Pedidos (não cancelados): ${s.totalOrders}`,
        `- Total gasto: ${brl(s.totalSpent)}`,
        `- Ticket médio: ${brl(s.avgTicket)}`,
        `- Última compra: ${dataBR(s.lastOrderDate)}` +
          (s.daysSinceLastOrder !== null ? ` (${s.daysSinceLastOrder} dias atrás)` : ""),
        `- Recência: ${s.recency}`,
        "",
        s.orders.length > 0 ? "Pedidos:" : "Sem pedidos registrados.",
        ...s.orders.map((o) => `- ${dataBR(o.date)} · ${o.status} · ${brl(parseFloat(o.total) || 0)}`),
      ].join("\n");
    }

    case "pendencias_listar": {
      const incluirConcluidas = args.incluir_concluidas === true;
      const itens = await prisma.item.findMany({
        where: {
          ...(args.categoria ? { category: args.categoria as never } : {}),
          ...(incluirConcluidas ? {} : { completedAt: null }),
        },
        include: { column: { select: { name: true, isDone: true } }, owner: { select: { name: true } } },
        orderBy: [{ due: "asc" }, { createdAt: "desc" }],
        take: 100,
      });
      if (itens.length === 0) return "Nenhuma pendência encontrada com esse filtro.";

      const hoje = new Date().toISOString().slice(0, 10);
      return [
        `${itens.length} pendência(s):`,
        "",
        ...itens.map((i) => {
          const prazo = i.due ? i.due.toISOString().slice(0, 10) : null;
          const atraso = prazo && !i.column.isDone && prazo < hoje ? " ⚠ ATRASADA" : "";
          return (
            `- [${i.category}] ${i.title}` +
            ` · ${i.column.name}` +
            ` · prioridade ${i.priority}` +
            (prazo ? ` · vence ${dataBR(prazo)}` : " · sem prazo") +
            ` · de ${i.owner.name}` +
            atraso
          );
        }),
      ].join("\n");
    }

    case "setores_status": {
      const metrics = await prisma.sectorMetric.findMany({ orderBy: [{ sector: "asc" }] });
      if (metrics.length === 0) {
        return "Nenhum setor preenchido ainda no Mapa da Empresa. Os dados de vendas e clientes continuam disponíveis pelas outras ferramentas.";
      }
      return [
        "Status dos setores (Mapa da Empresa):",
        "",
        ...metrics.map(
          (m) =>
            `- ${m.sector} / ${m.label}: ${m.status}` +
            (m.value ? ` · ${m.value}` : "") +
            (m.note ? ` · ${m.note}` : "")
        ),
      ].join("\n");
    }

    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}
