import { fetchProducts, analisarProdutos } from "@/lib/trayProducts";
import { buscarDespesasAbertas, isBlingConectado } from "@/lib/blingMcp";

/**
 * Conteúdo real do papel "Controladoria" — DRE aproximado: margem bruta do
 * catálogo (Tray) menos despesas em aberto no Bling. NÃO é um DRE de
 * verdade — os períodos não batem (margem é histórico da loja, despesa é
 * uma janela de 30 dias pra frente) e falta despesa fixa (aluguel, folha)
 * fora do Bling. É um indicador direcional, deixado bem explícito.
 */

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

export default async function ControladoriaPapel() {
  const conectado = await isBlingConectado();

  const produtos = await fetchProducts();
  const analise = analisarProdutos(produtos);
  const receita = analise.reduce((s, p) => s + p.receita, 0);
  const custo = analise.reduce((s, p) => s + p.custoNum * p.vendidosNum, 0);
  const margemBruta = receita - custo;

  const despesas = conectado ? await buscarDespesasAbertas(30) : null;
  const resultadoAproximado = despesas ? margemBruta - despesas.total : null;

  return (
    <div className="mt-5 space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="min-w-0 rounded-xl border border-[#e3e5ea] bg-white p-4">
          <p className="text-xs text-[#8a8f9c]">Margem bruta do catálogo (histórico)</p>
          <p className="mt-1 truncate text-lg font-semibold text-[#1b1f2b]">{brl(margemBruta)}</p>
        </div>
        <div className="min-w-0 rounded-xl border border-[#e3e5ea] bg-white p-4">
          <p className="text-xs text-[#8a8f9c]">Despesas em aberto — Bling (30d)</p>
          <p className="mt-1 truncate text-lg font-semibold text-rose-700">
            {despesas ? brl(despesas.total) : "Bling não conectado"}
          </p>
        </div>
        <div className="min-w-0 rounded-xl border border-[#e3e5ea] bg-white p-4">
          <p className="text-xs text-[#8a8f9c]">Resultado aproximado</p>
          <p
            className={`mt-1 truncate text-lg font-semibold ${
              resultadoAproximado != null && resultadoAproximado < 0 ? "text-rose-700" : "text-[#1b1f2b]"
            }`}
          >
            {resultadoAproximado != null ? brl(resultadoAproximado) : "—"}
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800">
        Isso NÃO é um DRE fechado: a margem é o histórico total da loja (a Tray não separa venda por período aqui) e
        a despesa é só o que está em aberto no Bling nos próximos 30 dias — os períodos não coincidem. Aluguel,
        folha e afins aparecem sim como contas a pagar no Bling (ver aba Planejamento), mas ainda sem a categoria
        oficial da Bling pra separar despesa fixa de variável automaticamente. Serve como indicador direcional, não
        como número fechado de resultado do mês.
      </div>
    </div>
  );
}
