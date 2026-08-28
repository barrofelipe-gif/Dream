"use client";

import { useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import TopStats, { StatFilter } from "@/components/TopStats";
import Board from "@/components/Board";
import ItemModal from "@/components/ItemModal";
import { IconPlus, IconSearch } from "@/components/icons";
import { ALL_CATEGORY_STYLE, CATEGORY_STYLE } from "@/lib/style";
import { isOverdue, isDueToday, isWithinNextDays } from "@/lib/dates";
import { Category, ItemDTO, PRIORITIES, Priority, Status } from "@/lib/types";

interface PainelClientProps {
  initialItems: ItemDTO[];
  userName: string;
}

export default function PainelClient({ initialItems, userName }: PainelClientProps) {
  const [items, setItems] = useState<ItemDTO[]>(initialItems);
  const [category, setCategory] = useState<Category | "todas">("todas");
  const [statFilter, setStatFilter] = useState<StatFilter>("todas");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "todas">("todas");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemDTO | null>(null);
  const [newItemStatus, setNewItemStatus] = useState<Status>("pendente");

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (category !== "todas" && item.category !== category) return false;

      if (statFilter === "atrasados" && !isOverdue(item.due, item.status)) return false;
      if (statFilter === "hoje" && !isDueToday(item.due, item.status)) return false;
      if (statFilter === "proximos7" && !isWithinNextDays(item.due, item.status, 7)) return false;

      if (priorityFilter !== "todas" && item.priority !== priorityFilter) return false;

      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const haystack = [item.title, item.detail, item.company, item.processNumber]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [items, category, statFilter, priorityFilter, search]);

  const headerStyle = category === "todas" ? ALL_CATEGORY_STYLE : CATEGORY_STYLE[category];

  function openNewItem(status: Status) {
    setEditingItem(null);
    setNewItemStatus(status);
    setModalOpen(true);
  }

  function openExistingItem(item: ItemDTO) {
    setEditingItem(item);
    setModalOpen(true);
  }

  async function handleSave(data: Partial<ItemDTO> & { id?: string }) {
    if (data.id) {
      const res = await fetch(`/api/items/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Falha ao salvar");
      const updated: ItemDTO = await res.json();
      setItems((prev) => prev.map((i) => (i.id === updated.id ? updated : i)));
    } else {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Falha ao criar");
      const created: ItemDTO = await res.json();
      setItems((prev) => [created, ...prev]);
    }
  }

  async function handleDelete(id: string) {
    const prev = items;
    setItems((cur) => cur.filter((i) => i.id !== id));
    setModalOpen(false);
    const res = await fetch(`/api/items/${id}`, { method: "DELETE" });
    if (!res.ok) setItems(prev); // rollback se falhar
  }

  async function handleMoveItem(itemId: string, newStatus: Status) {
    const prev = items;
    setItems((cur) => cur.map((i) => (i.id === itemId ? { ...i, status: newStatus } : i)));
    const res = await fetch(`/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) setItems(prev);
  }

  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar
        items={items}
        activeCategory={category}
        onSelectCategory={setCategory}
        userName={userName}
      />

      <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-hidden px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <headerStyle.icon className="h-5 w-5 text-zinc-500" />
            <h1 className="text-lg font-semibold text-zinc-900">{headerStyle.label}</h1>
          </div>

          <button
            onClick={() => openNewItem("pendente")}
            className="flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            <IconPlus className="h-4 w-4" />
            Nova pendência
          </button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <TopStats items={items.filter((i) => category === "todas" || i.category === category)} active={statFilter} onSelect={setStatFilter} />

          <div className="flex items-center gap-2">
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value as never)}
              className="rounded-lg border border-zinc-300 bg-white px-2.5 py-1.5 text-sm text-zinc-600 outline-none focus:border-indigo-500"
            >
              <option value="todas">Todas as prioridades</option>
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>

            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar..."
                className="w-48 rounded-lg border border-zinc-300 bg-white py-1.5 pl-8 pr-3 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>
          </div>
        </div>

        <Board
          items={filtered}
          showCategoryChip={category === "todas"}
          onOpenItem={openExistingItem}
          onAddItem={openNewItem}
          onMoveItem={handleMoveItem}
        />
      </main>

      {modalOpen && (
        <ItemModal
          item={editingItem}
          defaultCategory={category === "todas" ? "processos" : category}
          defaultStatus={newItemStatus}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
