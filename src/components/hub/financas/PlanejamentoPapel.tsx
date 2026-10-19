import {
  buscarProjecaoMultiJanela,
  buscarDespesasAbertas,
  isBlingConectado,
} from "@/lib/blingMcp";

/**
 * Conteúdo real do papel "Planejamento" de Finanças — projeção de fluxo de
 * caixa a 30/60/90 dias e as despesas (contas a pagar) que sustentam essa
 * projeção, pra virar o "orçamento"/teto de gastos citado na descrição do
 * papel. Antes disso era só a ficha estática — clicava e não abria em nada
 * de fato interativo.
 */

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export default async function PlanejamentoPapel() {
  const conectado = await isBlingConectado();

  if (!conectado) {
    return (
      <div className="rounded-xl border border-dashed border-[#e3e5ea] bg-[#f9fafb] p-4 text-sm text-[#8a8f9c]">
        Conecta o Bling em Finanças pra ver a projeção de fluxo de caixa e as despesas em aberto aqui.
      </div>
    );
  }

  // Sequencial — cada uma dessas já dispara várias requisições internas pro
  // lado da Bling, e a Bling limita 3 req/s por app.
  const projecoes = await buscarProjecaoMultiJanela();
  const despesas = await buscarDespesasAbertas(60);

  return (
    <div className="mt-5 space-y-5">
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">
          Projeção de fluxo de caixa (Bling — contas a pagar/receber em aberto)
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-sm">
            <thead className="font-mono text-[10px] uppercase tracking-wide text-[#a1a5b0]">
              <tr>
                <th className="py-2 pr-4">Janela</th>
                <th className="py-2 pr-4">A receber</th>
                <th className="py-2 pr-4">A pagar</th>
                <th className="py-2">Saldo projetado</th>
              </tr>
            </thead>
            <tbody>
              {projecoes.map((p) => (
                <tr key={p.dias} className="border-t border-[#eef0f4]">
                  <td className="py-2 pr-4 font-medium text-[#1b1f2b]">{p.dias} dias</td>
                  <td className="py-2 pr-4 text-emerald-700">{brl(p.totalEntradas)}</td>
                  <td className="py-2 pr-4 text-rose-700">{brl(p.totalSaidas)}</td>
                  <td className={`py-2 font-medium ${p.saldoFinalProjetado < 0 ? "text-rose-700" : "text-[#1b1f2b]"}`}>
                    {brl(p.saldoFinalProjetado)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-[#a1a5b0]">
          Soma de títulos em aberto com vencimento dentro de cada janela — não é saldo bancário real.
        </p>
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">
            Despesas em aberto (próximos 60 dias) — base pro orçamento
          </p>
          <span className="text-sm font-semibold text-rose-700">{brl(despesas.total)}</span>
        </div>
        {despesas.porFornecedor.length === 0 ? (
          <p className="text-sm text-[#8a8f9c]">Nenhuma conta a pagar em aberto nessa janela.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[440px] text-left text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-wide text-[#a1a5b0]">
                <tr>
                  <th className="py-2 pr-4">Fornecedor</th>
                  <th className="py-2 pr-4">Total</th>
                  <th className="py-2 pr-4">Títulos</th>
                  <th className="py-2">Próx. vencimento</th>
                </tr>
              </thead>
              <tbody>
                {despesas.porFornecedor.slice(0, 15).map((f) => (
                  <tr key={f.nome} className="border-t border-[#eef0f4]">
                    <td className="py-2 pr-4">
                      {f.nome}
                      {f.recorrente && (
                        <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                          recorrente
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-medium text-rose-700">{brl(f.total)}</td>
                    <td className="py-2 pr-4 text-[#5a5f6d]">{f.ocorrencias}</td>
                    <td className="py-2 text-[#5a5f6d]">{dataBR(f.proximoVencimento)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-[#a1a5b0]">
          &quot;Recorrente&quot; = fornecedor com 2+ títulos na janela (aproximação de despesa fixa/parcelada).
          A Bling tem categoria própria (despesa fixa vs. variável), mas o app conectado ainda não tem esse
          escopo liberado — dá pra habilitar em developer.bling.com.br → app &quot;Fluxo de Caixa MCP&quot; →
          permissões → Categorias de Receitas e Despesas, e reconectar.
        </p>
        {despesas.truncado && (
          <p className="mt-1 text-xs text-amber-600">Lista truncada (muitos títulos na janela) — total pode estar incompleto.</p>
        )}
      </div>
    </div>
  );
}
