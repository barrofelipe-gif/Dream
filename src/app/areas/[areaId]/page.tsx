import Link from "next/link";
import { notFound } from "next/navigation";
import { getArea } from "@/lib/orgCatalog";
import { gerarDashboardDemo, MESES_GRAFICO } from "@/lib/orgMockData";
import { Icon } from "@/components/hub/Icon";
import FinancasDashboard from "@/components/hub/FinancasDashboard";

/**
 * Dashboard interno da área — linguagem visual da imagem de referência do
 * handoff (cards arredondados, KPIs, gráfico, projetos/tarefas/mensagens).
 *
 * Todo número aqui é demonstração (ver src/lib/orgMockData.ts) e a tela diz
 * isso explicitamente — o problema encontrado no protótipo original foi
 * métrica fixa parecendo real sem aviso nenhum. ÚNICA EXCEÇÃO: Finanças, que
 * já usa dado real da Tray (ver FinancasDashboard.tsx) — primeira área
 * conectada, as outras 6 seguem mock até serem priorizadas.
 */
export default async function AreaDashboardPage({
  params,
}: {
  params: Promise<{ areaId: string }>;
}) {
  const { areaId } = await params;
  const area = getArea(areaId);
  if (!area) notFound();

  if (areaId === "financas") {
    return <FinancasDashboard />;
  }

  const demo = gerarDashboardDemo(area);
  const maxProgresso = Math.max(...demo.progresso, 1);

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[#1b1f2b]">{area.name}</h1>
          <p className="mt-1 text-sm text-[#5a5f6d]">{area.focoDashboard}</p>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
          Dados de demonstração — ainda não conectado a uma fonte real
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {demo.kpis.map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-[#e3e5ea] bg-white p-4 shadow-sm">
            <p className="text-xs text-[#8a8f9c]">{kpi.label}</p>
            <p className="mt-1.5 text-2xl font-semibold text-[#1b1f2b]">{kpi.valor}</p>
            {kpi.variacao && (
              <p
                className={`mt-1 text-xs font-medium ${kpi.variacao.startsWith("-") ? "text-rose-600" : "text-emerald-600"}`}
              >
                {kpi.variacao} em relação ao mês passado
              </p>
            )}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm lg:col-span-2">
          <p className="text-sm font-medium text-[#1b1f2b]">Progresso — últimos 6 meses</p>
          <div className="mt-4 flex h-40 gap-3">
            {demo.progresso.map((v, i) => (
              // h-full aqui é o que faz a altura em % da barra abaixo
              // resolver contra um valor real — sem isso o pai fica com
              // altura automática (do conteúdo) e a % sempre vira 0.
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <div
                  className="w-full rounded-t-md bg-[#6366f1]/80"
                  style={{ height: `${(v / maxProgresso) * 100}%` }}
                />
                <span className="text-[10px] text-[#a1a5b0]">{MESES_GRAFICO[i]}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-[#1b1f2b]">Ferramentas da área</p>
          <ul className="mt-3 space-y-2">
            {area.tools.map((tool) => (
              <li key={tool} className="flex items-center gap-2 text-sm text-[#5a5f6d]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#6366f1]" />
                {tool}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-medium text-[#1b1f2b]">Projetos recentes</p>
          </div>
          <ul className="divide-y divide-[#eef0f4]">
            {demo.projetos.map((p) => (
              <li key={p.nome} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-medium text-[#1b1f2b]">{p.nome}</p>
                  <p className="text-xs text-[#8a8f9c]">{p.cliente}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      p.status === "Concluído"
                        ? "bg-emerald-50 text-emerald-700"
                        : p.status === "Em revisão"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-indigo-50 text-indigo-700"
                    }`}
                  >
                    {p.status}
                  </span>
                  <span className="text-xs text-[#a1a5b0]">{p.atualizado}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm font-medium text-[#1b1f2b]">Tarefas de hoje</p>
            <ul className="space-y-2.5">
              {demo.tarefas.map((t) => (
                <li key={t.titulo} className="flex items-center gap-2.5 text-sm">
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      t.feita ? "border-emerald-500 bg-emerald-500 text-white" : "border-[#c7cad1]"
                    }`}
                  >
                    {t.feita && <Icon name="check" size={10} />}
                  </span>
                  <span className={t.feita ? "text-[#a1a5b0] line-through" : "text-[#1b1f2b]"}>{t.titulo}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm font-medium text-[#1b1f2b]">Mensagens recentes</p>
            <ul className="space-y-3">
              {demo.mensagens.map((m) => (
                <li key={m.nome} className="text-sm">
                  <p className="font-medium text-[#1b1f2b]">{m.nome}</p>
                  <p className="text-xs text-[#8a8f9c]">{m.resumo}</p>
                  <p className="text-[10px] text-[#c7cad1]">{m.quando}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div>
        <p className="mb-3 text-sm font-medium text-[#1b1f2b]">Papéis desta área</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {area.children.map((papel) => (
            <Link
              key={papel.id}
              href={`/areas/${area.id}/papeis/${papel.id}`}
              className="rounded-xl border border-[#e3e5ea] bg-white p-4 text-sm shadow-sm transition hover:border-[#c7cad1] hover:shadow"
            >
              <div className="mb-2 flex items-center gap-2">
                <Icon name={papel.icon} size={16} className="text-[#6366f1]" />
                <span className="font-medium text-[#1b1f2b]">{papel.title}</span>
              </div>
              <span className="rounded-full border border-[#e3e5ea] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[#8a8f9c]">
                {papel.type}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
