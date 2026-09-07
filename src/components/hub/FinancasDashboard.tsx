import { buscarPedidosCaixa, montarFluxoCaixa } from "@/lib/trayCaixa";
import { dataDiasAtras } from "@/lib/traySales";
import { fetchProducts, analisarProdutos } from "@/lib/trayProducts";

/**
 * Dashboard REAL de Finanças — a primeira área do hub conectada a dado de
 * verdade (as outras 6 continuam com orgMockData, dados de demonstração).
 *
 * Fluxo de caixa: já é 100% real (mesma fonte que o antigo /empresa/vendas
 * usava, via trayCaixa.ts — pago/a receber/cancelado, por forma de
 * pagamento, olhando a DATA DO PAGAMENTO). Margem bruta: aproximada, porque
 * a Tray só dá quantidade vendida por produto no histórico total da loja,
 * não por período — por isso aparece separada, com o período dela deixado
 * claro, em vez de misturada nos 30 dias do caixa.
 *
 * Sem DRE completo: falta uma fonte de despesas gerais (aluguel, folha,
 * etc.) que não está conectada em lugar nenhum ainda.
 */

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export default async function FinancasDashboard() {
  const dias = 30;
  const desde = dataDiasAtras(dias);

  const [pedidos, produtos] = await Promise.all([
    buscarPedidosCaixa(desde),
    fetchProducts(),
  ]);

  const caixa = montarFluxoCaixa(pedidos, dias, desde);
  const analise = analisarProdutos(produtos);
  const receitaCatalogo = analise.reduce((s, p) => s + p.receita, 0);
  const custoCatalogo = analise.reduce((s, p) => s + p.custoNum * p.vendidosNum, 0);
  const margemBrutaCatalogo = receitaCatalogo - custoCatalogo;
  const margemPctCatalogo = receitaCatalogo > 0 ? margemBrutaCatalogo / receitaCatalogo : 0;

  const maxDia = Math.max(...caixa.porDia.map((d) => d.liquido), 1);

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1b1f2b]">FINANÇAS</h1>
          <p className="mt-1 text-sm text-[#5a5f6d]">Caixa, faturamento, margem e pendências.</p>
        </div>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
          Dado real — conectado à Tray, últimos {dias} dias (desde {dataBR(caixa.desde)})
        </span>
      </div>

      {/* grid-cols-1 no celular: em 2 colunas o valor em R$ estourava a
          largura do card e cortava o texto (achado testando no mobile) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0 rounded-2xl border border-[#e3e5ea] bg-white p-4 shadow-sm">
          <p className="text-xs text-[#8a8f9c]">Bruto ({dias}d)</p>
          <p className="mt-1.5 truncate text-xl font-semibold text-[#1b1f2b] sm:text-2xl">{brl(caixa.bruto)}</p>
          <p className="mt-1 text-xs text-[#5a5f6d]">{caixa.pedidosPagos} pagamento(s)</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-[#e3e5ea] bg-white p-4 shadow-sm">
          <p className="text-xs text-[#8a8f9c]">Líquido na conta</p>
          <p className="mt-1.5 truncate text-xl font-semibold text-emerald-700 sm:text-2xl">{brl(caixa.liquido)}</p>
          <p className="mt-1 text-xs text-[#5a5f6d]">
            −{brl(caixa.taxas)} de taxa ({(caixa.taxaMediaPct * 100).toFixed(1)}%)
          </p>
        </div>
        <div className="min-w-0 rounded-2xl border border-[#e3e5ea] bg-white p-4 shadow-sm">
          <p className="text-xs text-[#8a8f9c]">A receber</p>
          <p className="mt-1.5 truncate text-xl font-semibold text-indigo-700 sm:text-2xl">{brl(caixa.valorAguardando)}</p>
          <p className="mt-1 text-xs text-[#5a5f6d]">{caixa.pedidosAguardando} pedido(s) aguardando</p>
        </div>
        <div className="min-w-0 rounded-2xl border border-[#e3e5ea] bg-white p-4 shadow-sm">
          <p className="text-xs text-[#8a8f9c]">Perdido em cancelamento</p>
          <p className="mt-1.5 truncate text-xl font-semibold text-rose-700 sm:text-2xl">{brl(caixa.valorCancelado)}</p>
          <p className="mt-1 text-xs text-[#5a5f6d]">{caixa.pedidosCancelados} pedido(s)</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm lg:col-span-2">
          <p className="text-sm font-medium text-[#1b1f2b]">Entrada líquida por dia (últimos {dias} dias)</p>
          <div className="mt-4 flex h-40 items-end gap-1 overflow-x-auto">
            {caixa.porDia.map((d) => (
              <div key={d.dia} className="flex h-full min-w-[6px] flex-1 flex-col items-end justify-end gap-1">
                <div
                  className="w-full rounded-t-sm bg-emerald-500/70"
                  style={{ height: `${Math.max((d.liquido / maxDia) * 100, 2)}%` }}
                  title={`${dataBR(d.dia)}: ${brl(d.liquido)}`}
                />
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-[#a1a5b0]">
            {caixa.porDia.length > 0 ? `${dataBR(caixa.porDia[0].dia)} → ${dataBR(caixa.porDia[caixa.porDia.length - 1].dia)}` : "sem pagamentos no período"}
          </p>
        </div>

        <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-[#1b1f2b]">Margem bruta do catálogo</p>
          <p className="mt-1 text-[11px] text-[#a1a5b0]">Histórico da loja (não é só {dias}d — a Tray não separa venda por período aqui)</p>
          <p className="mt-3 truncate text-xl font-semibold text-[#1b1f2b] sm:text-2xl">{brl(margemBrutaCatalogo)}</p>
          <p className="mt-1 text-xs text-[#5a5f6d]">{(margemPctCatalogo * 100).toFixed(1)}% sobre {brl(receitaCatalogo)} de receita</p>
          <p className="mt-3 text-xs text-[#a1a5b0]">Aproximação: receita − custo de produto. Não é DRE (falta despesa geral).</p>
        </div>
      </div>

      <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
        <p className="mb-3 text-sm font-medium text-[#1b1f2b]">Por forma de pagamento</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-wide text-[#a1a5b0]">
              <tr>
                <th className="py-2 pr-4">Forma</th>
                <th className="py-2 pr-4">Pagamentos</th>
                <th className="py-2 pr-4">Bruto</th>
                <th className="py-2 pr-4">Taxa média</th>
                <th className="py-2">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {caixa.porForma.map((f) => (
                <tr key={f.forma} className="border-t border-[#eef0f4]">
                  <td className="py-2 pr-4">{f.forma}</td>
                  <td className="py-2 pr-4 text-[#5a5f6d]">{f.pedidos}</td>
                  <td className="py-2 pr-4">{brl(f.bruto)}</td>
                  <td className="py-2 pr-4 text-[#5a5f6d]">{(f.taxaMediaPct * 100).toFixed(1)}%</td>
                  <td className="py-2 font-medium text-emerald-700">{brl(f.liquido)}</td>
                </tr>
              ))}
              {caixa.porForma.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-[#a1a5b0]">
                    Nenhum pagamento confirmado no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
