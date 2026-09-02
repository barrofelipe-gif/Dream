import "server-only";
import { trayGet } from "@/lib/tray";
import { fetchOrdersSince, isCancelado } from "@/lib/traySales";

/**
 * Grade de tamanhos (P/M/G etc.) por produto, pra planejamento de produção.
 *
 * A Tray guarda tamanho como uma VARIANTE do produto (/products/variants),
 * não como um campo solto: cada variante tem seu próprio `stock` (estoque
 * atual) e `Sku`, que vem como `[{ type: "Tamanho", value: "M" }]`.
 *
 * Quem vendeu o quê é outra rota, `/products_solds` — cada linha é um item de
 * pedido com `variant_id`, `product_id`, `order_id` e `quantity`, mas SEM data
 * própria. Pra saber "vendeu nos últimos 30 dias" é preciso cruzar o
 * `order_id` com a data do pedido — por isso usa fetchOrdersSince (mesma
 * fonte de data usada em vendas/fluxo de caixa) e só conta o que caiu num
 * pedido válido (não cancelado) dentro do período.
 *
 * CUIDADO — bug confirmado na API da Tray: quando `/products_solds` é
 * filtrado por `product_id`, o parâmetro `page`/`offset` é IGNORADO — toda
 * página devolve os mesmos 50 primeiros registros pra sempre (paginação real
 * só funciona sem esse filtro). Por isso aqui não pagina: pede só a página
 * mais recente (`sort=id_desc`, limit=50, o teto da API) e sinaliza quando o
 * produto tem mais vendas históricas do que isso cobre — na prática cobre bem
 * qualquer produto que não seja um best-seller absoluto num período de 30-90
 * dias, já que os 50 mais recentes por id vêm antes de qualquer venda antiga.
 */

export interface TrayVariantSkuAttr {
  type: string;
  value: string;
}

export interface TrayVariant {
  id: string;
  product_id: string;
  stock: string;
  quantity_sold: string;
  Sku?: TrayVariantSkuAttr[] | string | null;
}

interface VariantsListResponse {
  paging: { total: number; page: number; offset: number; limit: number; maxLimit: number };
  Variants?: { Variant: TrayVariant }[];
}

export interface TrayProductSold {
  id: string;
  product_id: string;
  order_id: string;
  quantity: string;
  variant_id: string;
}

interface ProductsSoldsListResponse {
  paging: { total: number; page: number; offset: number; limit: number; maxLimit: number };
  ProductsSolds?: { ProductsSold: TrayProductSold }[];
}

// Teto de páginas por segurança: mesmo não tendo visto o bug de paginação em
// /products/variants, mais de 500 variantes (10 páginas) pra um produto só
// não é um caso real — é sinal de algo errado, então para em vez de girar.
const MAX_PAGINAS = 10;

async function fetchVariantsByProduct(productId: string): Promise<TrayVariant[]> {
  const limit = 50;
  const all: TrayVariant[] = [];
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const data = await trayGet<VariantsListResponse>("products/variants", {
      product_id: productId,
      limit: String(limit),
      page: String(page),
    });
    const batch = (data.Variants ?? []).map((v) => v.Variant);
    all.push(...batch);
    if (batch.length < limit) break;
  }
  return all;
}

/** Só os registros de venda mais recentes do produto — ver nota de bug acima. */
async function fetchRecentSoldsByProduct(
  productId: string
): Promise<{ vendas: TrayProductSold[]; totalHistorico: number }> {
  const limit = 50;
  const data = await trayGet<ProductsSoldsListResponse>("products_solds", {
    product_id: productId,
    limit: String(limit),
    sort: "id_desc", // id crescente ~= ordem cronológica, então desc = mais recentes primeiro
  });
  return {
    vendas: (data.ProductsSolds ?? []).map((s) => s.ProductsSold),
    totalHistorico: data.paging?.total ?? 0,
  };
}

/** O Sku vem como `[{ type: "Tamanho", value: "M" }]` — extrai só o tamanho. */
function tamanhoDoSku(sku: TrayVariant["Sku"]): string {
  if (!sku) return "—";
  if (typeof sku === "string") return sku || "—";
  const item = sku.find((s) => (s.type ?? "").toLowerCase().includes("tamanho")) ?? sku[0];
  return item?.value || "—";
}

export interface GradeTamanho {
  tamanho: string;
  variantId: string;
  vendidoNoPeriodo: number;
  estoqueAtual: number;
}

export interface ProdutoGrade {
  productId: string;
  periodoDias: number;
  desde: string;
  tamanhos: GradeTamanho[];
  /** true = o produto tem mais vendas históricas do que a API deixou consultar
   *  (ver bug de paginação acima) — o número do período pode estar subestimado. */
  possívelSubestimativa: boolean;
}

/**
 * Grade de tamanhos de um produto: quanto vendeu de cada variante (P/M/G...)
 * nos últimos `dias` dias e quanto tem de estoque agora. Serve pra calcular
 * giro/cobertura por tamanho e decidir quanto produzir de cada um.
 */
export async function produtoGradeVendas(productId: string, dias = 30): Promise<ProdutoGrade> {
  const desde = (() => {
    const d = new Date();
    d.setDate(d.getDate() - dias);
    return d.toISOString().slice(0, 10);
  })();

  const [variantes, { vendas, totalHistorico }, { orders }] = await Promise.all([
    fetchVariantsByProduct(productId),
    fetchRecentSoldsByProduct(productId),
    fetchOrdersSince(desde),
  ]);

  // Só pedidos válidos (não cancelados) dentro do período contam como venda real.
  const pedidosValidosNoPeriodo = new Set(
    orders.filter((o) => !isCancelado(o.status)).map((o) => o.id)
  );

  const vendidoPorVariante = new Map<string, number>();
  for (const v of vendas) {
    if (!pedidosValidosNoPeriodo.has(v.order_id)) continue;
    const atual = vendidoPorVariante.get(v.variant_id) ?? 0;
    vendidoPorVariante.set(v.variant_id, atual + (parseFloat(v.quantity) || 0));
  }

  const tamanhos = variantes
    .map((v) => ({
      tamanho: tamanhoDoSku(v.Sku),
      variantId: v.id,
      vendidoNoPeriodo: vendidoPorVariante.get(v.id) ?? 0,
      estoqueAtual: parseFloat(v.stock) || 0,
    }))
    .sort((a, b) => b.vendidoNoPeriodo - a.vendidoNoPeriodo);

  // Se o mais antigo dos registros buscados ainda cai dentro do período, pode
  // haver vendas mais antigas (fora dos 50 mais recentes) que também estariam
  // dentro do período e não foram contadas.
  const maisAntigoAindaNoPeriodo =
    vendas.length > 0 && pedidosValidosNoPeriodo.has(vendas[vendas.length - 1].order_id);
  const possívelSubestimativa = totalHistorico > vendas.length && maisAntigoAindaNoPeriodo;

  return { productId, periodoDias: dias, desde, tamanhos, possívelSubestimativa };
}
