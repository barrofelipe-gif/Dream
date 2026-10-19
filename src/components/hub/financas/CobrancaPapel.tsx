import { buscarContasReceberAbertas, isBlingConectado } from "@/lib/blingMcp";

/** Conteúdo real do papel "Cobrança" — contas a receber em aberto no Bling, separadas em atrasadas (inadimplência) e a vencer. */

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

export default async function CobrancaPapel() {
  const conectado = await isBlingConectado();
  if (!conectado) {
    return (
      <div className="rounded-xl border border-dashed border-[#e3e5ea] bg-[#f9fafb] p-4 text-sm text-[#8a8f9c]">
        Conecta o Bling em Finanças pra ver as contas a receber em aberto aqui.
      </div>
    );
  }

  const receber = await buscarContasReceberAbertas(30);
  const atrasadas = receber.itens.filter((i) => i.atrasada);
  const aVencer = receber.itens.filter((i) => !i.atrasada);

  return (
    <div className="mt-5 space-y-5">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 rounded-xl border border-rose-200 bg-rose-50/60 p-4">
          <p className="text-xs text-rose-700">Atrasado (inadimplência, últimos 90d)</p>
          <p className="mt-1 truncate text-xl font-semibold text-rose-700">{brl(receber.totalAtrasado)}</p>
          <p className="mt-1 text-xs text-rose-600">{atrasadas.length} título(s)</p>
        </div>
        <div className="min-w-0 rounded-xl border border-[#e3e5ea] bg-white p-4">
          <p className="text-xs text-[#8a8f9c]">A vencer (próximos 30d)</p>
          <p className="mt-1 truncate text-xl font-semibold text-[#1b1f2b]">{brl(receber.totalAVencer)}</p>
          <p className="mt-1 text-xs text-[#5a5f6d]">{aVencer.length} título(s)</p>
        </div>
      </div>

      {atrasadas.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-rose-700">
            Régua de cobrança — atrasados primeiro
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-sm">
              <thead className="font-mono text-[10px] uppercase tracking-wide text-[#a1a5b0]">
                <tr>
                  <th className="py-2 pr-4">Cliente</th>
                  <th className="py-2 pr-4">Vencido em</th>
                  <th className="py-2">Valor</th>
                </tr>
              </thead>
              <tbody>
                {atrasadas.slice(0, 20).map((i, idx) => (
                  <tr key={`${i.nome}-${i.vencimento}-${idx}`} className="border-t border-[#eef0f4]">
                    <td className="py-2 pr-4">{i.nome}</td>
                    <td className="py-2 pr-4 text-rose-700">{dataBR(i.vencimento)}</td>
                    <td className="py-2 font-medium">{brl(i.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {atrasadas.length === 0 && <p className="text-sm text-emerald-700">Nenhum título atrasado nos últimos 90 dias. 🎉</p>}

      {receber.truncado && (
        <p className="text-xs text-amber-600">Lista truncada (muitos títulos na janela) — total pode estar incompleto.</p>
      )}
    </div>
  );
}
