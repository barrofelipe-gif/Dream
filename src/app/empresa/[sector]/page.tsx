import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth";
import { hasSectorAccess } from "@/lib/permissions";
import { getSectorMetrics } from "@/lib/sectorMetrics";
import { SECTORS, Sector } from "@/lib/sectors";
import SectorBlocksClient from "./SectorBlocksClient";

// Blocos previstos por setor (spec). Enquanto não tem fonte automática
// (Tray etc.) ligada, cada bloco é preenchido na mão em SectorMetric —
// ver SectorBlocksClient.
export const SECTOR_BLOCKS: Record<Sector, string[]> = {
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

  const metrics = await getSectorMetrics(meta.value);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/empresa" className="text-sm text-zinc-500 hover:text-zinc-700">
        ← Mapa da Empresa
      </Link>
      <h1 className="mt-1 text-xl font-semibold text-zinc-900">{meta.label}</h1>
      <p className="mt-1 text-sm text-zinc-500">{meta.description}</p>

      <SectorBlocksClient sector={meta.value} blocks={SECTOR_BLOCKS[meta.value]} initialMetrics={metrics} />
    </div>
  );
}
