import "server-only";
import { trayGet } from "@/lib/tray";
import { fetchProducts } from "@/lib/trayProducts";
import { dataDiasAtras, fetchOrdersSince, isCancelado } from "@/lib/traySales";
import { REVIEWS_ORIGIN } from "@/lib/avaliacoes";

/**
 * Estoque, custo e venda por tamanho de cada produto da BFF → sistema de avaliações (giro, cobertura,
 * retorno do dinheiro parado e ofertas). Roda todo dia pelo cron /api/cron/estoque-avaliacoes.
 *
 * Fontes (Tray, limite de 180 requisições/min):
 *  - /products           preço, custo (cost_price), estoque total, data de lançamento
 *  - /products/variants  estoque por variação (tamanho/cor), paginado SEM filtro de produto
 *  - /products_solds     itens vendidos (variant_id + order_id, sem data própria), paginado SEM filtro de
 *                        produto (com filtro a paginação da Tray quebra — ver trayVariants.ts), do mais novo
 *                        para o mais antigo, até sair da janela de 30 dias
 *  - /orders (30 dias)   datas e status, para contar só pedido válido dentro do período
 */

type Variant = { id: string; product_id: string; stock: string; price?: string; cost_price?: string; Sku?: { type: string; value: string }[] | string | null };
type Sold = { product_id: string; order_id: string; quantity: string; variant_id: string };
type Paged<K extends string, T> = { paging?: { total: number }; } & Partial<Record<K, { [k: string]: T }[]>>;

const num = (v: unknown) => { const n = parseFloat(String(v ?? "")); return Number.isFinite(n) ? n : 0; };
const MAX_PAGINAS = 80;

function rotulo(sku: Variant["Sku"]): { tamanho: string; cor: string } {
  if (!sku || typeof sku === "string") return { tamanho: (sku as string) || "", cor: "" };
  const pega = (re: RegExp) => sku.find((s) => re.test(s.type || ""))?.value || "";
  return { tamanho: pega(/tamanho/i).toUpperCase(), cor: pega(/cor/i) };
}

async function todasVariacoes(): Promise<Variant[]> {
  const out: Variant[] = [];
  let total: number | null = null;
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const d = await trayGet<Paged<"Variants", Variant>>("products/variants", { limit: "50", page: String(page) });
    if (d.paging?.total != null) total = Number(d.paging.total);
    const lote = (d.Variants ?? []).map((v) => v.Variant);
    out.push(...lote);
    if (lote.length < 50 || (total != null && out.length >= total)) return out;
  }
  // Carga cortada no meio: melhor nao mandar nada do que mandar estoque pela metade
  throw new Error(`Variações incompletas: ${out.length}${total != null ? ` de ${total}` : ""} (limite de ${MAX_PAGINAS} páginas).`);
}

/** Itens vendidos em pedidos válidos dos últimos `dias`, por variação. */
async function vendasPorVariacao(dias: number): Promise<{ porVariacao: Map<string, number>; porProduto: Map<string, number>; paginas: number; mes: { faturamento: number; pedidos: number } }> {
  // Janela = 30 dias OU desde o dia 1 do mes (o que vier antes), para tambem dar o faturamento do mes
  const inicioMes = new Date().toISOString().slice(0, 8) + "01";
  const desde = [dataDiasAtras(dias), inicioMes].sort()[0];
  const { orders: todosPedidos } = await fetchOrdersSince(desde, 6000);
  const corte = dataDiasAtras(dias);
  const orders = todosPedidos.filter((o) => String(o.date).slice(0, 10) >= corte);
  const doMes = todosPedidos.filter((o) => String(o.date).slice(0, 10) >= inicioMes && !isCancelado(o.status));
  const mes = { faturamento: Math.round(doMes.reduce((s, o) => s + num(o.total), 0)), pedidos: doMes.length };
  const validos = new Set(orders.filter((o) => !isCancelado(o.status)).map((o) => o.id));
  const todos = new Set(orders.map((o) => o.id));
  const porVariacao = new Map<string, number>(), porProduto = new Map<string, number>();
  let paginas = 0;
  for (let page = 1; page <= MAX_PAGINAS; page++) {
    const d = await trayGet<Paged<"ProductsSolds", Sold>>("products_solds", { limit: "50", page: String(page), sort: "id_desc" });
    const lote = (d.ProductsSolds ?? []).map((s) => s.ProductsSold);
    paginas++;
    let naJanela = 0;
    for (const s of lote) {
      if (todos.has(s.order_id)) naJanela++;
      if (!validos.has(s.order_id)) continue;
      const q = num(s.quantity);
      porVariacao.set(s.variant_id, (porVariacao.get(s.variant_id) || 0) + q);
      porProduto.set(s.product_id, (porProduto.get(s.product_id) || 0) + q);
    }
    // do mais novo para o mais antigo: pagina inteira fora da janela = acabou o periodo
    if (lote.length < 50 || (page > 1 && naJanela === 0)) return { porVariacao, porProduto, paginas, mes };
  }
  throw new Error(`Vendas incompletas: ${MAX_PAGINAS} páginas lidas sem chegar ao começo dos ${dias} dias.`);
}

