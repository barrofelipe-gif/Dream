import { Category } from "@prisma/client";
import { prisma } from "@/lib/prisma";

const DEFAULT_COLUMN_NAMES = ["Pendente", "Em andamento", "Concluído"];

/**
 * Garante que a categoria já tem colunas. Se for a primeira vez que o
 * usuário abre essa categoria, cria as 3 colunas padrão (a última marcada
 * como isDone). Depois disso o usuário pode renomear/adicionar/remover à
 * vontade — essa função nunca recria as padrão se já existir qualquer
 * coluna pra essa categoria.
 */
export async function ensureDefaultColumns(ownerId: string, category: Category) {
  const existing = await prisma.column.findMany({
    where: { ownerId, category },
    orderBy: { order: "asc" },
  });
  if (existing.length > 0) return existing;

  await prisma.column.createMany({
    data: DEFAULT_COLUMN_NAMES.map((name, i) => ({
      ownerId,
      category,
      name,
      order: i,
      isDone: i === DEFAULT_COLUMN_NAMES.length - 1,
    })),
  });

  return prisma.column.findMany({ where: { ownerId, category }, orderBy: { order: "asc" } });
}
