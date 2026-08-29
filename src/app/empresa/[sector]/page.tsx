import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasSectorAccess } from "@/lib/permissions";
import { SECTORS, Sector } from "@/lib/sectors";

// Blocos previstos por setor (spec) — placeholders até cada fonte de dado
// (Solomon/Tray, e-mail da BFF, planilha etc.) ser conectada.
const SECTOR_BLOCKS: Record<Sector, string[]> = {
  financeiro: [
    "Fluxo de caixa (saldo + projeção 7/30/60 dias)",
    "DRE resumida",
    "Balanço",
    "Taxa de cartão/adquirente",
    "Margem/CMV por produto",
    "Chargebacks",
    "Contas a pagar / fornecedores",
  ],
  marketing_vendas: [
    "Meta vs. realizado",
    "Verba e retorno (ROAS/CPA)",
    "CAC",
    "Funil (sessões → pedido aprovado)",
    "Esteira de criativos",
  ],
  estoque: [
    "Curva ABC e giro",
    "Quantidade a produzir por SKU",
    "Prioridade teste vs. reposição",
    "Produção (fábrica Vila Velha)",
    "Fornecedores/insumos",
  ],
  logistica: ["Mapa de frete por estado", "Prazo de entrega"],
  clientes: ["Recência/recorrência (RFM simplificado)", "Ticket médio", "Filtro clicável por status de recência"],
  suporte: ["Volume de reclamações por tipo", "Reputação externa (Reclame Aqui, Google Meu Negócio)"],
  juridico: [
    "Processos e disputas ativas da BFF",
    "Notificações extrajudiciais em andamento",
    "PROCON/Consumidor.gov com prazo correndo",
  ],
  desenvolvimento_produto: [
    "Em desenvolvimento",
    "Em teste",
    "Validados vs. reprovados",
    "Resultado por produto validado",
    "Variações para escalar",
  ],
};

export default async function SectorPage({ params }: { params: Promise<{ sector: string }> }) {
  const { sector: raw } = await params;
  const meta = SECTORS.find((s) => s.value === raw);
  if (!meta) notFound();

  const session = await auth();
  if (!session?.user) redirect("/login");

  const allowed = await hasSectorAccess(session.user.id, session.user.role, meta.value);
  if (!allowed) redirect("/empresa");

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/empresa" className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Mapa da Empresa
      </Link>
      <h1 className="mt-1 text-xl font-semibold text-zinc-900">{meta.label}</h1>
      <p className="mt-1 text-sm text-zinc-500">{meta.description}</p>

      <div className="mt-6 space-y-2">
        {SECTOR_BLOCKS[meta.value].map((block) => (
          <div
            key={block}
            className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
          >
            <span className="text-sm text-zinc-700">{block}</span>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
              Sem dados ainda
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
