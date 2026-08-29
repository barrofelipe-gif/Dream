import {
  IconChartBar,
  IconTrendingUp,
  IconBox,
  IconTruck,
  IconUsers,
  IconHeadset,
  IconScale,
  IconFlask,
} from "@/components/icons";

export type Sector =
  | "financeiro"
  | "marketing_vendas"
  | "estoque"
  | "logistica"
  | "clientes"
  | "suporte"
  | "juridico"
  | "desenvolvimento_produto";

export const SECTORS: { value: Sector; label: string; description: string; icon: typeof IconChartBar }[] = [
  { value: "financeiro", label: "Financeiro", description: "Fluxo de caixa, DRE, margem, chargebacks, contas a pagar", icon: IconChartBar },
  { value: "marketing_vendas", label: "Marketing/Vendas", description: "Meta vs. realizado, verba e retorno, CAC, funil", icon: IconTrendingUp },
  { value: "estoque", label: "Estoque", description: "Curva ABC, giro, produção, fornecedores/insumos", icon: IconBox },
  { value: "logistica", label: "Logística", description: "Frete por estado, prazo de entrega", icon: IconTruck },
  { value: "clientes", label: "Clientes", description: "Recência/recorrência, ticket médio, saúde da base", icon: IconUsers },
  { value: "suporte", label: "Suporte e Pós-venda", description: "E-mails de reclamação, reputação externa", icon: IconHeadset },
  { value: "juridico", label: "Jurídico", description: "Processos e disputas da BFF como empresa", icon: IconScale },
  { value: "desenvolvimento_produto", label: "Desenvolvimento de Produto", description: "Funil de produto: desenvolvimento → teste → validação → escala", icon: IconFlask },
];

export function sectorLabel(sector: Sector): string {
  return SECTORS.find((s) => s.value === sector)?.label ?? sector;
}
