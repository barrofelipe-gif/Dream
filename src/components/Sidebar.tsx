"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { Category, ItemDTO } from "@/lib/types";
import { CATEGORY_STYLE, ALL_CATEGORY_STYLE } from "@/lib/style";
import { isOverdue } from "@/lib/dates";
import { IconBuilding, IconLogout, IconMail } from "@/components/icons";

interface SidebarProps {
  items: ItemDTO[];
  activeCategory: Category | "todas";
  onSelectCategory: (c: Category | "todas") => void;
  userName: string;
}

export default function Sidebar({ items, activeCategory, onSelectCategory, userName }: SidebarProps) {
  const openItems = items.filter((i) => !i.columnIsDone);

  const categoryList: (Category | "todas")[] = ["todas", "processos", "bff", "emails", "viagens"];

  return (
    <aside className="flex w-64 shrink-0 flex-col bg-[var(--sidebar)] text-[var(--sidebar-foreground)]">
      <div className="flex items-center gap-2 px-5 pb-2 pt-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-500 text-sm font-bold text-white">
          P
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Painel de Pendências</p>
          <p className="text-xs text-zinc-400">{userName}</p>
        </div>
      </div>

      <nav className="mt-4 flex-1 space-y-1 px-3">
        {categoryList.map((cat) => {
          const isAll = cat === "todas";
          const style = isAll ? ALL_CATEGORY_STYLE : CATEGORY_STYLE[cat];
          const Icon = style.icon;
          const scoped = isAll ? openItems : openItems.filter((i) => i.category === cat);
          const count = scoped.length;
          const overdueCount = scoped.filter((i) => isOverdue(i.due, i.columnIsDone)).length;
          const active = activeCategory === cat;

          return (
            <button
              key={cat}
              onClick={() => onSelectCategory(cat)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                active ? "bg-white/10 text-white" : "text-zinc-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{style.label}</span>
              {overdueCount > 0 && (
                <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white">
                  {overdueCount}
                </span>
              )}
              <span className="min-w-[1.25rem] rounded-full bg-white/10 px-1.5 py-0.5 text-center text-[11px] leading-none text-zinc-300">
                {count}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="space-y-1 border-t border-white/10 px-3 py-3">
        <Link
          href="/empresa"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <IconBuilding className="h-4 w-4" />
          BFF Fitness
        </Link>
        <Link
          href="/conectar-gmail"
          className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <IconMail className="h-4 w-4" />
          Conectar Gmail
        </Link>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-zinc-300 transition-colors hover:bg-white/5 hover:text-white"
        >
          <IconLogout className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