export type ProdutoEstoque = {
  product_id: number; price: number; promo_price: number; cost: number; stock: number; sold_30d: number;
  release_date: string | null; active: boolean;
  variants: { variant_id: string; tamanho: string; cor: string; stock: number; sold_30d: number }[];
};

export async function montarEstoque(): Promise<{ produtos: ProdutoEstoque[]; paginasVendas: number; variacoes: number; mes: { faturamento: number; pedidos: number } }> {
  const [produtos, variacoes, vendas] = await Promise.all([fetchProducts(3000), todasVariacoes(), vendasPorVariacao(30)]);
  const porProduto = new Map<string, Variant[]>();
  for (const v of variacoes) { const a = porProduto.get(v.product_id) || []; a.push(v); porProduto.set(v.product_id, a); }
  const out = produtos.map((p) => {
    const raw = p as unknown as Record<string, unknown>;
    const vs = (porProduto.get(p.id) || []).map((v) => ({ variant_id: v.id, ...rotulo(v.Sku), stock: num(v.stock), sold_30d: vendas.porVariacao.get(v.id) || 0 }));
    // Custo/preco: o do produto; se vier zerado, a media das variacoes pesada pelo estoque
    const vraw = porProduto.get(p.id) || [];
    const media = (campo: "price" | "cost_price") => {
      const c = vraw.filter((v) => num(v[campo]) > 0);
      if (!c.length) return 0;
      const peso = c.reduce((s, v) => s + Math.max(0, num(v.stock)), 0);
      return peso > 0 ? c.reduce((s, v) => s + num(v[campo]) * Math.max(0, num(v.stock)), 0) / peso : c.reduce((s, v) => s + num(v[campo]), 0) / c.length;
    };
    const lanc = String(raw.release_date || raw.creation_date || raw.date_creation || "").slice(0, 10);
    return {
      product_id: Number(p.id), price: num(p.price) || Math.round(media("price") * 100) / 100, promo_price: num(p.promotional_price),
      cost: num(p.cost_price) || Math.round(media("cost_price") * 100) / 100,
      stock: vs.length ? vs.reduce((s, v) => s + v.stock, 0) : num(p.stock), sold_30d: vendas.porProduto.get(p.id) || 0,
      release_date: /^\d{4}-\d{2}-\d{2}$/.test(lanc) && !lanc.startsWith("0000") ? lanc : null,
      active: p.available !== "0", variants: vs,
    };
  });
  return { produtos: out, paginasVendas: vendas.paginas, variacoes: variacoes.length, mes: vendas.mes };
}

/** Manda para o sistema de avaliações (BFF). */
export async function enviarEstoque(produtos: ProdutoEstoque[], mes?: { faturamento: number; pedidos: number }) {
  const tok = process.env.REVIEWS_API_TOKEN;
  if (!REVIEWS_ORIGIN || !tok) throw new Error("Sistema de avaliações não configurado (REVIEWS_ORIGIN/REVIEWS_API_TOKEN).");
  const r = await fetch(`${REVIEWS_ORIGIN}/api/admin/product-stock?loja=bff`, {
    method: "POST", headers: { authorization: `Bearer ${tok}`, "content-type": "application/json" },
    body: JSON.stringify({ produtos, mes }), cache: "no-store", signal: AbortSignal.timeout(30_000),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Sistema de avaliações respondeu ${r.status}: ${(d as { error?: string }).error || ""}`);
  return d as { ok: boolean; saved: number };
}
