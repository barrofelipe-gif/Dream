export type Sector =
  | "financeiro"
  | "marketing_vendas"
  | "estoque_logistica"
  | "clientes"
  | "suporte"
  | "juridico"
  | "desenvolvimento_produto";

export const SECTORS: { value: Sector; label: string; description: string }[] = [
  { value: "financeiro", label: "Financeiro", description: "Fluxo de caixa, DRE, margem, chargebacks, contas a pagar" },
  { value: "marketing_vendas", label: "Marketing/Vendas", description: "Meta vs. realizado, verba e retorno, CAC, funil" },
  { value: "estoque_logistica", label: "Estoque/Logística", description: "Curva ABC, giro, produção, fornecedores, frete" },
  { value: "clientes", label: "Clientes", description: "Recência/recorrência, ticket médio, saúde da base" },
  { value: "suporte", label: "Suporte/Reclamações", description: "E-mails de reclamação, reputação externa" },
  { value: "juridico", label: "Jurídico", description: "Processos e disputas da BFF como empresa" },
  { value: "desenvolvimento_produto", label: "Desenvolvimento de Produto", description: "Funil de produto: desenvolvimento → teste → validação → escala" },
];

export function sectorLabel(sector: Sector): string {
  return SECTORS.find((s) => s.value === sector)?.label ?? sector;
}
