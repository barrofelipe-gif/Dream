"use client";

import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { ItemDTO, Status, STATUSES } from "@/lib/types";
import ItemCard from "@/components/ItemCard";
import { IconPlus } from "@/components/icons";

interface BoardProps {
  items: ItemDTO[];
  showCategoryChip: boolean;
  onOpenItem: (item: ItemDTO) => void;
  onAddItem: (status: Status) => void;
  onMoveItem: (itemId: string, newStatus: Status) => void;
}

export default function Board({ items, showCategoryChip, onOpenItem, onAddItem, onMoveItem }: BoardProps) {
  function handleDragEnd(result: DropResult) {
    const { destination, draggableId } = result;
    if (!destination) return;
    const newStatus = destination.droppableId as Status;
    onMoveItem(draggableId, newStatus);
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="grid flex-1 grid-cols-1 gap-4 overflow-x-auto pb-4 sm:grid-cols-3">
        {STATUSES.map((col) => {
          const colItems = items.filter((i) => i.status === col.value);
          return (
            <div key={col.value} className="flex min-h-0 flex-col rounded-xl bg-black/[.03]">
              <div className="flex items-center justify-between px-3 pb-2 pt-3">
                <h3 className="text-sm font-semibold text-zinc-700">{col.label}</h3>
                <span className="rounded-full bg-black/5 px-2 py-0.5 text-xs text-zinc-500">
                  {colItems.length}
                </span>
              </div>

              <Droppable droppableId={col.value}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`board-column flex-1 space-y-2 overflow-y-auto px-3 pb-2 transition-colors ${
                      snapshot.isDraggingOver ? "bg-indigo-50/60" : ""
                    }`}
                    style={{ minHeight: 120 }}
                  >
                    {colItems.map((item, index) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        index={index}
                        showCategoryChip={showCategoryChip}
                        onClick={() => onOpenItem(item)}
                      />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              <button
                onClick={() => onAddItem(col.value)}
                className="mx-3 mb-3 mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-700"
              >
                <IconPlus className="h-3.5 w-3.5" />
                Adicionar
              </button>
            </div>
          );
        })}
      </div>
    </DragDropContext>
  );
}
