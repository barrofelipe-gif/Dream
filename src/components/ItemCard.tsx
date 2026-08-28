"use client";

import { Draggable } from "@hello-pangea/dnd";
import { ItemDTO } from "@/lib/types";
import { CATEGORY_STYLE, PRIORITY_STYLE } from "@/lib/style";
import { isOverdue, isDueToday, formatDue } from "@/lib/dates";
import { IconMail } from "@/components/icons";

interface ItemCardProps {
  item: ItemDTO;
  index: number;
  showCategoryChip: boolean;
  onClick: () => void;
}

export default function ItemCard({ item, index, showCategoryChip, onClick }: ItemCardProps) {
  const overdue = isOverdue(item.due, item.status);
  const dueToday = isDueToday(item.due, item.status);
  const catStyle = CATEGORY_STYLE[item.category];
  const prStyle = PRIORITY_STYLE[item.priority];

  return (
    <Draggable draggableId={item.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={`group relative cursor-pointer overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] pl-3 pr-3 py-3 shadow-sm transition-shadow hover:shadow-md ${
            snapshot.isDragging ? "shadow-lg ring-2 ring-indigo-300" : ""
          }`}
        >
          <span className={`absolute left-0 top-0 h-full w-1 ${prStyle.bar}`} aria-hidden />

          <div className="mb-1.5 flex items-center gap-1.5">
            {showCategoryChip && (
              <span
                className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${catStyle.chip}`}
              >
                {catStyle.label}
              </span>
            )}
            {item.source === "gmail" && (
              <span title="Importado do Gmail" className="text-zinc-400">
                <IconMail className="h-3 w-3" />
              </span>
            )}
          </div>

          <p className="text-sm font-medium leading-snug text-zinc-900">{item.title}</p>

          {item.detail && (
            <p className="mt-1 line-clamp-2 text-xs text-zinc-500">{item.detail}</p>
          )}

          {(item.company || item.processNumber) && (
            <p className="mt-1 truncate text-xs text-zinc-400">
              {[item.company, item.processNumber].filter(Boolean).join(" · ")}
            </p>
          )}

          <div className="mt-2 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[11px] text-zinc-400">
              <span className={`h-1.5 w-1.5 rounded-full ${prStyle.dot}`} />
              {prStyle.label}
            </span>

            {item.due && (
              <span
                className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  overdue
                    ? "bg-rose-100 text-rose-700"
                    : dueToday
                    ? "bg-amber-100 text-amber-700"
                    : "bg-zinc-100 text-zinc-500"
                }`}
              >
                {overdue ? "Atrasado" : dueToday ? "Vence hoje" : formatDue(item.due)}
              </span>
            )}
          </div>
        </div>
      )}
    </Draggable>
  );
}
