import Link from "next/link";
import { chamarFerramentaBling, isBlingConectado, janelaDeDias } from "@/lib/blingMcp";

/**
 * Seção de Contas a Pagar/Receber (Bling) dentro de Finanças — reaproveita
 * o bling-mcp-server já existente (https://bling-mcp-server.vercel.app),
 * conectado por um clique como mais um "cliente" OAuth desse servidor,
 * sem duplicar a autorização com a Bling.
 */

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const dataBR = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

interface BucketFluxo {
  data: string;
  entradas: number;
  saidas: number;
  saldoAcumulado: number;
}
interface FluxoCaixaBling {
  periodo: { dataInicial: string; dataFinal: string };
  saldoInicial: number;
  buckets: BucketFluxo[];
  totalEntradas: number;
  totalSaidas: number;
  saldoFinalProjetado: number;
  truncado: boolean;
}

export default async function BlingSection({
  status,
}: {
  status?: "ok" | "erro";
}) {
  const conectado = await isBlingConectado();

  if (!conectado) {
    return (
      <div className="rounded-2xl border-2 border-indigo-200 bg-indigo-50/60 p-5 text-center shadow-sm">
        <p className="text-base font-semibold text-[#1b1f2b]">📋 Contas a pagar / receber (Bling)</p>
        <p className="mt-1 text-sm text-[#5a5f6d]">
          Conecta o Bling (atacado/B2B) pra ver a projeção de caixa junto com o resto de Finanças.
        </p>
        {status === "erro" && (
          <p className="mt-2 text-xs text-rose-600">Não deu pra conectar — tenta de novo.</p>
        )}
        <a
          href="/api/bling/connect"
          className="mt-4 inline-flex items-center rounded-full bg-[#1b1f2b] px-5 py-2 text-sm font-medium text-white hover:bg-[#2a3040]"
        >
          Conectar Bling
        </a>
      </div>
    );
  }

  const { hoje, fim: em30dias } = janelaDeDias(30);

  let fluxo: FluxoCaixaBling | null = null;
  let erro: string | null = null;
  try {
    fluxo = await chamarFerramentaBling<FluxoCaixaBling>("bling_fluxo_caixa", {
      dataInicial: hoje,
      dataFinal: em30dias,
      granularidade: "semana",
    });
  } catch (e) {
    erro = e instanceof Error ? e.message : "Erro desconhecido";
  }

  return (
    <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-[#1b1f2b]">Contas a pagar / receber (Bling) — projeção 30 dias</p>
        <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
          Bling conectado
        </span>
      </div>

      {status === "ok" && (
        <p className="mb-3 text-xs text-emerald-700">Bling conectado agora com sucesso.</p>
      )}

      {erro && (
        <p className="text-sm text-rose-600">
          Não consegui puxar a projeção agora: {erro}. A conexão com o Bling continua ativa, tenta recarregar a página.
        </p>
      )}

      {fluxo && (
        <>
          <p className="mb-3 text-[11px] text-[#a1a5b0]">
            Isso NÃO é saldo bancário real — é a soma de títulos em aberto (contas a pagar e a receber) com
            vencimento entre {dataBR(fluxo.periodo.dataInicial)} e {dataBR(fluxo.periodo.dataFinal)}.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="min-w-0">
              <p className="text-xs text-[#8a8f9c]">A receber no período</p>
              <p className="truncate text-lg font-semibold text-emerald-700">{brl(fluxo.totalEntradas)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[#8a8f9c]">A pagar no período</p>
              <p className="truncate text-lg font-semibold text-rose-700">{brl(fluxo.totalSaidas)}</p>
            </div>
            <div className="min-w-0">
              <p className="text-xs text-[#8a8f9c]">Saldo projetado</p>
              <p
                className={`truncate text-lg font-semibold ${fluxo.saldoFinalProjetado < 0 ? "text-rose-700" : "text-[#1b1f2b]"}`}
              >
                {brl(fluxo.saldoFinalProjetado)}
              </p>
            </div>
          </div>

          {fluxo.buckets.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="font-mono text-[10px] uppercase tracking-wide text-[#a1a5b0]">
                  <tr>
                    <th className="py-2 pr-4">Semana</th>
                    <th className="py-2 pr-4">Entradas</th>
                    <th className="py-2 pr-4">Saídas</th>
                    <th className="py-2">Saldo acumulado</th>
                  </tr>
                </thead>
                <tbody>
                  {fluxo.buckets.map((b) => (
                    <tr key={b.data} className="border-t border-[#eef0f4]">
                      <td className="py-2 pr-4">{dataBR(b.data)}</td>
                      <td className="py-2 pr-4 text-emerald-700">{brl(b.entradas)}</td>
                      <td className="py-2 pr-4 text-rose-700">{brl(b.saidas)}</td>
                      <td className={`py-2 font-medium ${b.saldoAcumulado < 0 ? "text-rose-700" : "text-[#1b1f2b]"}`}>
                        {brl(b.saldoAcumulado)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {fluxo.truncado && (
            <p className="mt-2 text-xs text-amber-600">
              Período com muitos títulos — a projeção pode estar incompleta (a ferramenta buscou só as primeiras páginas).
            </p>
          )}
        </>
      )}

      <Link href="/api/bling/connect" className="mt-4 inline-block text-xs text-[#8a8f9c] hover:text-[#5a5f6d]">
        Reconectar Bling
      </Link>
    </div>
  );
}
