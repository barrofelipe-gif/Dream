import { Item } from "@prisma/client";

type ItemWithColumn = Item & { column: { isDone: boolean } };

// Achata column.isDone em columnIsDone pra o cliente não precisar de um
// segundo fetch/join só pra saber se o item está numa coluna "concluída".
export function serializeItem(item: ItemWithColumn) {
  const { column, ...rest } = item;
  return { ...rest, columnIsDone: column.isDone };
}
