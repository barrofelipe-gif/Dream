"use client";

import { useState } from "react";
import { DragDropContext, Droppable, DropResult } from "@hello-pangea/dnd";
import { ColumnDTO, ItemDTO } from "@/lib/types";
import ItemCard from "@/components/ItemCard";
import { IconPlus, IconClose, IconChevronLeft, IconChevronRight } from "@/components/icons";

interface BoardProps {
  items: ItemDTO[];
  columns: ColumnDTO[];
  readOnly?: boolean;
  showCategoryChip: boolean;
  onOpenItem: (item: ItemDTO) => void;
  onAddItem: (columnId: string) => void;
  onMoveItem: (itemId: string, columnId: string) => void;
  onAddColumn?: (name: string) => void;
  onRenameColumn?: (columnId: string, name: string) => void;
  onDeleteColumn?: (columnId: string) => void;
  onMoveColumn?: (columnId: string, direction: "left" | "right") => void;
}

export default function Board({
  items,
  columns,
  readOnly,
  showCategoryChip,
  onOpenItem,
  onAddItem,
  onMoveItem,
  onAddColumn,
  onRenameColumn,
  onDeleteColumn,
  onMoveColumn,
}: BoardProps) {
  const [addingColumn, setAddingColumn] = useState(false);
  const [newColumnName, setNewColumnName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  function handleDragEnd(result: DropResult) {
    const { destination, draggableId } = result;
    if (!destination) return;
    onMoveItem(draggableId, destination.droppableId);
  }

  function submitNewColumn() {
    const name = newColumnName.trim();
    if (name) onAddColumn?.(name);
    setNewColumnName("");
    setAddingColumn(false);
  }

  function submitRename(columnId: string) {
    const name = renameValue.trim();
    if (name) onRenameColumn?.(columnId, name);
    setRenamingId(null);
  }

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex flex-1 gap-4 overflow-x-auto pb-4">
        {columns.map((col, index) => {
          const colItems = items.filter((i) => i.columnId === col.id);
          const isRenaming = renamingId === col.id;

          return (
            <div
              key={col.id}
              className="flex min-h-0 w-72 shrink-0 flex-col rounded-xl bg-black/[.03]"
            >
              <div className="flex items-center justify-between gap-1 px-3 pb-2 pt-3">
                {isRenaming ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => submitRename(col.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitRename(col.id);
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    className="min-w-0 flex-1 rounded-md border border-indigo-300 px-1.5 py-0.5 text-sm font-semibold text-zinc-700 outline-none"
                  />
                ) : (
                  <h3
                    onClick={() => {
                      if (readOnly) return;
                      setRenamingId(col.id);
                      setRenameValue(col.name);
                    }}
                    title={readOnly ? undefined : "Clique pra renomear"}
                    className={`min-w-0 flex-1 truncate text-sm font-semibold text-zinc-700 ${
                      readOnly ? "" : "cursor-text hover:underline"
                    }`}
                  >
                    {col.name}
                  </h3>
                )}

                <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-xs text-zinc-500">
                  {colItems.length}
                </span>

                {!readOnly && (
                  <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 has-[:hover]:opacity-100">
                    <button
                      onClick={() => onMoveColumn?.(col.id, "left")}
                      disabled={index === 0}
                      title="Mover coluna pra esquerda"
                      className="rounded p-0.5 text-zinc-400 hover:bg-black/5 hover:text-zinc-600 disabled:opacity-0"
                    >
                      <IconChevronLeft className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onMoveColumn?.(col.id, "right")}
                      disabled={index === columns.length - 1}
                      title="Mover coluna pra direita"
                      className="rounded p-0.5 text-zinc-400 hover:bg-black/5 hover:text-zinc-600 disabled:opacity-0"
                    >
                      <IconChevronRight className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => onDeleteColumn?.(col.id)}
                      title="Excluir coluna"
                      className="rounded p-0.5 text-zinc-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <IconClose className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
              </div>

              <Droppable droppableId={col.id} isDropDisabled={readOnly}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.droppableProps}
                    className={`board-column flex-1 space-y-2 overflow-y-auto px-3 pb-2 transition-colors ${
                      snapshot.isDraggingOver ? "bg-indigo-50/60" : ""
                    }`}
                    style={{ minHeight: 120 }}
                  >
                    {colItems.map((item, itemIndex) => (
                      <ItemCard
                        key={item.id}
                        item={item}
                        index={itemIndex}
                        showCategoryChip={showCategoryChip}
                        onClick={() => onOpenItem(item)}
                      />
                    ))}
                    {provided.placeholder}
                  </div>
                )}
              </Droppable>

              {!readOnly && (
                <button
                  onClick={() => onAddItem(col.id)}
                  className="mx-3 mb-3 mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-700"
                >
                  <IconPlus className="h-3.5 w-3.5" />
                  Adicionar
                </button>
              )}
            </div>
          );
        })}

        {!readOnly && onAddColumn && (
          <div className="w-72 shrink-0">
            {addingColumn ? (
              <div className="rounded-xl bg-black/[.03] p-2">
                <input
                  autoFocus
                  value={newColumnName}
                  onChange={(e) => setNewColumnName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitNewColumn();
                    if (e.key === "Escape") setAddingColumn(false);
                  }}
                  placeholder="Nome da coluna"
                  className="w-full rounded-lg border border-zinc-300 px-2.5 py-1.5 text-sm outline-none focus:border-indigo-500"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={submitNewColumn}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                  >
                    Adicionar
                  </button>
                  <button
                    onClick={() => setAddingColumn(false)}
                    className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-black/5"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setAddingColumn(true)}
                className="flex w-full items-center gap-1.5 rounded-xl px-3 py-2.5 text-sm font-medium text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-700"
              >
                <IconPlus className="h-4 w-4" />
                Nova coluna
              </button>
            )}
          </div>
        )}
      </div>
    </DragDropContext>
  );
}
