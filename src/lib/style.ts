import { Category, Priority } from "@/lib/types";
import { IconFolder, IconBuilding, IconMail, IconPlane, IconLayers } from "@/components/icons";

export const CATEGORY_STYLE: Record<
  Category,
  { label: string; icon: typeof IconFolder; accent: string; chip: string }
> = {
  processos: {
    label: "Processos",
    icon: IconFolder,
    accent: "#6366f1", // indigo
    chip: "bg-indigo-50 text-indigo-700 border-indigo-200",
  },
  bff: {
    label: "Empresa BFF",
    icon: IconBuilding,
    accent: "#8b5cf6", // violet
    chip: "bg-violet-50 text-violet-700 border-violet-200",
  },
  emails: {
    label: "E-mails",
    icon: IconMail,
    accent: "#0ea5e9", // sky
    chip: "bg-sky-50 text-sky-700 border-sky-200",
  },
  viagens: {
    label: "Viagens",
    icon: IconPlane,
    accent: "#14b8a6", // teal
    chip: "bg-teal-50 text-teal-700 border-teal-200",
  },
};

export const ALL_CATEGORY_STYLE = {
  label: "Todas as categorias",
  icon: IconLayers,
  accent: "#71717a",
};

export const PRIORITY_STYLE: Record<Priority, { label: string; bar: string; dot: string }> = {
  alta: { label: "Alta", bar: "bg-rose-500", dot: "bg-rose-500" },
  media: { label: "Média", bar: "bg-amber-500", dot: "bg-amber-500" },
  baixa: { label: "Baixa", bar: "bg-emerald-500", dot: "bg-emerald-500" },
};
