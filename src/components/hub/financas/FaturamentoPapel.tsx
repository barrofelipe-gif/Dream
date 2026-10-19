import { buscarPedidosCaixa, montarFluxoCaixa } from "@/lib/trayCaixa";
import { dataDiasAtras } from "@/lib/traySales";

/** Conteúdo real do papel "Faturamento" — mesmo motor de caixa da Tray usado na home de Finanças, resumido pro papel. */

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function FaturamentoPapel() {
  const dias = 30;
  const desde = dataDiasAtras(dias);
  const pedidos = await buscarPedidosCaixa(desde);
  const caixa = montarFluxoCaixa(pedidos, dias, desde);

  return (
    <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="min-w-0 rounded-xl border border-[#e3e5ea] bg-white p-4">
        <p className="text-xs text-[#8a8f9c]">Faturado bruto ({dias}d)</p>
        <p className="mt-1 truncate text-lg font-semibold text-[#1b1f2b]">{brl(caixa.bruto)}</p>
        <p className="mt-1 text-xs text-[#5a5f6d]">{caixa.pedidosPagos} pagamento(s) confirmado(s)</p>
      </div>
      <div className="min-w-0 rounded-xl border border-[#e3e5ea] bg-white p-4">
        <p className="text-xs text-[#8a8f9c]">Aguardando confirmação</p>
        <p className="mt-1 truncate text-lg font-semibold text-indigo-700">{brl(caixa.valorAguardando)}</p>
        <p className="mt-1 text-xs text-[#5a5f6d]">{caixa.pedidosAguardando} pedido(s) sem pagamento ainda</p>
      </div>
      <div className="min-w-0 rounded-xl border border-[#e3e5ea] bg-white p-4">
        <p className="text-xs text-[#8a8f9c]">Cancelado ({dias}d)</p>
        <p className="mt-1 truncate text-lg font-semibold text-rose-700">{brl(caixa.valorCancelado)}</p>
        <p className="mt-1 text-xs text-[#5a5f6d]">{caixa.pedidosCancelados} pedido(s) — checar motivo recorrente</p>
      </div>
      <div className="min-w-0 rounded-xl border border-[#e3e5ea] bg-white p-4">
        <p className="text-xs text-[#8a8f9c]">Taxa média de adquirência</p>
        <p className="mt-1 truncate text-lg font-semibold text-[#1b1f2b]">{(caixa.taxaMediaPct * 100).toFixed(1)}%</p>
        <p className="mt-1 text-xs text-[#5a5f6d]">−{brl(caixa.taxas)} sobre o bruto do período</p>
      </div>
    </div>
  );
}
