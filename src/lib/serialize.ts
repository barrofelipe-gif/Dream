import { Item } from "@prisma/client";

// Include padrão pra toda query de Item que depois passa por serializeItem.
export const itemInclude = {
  column: { select: { isDone: true } },
  assignedBy: { select: { name: true } },
} as const;

type ItemWithRelations = Item & {
  column: { isDone: boolean };
  assignedBy: { name: string } | null;
};

// Achata column.isDone em columnIsDone e assignedBy.name em assignedByName
// pra o cliente não precisar de joins extras.
export function serializeItem(item: ItemWithRelations) {
  const { column, assignedBy, ...rest } = item;
  return { ...rest, columnIsDone: column.isDone, assignedByName: assignedBy?.name ?? null };
}
