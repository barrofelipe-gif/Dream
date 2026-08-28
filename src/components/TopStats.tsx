"use client";

import { ItemDTO } from "@/lib/types";
import { isOverdue, isDueToday, isWithinNextDays } from "@/lib/dates";

export type StatFilter = "todas" | "hoje" | "atrasados" | "proximos7";

interface TopStatsProps {
  items: ItemDTO[];
  active: StatFilter;
  onSelect: (f: StatFilter) => void;
}

export default function TopStats({ items, active, onSelect }: TopStatsProps) {
  const open = items.filter((i) => !i.columnIsDone);
  const overdue = open.filter((i) => isOverdue(i.due, i.columnIsDone)).length;
  const today = open.filter((i) => isDueToday(i.due, i.columnIsDone)).length;
  const next7 = open.filter((i) => isWithinNextDays(i.due, i.columnIsDone, 7)).length;

  const pills: { key: StatFilter; label: string; count: number; tone: string }[] = [
    { key: "atrasados", label: "Atrasados", count: overdue, tone: "text-rose-700 bg-rose-50 border-rose-200" },
    { key: "hoje", label: "Vencem hoje", count: today, tone: "text-amber-700 bg-amber-50 border-amber-200" },
    {
      key: "proximos7",
      label: "Próximos 7 dias",
      count: next7,
      tone: "text-sky-700 bg-sky-50 border-sky-200",
    },
  ];

  return (
    <div className="flex flex-wrap gap-2">
      {pills.map((p) => {
        const isActive = active === p.key;
        return (
          <button
            key={p.key}
            onClick={() => onSelect(isActive ? "todas" : p.key)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition-all ${p.tone} ${
              isActive ? "ring-2 ring-offset-1 ring-current" : "opacity-90 hover:opacity-100"
            }`}
          >
            <span>{p.label}</span>
            <span className="rounded-full bg-white/70 px-1.5 text-xs font-semibold">{p.count}</span>
          </button>
        );
      })}
    </div>
  );
}
