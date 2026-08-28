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
  const done = item.status === "concluido";
  const catStyle = CATEGORY_STYLE[item.category];
  const prStyle = PRIORITY_STYLE[item.priority];

  // Semáforo de prazo: a cor de fundo do card avisa de longe se está
  // atrasado, vence hoje, concluído ou no prazo — sem precisar ler o card.
  const urgencyStyle = done
    ? "border-zinc-200 bg-zinc-50"
    : overdue
    ? "border-rose-200 bg-rose-50"
    : dueToday
    ? "border-amber-200 bg-amber-50"
    : "border-[var(--border)] bg-[var(--surface)]";

  return (
    <Draggable draggableId={item.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          onClick={onClick}
          className={`group relative cursor-pointer overflow-hidden rounded-xl border pl-3 pr-3 py-3 shadow-sm transition-shadow hover:shadow-md ${urgencyStyle} ${
            done ? "opacity-70" : ""
          } ${snapshot.isDragging ? "shadow-lg ring-2 ring-indigo-300" : ""}`}
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
                  done
                    ? "bg-zinc-200 text-zinc-500"
                    : overdue
                    ? "bg-rose-200 text-rose-800"
                    : dueToday
                    ? "bg-amber-200 text-amber-800"
                    : "bg-emerald-100 text-emerald-700"
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
