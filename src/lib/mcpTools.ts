import "server-only";
import { prisma } from "@/lib/prisma";
import { listCustomers, getCustomer, listOrdersByCustomer, summarizeCustomer } from "@/lib/trayCustomers";
import { fetchOrdersSince, summarizeSales, dataDiasAtras, isCancelado } from "@/lib/traySales";
import { fetchProducts, analisarProdutos, resumirAbc } from "@/lib/trayProducts";

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
  {
    name: "produtos_curva_abc",
    description:
      "Curva ABC do catálogo por receita: classe A são os produtos que fazem 80% do faturamento, B até 95%, C o resto, e ainda separa os que nunca venderam. Traz também o valor de estoque parado em cada classe. Use para priorizar reposição, achar produto encalhado e decidir o que promover.",
    inputSchema: {
      type: "object",
      properties: {
        classe: {
          type: "string",
          description: "Mostra a lista detalhada de produtos de uma classe específica.",
          enum: ["A", "B", "C", "sem_venda"],
        },
        limite: { type: "number", description: "Quantos produtos listar. Padrão: 20." },
      },
    },
  },
  {
    name: "produtos_mais_vendidos",
    description:
      "Ranking dos produtos que mais venderam no histórico da loja, com receita, quantidade vendida, preço, custo e margem. Use para saber qual produto puxa o faturamento.",
    inputSchema: {
      type: "object",
      properties: { limite: { type: "number", description: "Quantos listar. Padrão: 20." } },
    },
  },
  {
    name: "estoque_alerta",
    description:
      "Produtos em situação crítica de estoque: zerados, abaixo do estoque mínimo, ou encalhados (muito estoque parado e pouca venda). Traz o valor em dinheiro parado. Use para decidir o que produzir/repor e o que liquidar.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: {
          type: "string",
          description:
            "zerado = sem estoque; abaixo_minimo = abaixo do mínimo cadastrado; encalhado = estoque alto e pouca venda.",
          enum: ["zerado", "abaixo_minimo", "encalhado"],
        },
        limite: { type: "number", description: "Quantos listar. Padrão: 20." },
      },
    },
  },
  {
    name: "produtos_buscar",
    description:
      "Busca produtos do catálogo por parte do nome, marca ou referência, mostrando preço, custo, margem, estoque e quanto já vendeu.",
    inputSchema: {
      type: "object",
      properties: {
        termo: { type: "string", description: "Parte do nome, marca ou referência do produto." },
        limite: { type: "number", description: "Quantos listar. Padrão: 20." },
      },
      required: ["termo"],
    },
  },
  {
    name: "pedidos_listar",
    description:
      "Lista os pedidos de um período com data, status, valor e cliente. Permite filtrar por status (ex: só cancelados, ou só os que aguardam envio). Use para investigar cancelamentos, gargalo de expedição ou conferir pedidos recentes.",
    inputSchema: {
      type: "object",
      properties: {
        dias: { type: "number", description: "Período em dias. Padrão: 7." },
        status: {
          type: "string",
          description:
            "Filtra por status exato, ex: CANCELADO, FINALIZADO, ENVIADO, 'A ENVIAR VINDI', 'AGUARDANDO VINDI', 'A RETIRAR'.",
        },
        limite: { type: "number", description: "Quantos listar. Padrão: 30." },
      },
    },
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

    case "produtos_curva_abc": {
      const analise = analisarProdutos(await fetchProducts());
      const resumo = resumirAbc(analise);
      const classe = typeof args.classe === "string" ? args.classe : null;
      const limite = Number(args.limite ?? 20);

      const linhas = [
        `Curva ABC do catálogo (${analise.length} produtos):`,
        "",
        ...resumo.map(
          (r) =>
            `- Classe ${r.classe}: ${r.produtos} produto(s) · ${brl(r.receita)} de receita ` +
            `(${(r.pctReceita * 100).toFixed(1)}%) · ${brl(r.valorEstoque)} parado em estoque`
        ),
      ];

      if (classe) {
        const doGrupo = analise.filter((p) => p.classeAbc === classe).slice(0, limite);
        linhas.push("", `Produtos da classe ${classe} (top ${doGrupo.length}):`);
        linhas.push(
          ...doGrupo.map(
            (p) =>
              `- ${p.name} · receita ${brl(p.receita)} · ${p.vendidosNum} vendido(s) · ` +
              `estoque ${p.estoqueNum} · margem ${(p.margemPct * 100).toFixed(0)}%`
          )
        );
      } else {
        linhas.push(
          "",
          "Para ver os produtos de uma classe, chame de novo passando classe: 'A', 'B', 'C' ou 'sem_venda'."
        );
      }
      return linhas.join("\n");
    }

    case "produtos_mais_vendidos": {
      const limite = Number(args.limite ?? 20);
      const analise = analisarProdutos(await fetchProducts())
        .filter((p) => p.vendidosNum > 0)
        .slice(0, limite);
      if (analise.length === 0) return "Nenhum produto com venda registrada.";
      return [
        `Top ${analise.length} produtos por receita:`,
        "",
        ...analise.map(
          (p, i) =>
            `${i + 1}. ${p.name} [classe ${p.classeAbc}]` +
            ` · receita ${brl(p.receita)} · ${p.vendidosNum} vendido(s)` +
            ` · preço ${brl(p.precoNum)} · custo ${brl(p.custoNum)}` +
            ` · margem ${(p.margemPct * 100).toFixed(0)}% · estoque ${p.estoqueNum}`
        ),
      ].join("\n");
    }

    case "estoque_alerta": {
      const tipo = typeof args.tipo === "string" ? args.tipo : "zerado";
      const limite = Number(args.limite ?? 20);
      const analise = analisarProdutos(await fetchProducts());

      let filtrados = analise;
      let titulo = "";
      if (tipo === "zerado") {
        filtrados = analise.filter((p) => p.estoqueNum <= 0).sort((a, b) => b.receita - a.receita);
        titulo = "Produtos com estoque ZERADO (ordenados por quanto já faturaram)";
      } else if (tipo === "abaixo_minimo") {
        filtrados = analise
          .filter((p) => {
            const min = parseFloat(p.minimum_stock ?? "") || 0;
            return min > 0 && p.estoqueNum < min;
          })
          .sort((a, b) => b.receita - a.receita);
        titulo = "Produtos ABAIXO DO ESTOQUE MÍNIMO cadastrado";
      } else {
        // encalhado: estoque parado relevante e giro fraco
        filtrados = analise
          .filter((p) => p.estoqueNum >= 10 && p.vendidosNum <= 2 && p.valorEstoque > 0)
          .sort((a, b) => b.valorEstoque - a.valorEstoque);
        titulo = "Produtos ENCALHADOS (10+ em estoque e no máximo 2 vendas)";
      }

      const lista = filtrados.slice(0, limite);
      if (lista.length === 0) return `${titulo}: nenhum produto nessa situação.`;

      const totalParado = filtrados.reduce((s, p) => s + p.valorEstoque, 0);
      return [
        `${titulo}: ${filtrados.length} produto(s).`,
        tipo === "encalhado" ? `Valor total parado: ${brl(totalParado)}` : "",
        "",
        ...lista.map(
          (p) =>
            `- ${p.name} · estoque ${p.estoqueNum} · ${p.vendidosNum} vendido(s)` +
            ` · já faturou ${brl(p.receita)}` +
            (p.valorEstoque > 0 ? ` · ${brl(p.valorEstoque)} parado` : "")
        ),
      ]
        .filter(Boolean)
        .join("\n");
    }

    case "produtos_buscar": {
      const termo = String(args.termo ?? "").toLowerCase().trim();
      if (!termo) return "Informe o termo de busca.";
      const limite = Number(args.limite ?? 20);
      const achados = analisarProdutos(await fetchProducts())
        .filter((p) =>
          [p.name, p.brand, p.reference].some((c) => (c ?? "").toLowerCase().includes(termo))
        )
        .slice(0, limite);
      if (achados.length === 0) return `Nenhum produto encontrado com "${termo}".`;
      return [
        `${achados.length} produto(s) para "${termo}":`,
        "",
        ...achados.map(
          (p) =>
            `- [${p.id}] ${p.name} · preço ${brl(p.precoNum)} · custo ${brl(p.custoNum)}` +
            ` · margem ${(p.margemPct * 100).toFixed(0)}% · estoque ${p.estoqueNum}` +
            ` · ${p.vendidosNum} vendido(s) · classe ${p.classeAbc}`
        ),
      ].join("\n");
    }

    case "pedidos_listar": {
      const dias = Number(args.dias ?? 7);
      const limite = Number(args.limite ?? 30);
      const filtroStatus =
        typeof args.status === "string" ? args.status.trim().toUpperCase() : null;
      const desde = dataDiasAtras(dias);
      const { orders } = await fetchOrdersSince(desde);

      const filtrados = filtroStatus
        ? orders.filter((o) => (o.status ?? "").trim().toUpperCase() === filtroStatus)
        : orders;
      const lista = filtrados.slice(0, limite);

      if (lista.length === 0) {
        return `Nenhum pedido${filtroStatus ? ` com status ${filtroStatus}` : ""} nos últimos ${dias} dias.`;
      }

      const soma = filtrados
        .filter((o) => !isCancelado(o.status))
        .reduce((s, o) => s + (parseFloat(o.total) || 0), 0);

      return [
        `${filtrados.length} pedido(s)${filtroStatus ? ` com status ${filtroStatus}` : ""} ` +
          `nos últimos ${dias} dias (desde ${dataBR(desde)}). ` +
          `Valor dos não cancelados: ${brl(soma)}.`,
        "",
        `Mostrando ${lista.length}:`,
        ...lista.map(
          (o) =>
            `- Pedido ${o.id} · ${dataBR(o.date)} · ${o.status} · ${brl(parseFloat(o.total) || 0)}` +
            ` · cliente ${o.customer_id}`
        ),
      ].join("\n");
    }

    default:
      return `Ferramenta desconhecida: ${name}`;
  }
}
