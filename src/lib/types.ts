export type Category = "processos" | "bff" | "emails" | "viagens";
export type BffSub = "financeiro" | "fornecedor" | "produto" | "outro";
export type Priority = "alta" | "media" | "baixa";
export type Recurring = "none" | "daily" | "weekly" | "monthly";
export type Source = "manual" | "gmail";

// Rascunho de pendência extraído de um ditado por voz (ver src/lib/anthropic.ts).
// Fica em types.ts (sem dependências de runtime) pra poder ser importado em
// componentes de cliente sem puxar o SDK da Anthropic pro bundle do navegador.
export interface VoiceDraft {
  title: string;
  category: Category;
  bffSub: BffSub | null;
  detail: string | null;
  company: string | null;
  processNumber: string | null;
  due: string | null;
  priority: Priority;
}

export interface ColumnDTO {
  id: string;
  category: Category;
  name: string;
  order: number;
  isDone: boolean;
}

export interface ItemDTO {
  id: string;
  ownerId: string;
  category: Category;
  bffSub: BffSub | null;
  columnId: string;
  columnIsDone: boolean; // achatado do Column.isDone pra evitar um join no cliente
  title: string;
  detail: string | null;
  company: string | null;
  lawyer: string | null;
  processNumber: string | null;
  lastMovement: string | null;
  due: string | null; // ISO
  priority: Priority;
  recurring: Recurring;
  source: Source;
  sourceRef: string | null;
  assignedById: string | null;
  assignedByName: string | null; // achatado, pra mostrar "Enviado por X" sem join no cliente
  completedAt: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface UserOption {
  id: string;
  name: string;
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

export const RECURRING_OPTIONS: { value: Recurring; label: string }[] = [
  { value: "none", label: "Não repete" },
  { value: "daily", label: "Diariamente" },
  { value: "weekly", label: "Semanalmente" },
  { value: "monthly", label: "Mensalmente" },
];
