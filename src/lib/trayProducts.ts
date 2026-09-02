import "server-only";
import { trayGet } from "@/lib/tray";

/**
 * Produtos e estoque da Tray (/products).
 *
 * O cadastro do produto já traz `quantity_sold`, `stock`, `price` e
 * `cost_price` — dá pra montar curva ABC, margem e alerta de estoque sem
 * precisar varrer todos os pedidos.
 */

export interface TrayProduct {
  id: string;
  name: string;
  price: string | null;
  cost_price: string | null;
  promotional_price: string | null;
  stock: string | null;
  minimum_stock: string | null;
  quantity_sold: string | null;
  brand: string | null;
  reference: string | null;
  available: string | null;
  category_id: string | null;
  ean: string | null;
}

interface ProductsListResponse {
  paging: { total: number; page: number; offset: number; limit: number; maxLimit: number };
  Products?: { Product: TrayProduct }[];
}

const num = (v: string | null | undefined): number => {
  const n = parseFloat(v ?? "");
  return Number.isFinite(n) ? n : 0;
};

/** Busca produtos paginando. `maxProdutos` evita estourar o tempo da função. */
export async function fetchProducts(maxProdutos = 800): Promise<TrayProduct[]> {
  const limit = 50;
  const todos: TrayProduct[] = [];
  let page = 1;

  while (todos.length < maxProdutos) {
    const data = await trayGet<ProductsListResponse>("products", {
      limit: String(limit),
      page: String(page),
    });
    const lote = (data.Products ?? []).map((p) => p.Product);
    todos.push(...lote);
    if (lote.length < limit) break;
    page += 1;
  }

  return todos.slice(0, maxProdutos);
}

export interface ProdutoAnalise extends TrayProduct {
  precoNum: number;
  custoNum: number;
  estoqueNum: number;
  vendidosNum: number;
  receita: number; // preço × quantidade vendida (histórico da loja)
  margemUnit: number; // preço − custo
  margemPct: number; // margem sobre o preço
  valorEstoque: number; // custo × estoque parado
  classeAbc: "A" | "B" | "C" | "sem_venda";
}

/**
 * Curva ABC clássica por receita acumulada: A = primeiros 80% do faturamento,
 * B = até 95%, C = o resto. Produtos que nunca venderam ficam separados, porque
 * misturá-los na classe C esconderia o problema real (estoque parado).
 */
export function analisarProdutos(produtos: TrayProduct[]): ProdutoAnalise[] {
  const base = produtos.map((p) => {
    const precoNum = num(p.promotional_price) > 0 ? num(p.promotional_price) : num(p.price);
    const custoNum = num(p.cost_price);
    const estoqueNum = num(p.stock);
    const vendidosNum = num(p.quantity_sold);
    const receita = precoNum * vendidosNum;
    const margemUnit = precoNum - custoNum;
    return {
      ...p,
      precoNum,
      custoNum,
      estoqueNum,
      vendidosNum,
      receita,
      margemUnit,
      margemPct: precoNum > 0 ? margemUnit / precoNum : 0,
      valorEstoque: custoNum * estoqueNum,
      classeAbc: "sem_venda" as ProdutoAnalise["classeAbc"],
    };
  });

  const comVenda = base.filter((p) => p.receita > 0).sort((a, b) => b.receita - a.receita);
  const receitaTotal = comVenda.reduce((s, p) => s + p.receita, 0);

  let acumulado = 0;
  for (const p of comVenda) {
    acumulado += p.receita;
    const pct = receitaTotal > 0 ? acumulado / receitaTotal : 1;
    p.classeAbc = pct <= 0.8 ? "A" : pct <= 0.95 ? "B" : "C";
  }

  return base.sort((a, b) => b.receita - a.receita);
}

export interface ResumoAbc {
  classe: string;
  produtos: number;
  receita: number;
  pctReceita: number;
  valorEstoque: number;
}

export function resumirAbc(analise: ProdutoAnalise[]): ResumoAbc[] {
  const receitaTotal = analise.reduce((s, p) => s + p.receita, 0);
  const classes: ProdutoAnalise["classeAbc"][] = ["A", "B", "C", "sem_venda"];

  return classes.map((classe) => {
    const doGrupo = analise.filter((p) => p.classeAbc === classe);
    const receita = doGrupo.reduce((s, p) => s + p.receita, 0);
    return {
      classe,
      produtos: doGrupo.length,
      receita,
      pctReceita: receitaTotal > 0 ? receita / receitaTotal : 0,
      valorEstoque: doGrupo.reduce((s, p) => s + p.valorEstoque, 0),
    };
  });
}
