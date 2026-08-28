export type Category = "processos" | "bff" | "emails" | "viagens";
export type BffSub = "financeiro" | "fornecedor" | "produto" | "outro";
export type Priority = "alta" | "media" | "baixa";
export type Status = "pendente" | "andamento" | "concluido";
export type Recurring = "none" | "daily" | "weekly" | "monthly";
export type Source = "manual" | "gmail";

export interface ItemDTO {
  id: string;
  category: Category;
  bffSub: BffSub | null;
  title: string;
  detail: string | null;
  company: string | null;
  lawyer: string | null;
  processNumber: string | null;
  lastMovement: string | null;
  due: string | null; // ISO
  priority: Priority;
  status: Status;
  recurring: Recurring;
  source: Source;
  sourceRef: string | null;
  updatedAt: string;
  createdAt: string;
}

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "processos", label: "Processos" },
  { value: "bff", label: "Empresa BFF" },
  { value: "emails", label: "E-mails" },
  { value: "viagens", label: "Viagens" },
];

export const BFF_SUBS: { value: BffSub; label: string }[] = [
  { value: "financeiro", label: "Financeiro" },
  { value: "fornecedor", label: "Fornecedor" },
  { value: "produto", label: "Produto" },
  { value: "outro", label: "Outro" },
];

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: "alta", label: "Alta" },
  { value: "media", label: "Média" },
  { value: "baixa", label: "Baixa" },
];

export const STATUSES: { value: Status; label: string }[] = [
  { value: "pendente", label: "Pendente" },
  { value: "andamento", label: "Em andamento" },
  { value: "concluido", label: "Concluído" },
];

export const RECURRING_OPTIONS: { value: Recurring; label: string }[] = [
  { value: "none", label: "Não repete" },
  { value: "daily", label: "Diariamente" },
  { value: "weekly", label: "Semanalmente" },
  { value: "monthly", label: "Mensalmente" },
];
