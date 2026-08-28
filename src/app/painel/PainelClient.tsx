"use client";

import { useEffect, useMemo, useState } from "react";
import Sidebar from "@/components/Sidebar";
import TopStats, { StatFilter } from "@/components/TopStats";
import Board from "@/components/Board";
import ItemModal from "@/components/ItemModal";
import { IconPlus, IconSearch } from "@/components/icons";
import { ALL_CATEGORY_STYLE, CATEGORY_STYLE } from "@/lib/style";
import { isOverdue, isDueToday, isWithinNextDays } from "@/lib/dates";
import { CATEGORIES, Category, ColumnDTO, ItemDTO, PRIORITIES, Priority } from "@/lib/types";

interface PainelClientProps {
  initialItems: ItemDTO[];
  userName: string;
}

const EMPTY_COLUMNS: Record<Category, ColumnDTO[]> = {
  processos: [],
  bff: [],
  emails: [],
  viagens: [],
};

export default function PainelClient({ initialItems, userName }: PainelClientProps) {
  const [items, setItems] = useState<ItemDTO[]>(initialItems);
  const [columnsByCategory, setColumnsByCategory] = useState<Record<Category, ColumnDTO[]>>(EMPTY_COLUMNS);
  const [category, setCategory] = useState<Category | "todas">("todas");
  const [statFilter, setStatFilter] = useState<StatFilter>("todas");
  const [priorityFilter, setPriorityFilter] = useState<Priority | "todas">("todas");
  const [search, setSearch] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemDTO | null>(null);
  const [newItemCategory, setNewItemCategory] = useState<Category>("processos");
  const [newItemColumnId, setNewItemColumnId] = useState<string>("");

  // Carrega as colunas das 4 categorias uma vez (cria as padrão sob demanda
  // no servidor, se a categoria ainda não tiver nenhuma).
  useEffect(() => {
    Promise.all(
      CATEGORIES.map((c) =>
        fetch(`/api/columns?category=${c.value}`)
          .then((r) => r.json())
          .then((cols: ColumnDTO[]) => [c.value, cols] as const)
      )
    ).then((entries) => {
      setColumnsByCategory((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
    });
  }, []);

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (category !== "todas" && item.category !== category) return false;

      if (statFilter === "atrasados" && !isOverdue(item.due, item.columnIsDone)) return false;
      if (statFilter === "hoje" && !isDueToday(item.due, item.columnIsDone)) return false;
      if (statFilter === "proximos7" && !isWithinNextDays(item.due, item.columnIsDone, 7)) return false;

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

  // "Todas as categorias" mistura colunas de categorias diferentes, então
  // vira um resumo somente-leitura em 2 baldes (aberto/concluído) — pra
  // ter o Kanban de verdade (arrastar, colunas próprias), escolhe uma
  // categoria no menu lateral.
  const isAllView = category === "todas";
  const boardColumns: ColumnDTO[] = isAllView
    ? [
        { id: "__open__", category: "processos", name: "Em aberto", order: 0, isDone: false },
        { id: "__done__", category: "processos", name: "Concluído", order: 1, isDone: true },
      ]
    : columnsByCategory[category];
  const boardItems = isAllView
    ? filtered.map((i) => ({ ...i, columnId: i.columnIsDone ? "__done__" : "__open__" }))
    : filtered;

  function openNewItem(columnId: string) {
    setEditingItem(null);
    setNewItemCategory(category === "todas" ? "processos" : category);
    setNewItemColumnId(columnId);
    setModalOpen(true);
  }

  function openNewItemButton() {
    const cat = category === "todas" ? "processos" : category;
    openNewItem(columnsByCategory[cat]?.[0]?.id ?? "");
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

  async function handleMoveItem(itemId: string, columnId: string) {
    if (isAllView) return; // resumo somente-leitura, não move nada de verdade
    const targetColumn = columnsByCategory[category]?.find((c) => c.id === columnId);
    const prev = items;
    setItems((cur) =>
      cur.map((i) =>
        i.id === itemId ? { ...i, columnId, columnIsDone: targetColumn?.isDone ?? i.columnIsDone } : i
      )
    );
    const res = await fetch(`/api/items/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ columnId }),
    });
    if (!res.ok) setItems(prev);
  }

  async function handleAddColumn(name: string) {
    if (isAllView) return;
    const res = await fetch("/api/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ category, name }),
    });
    if (!res.ok) return;
    const created: ColumnDTO = await res.json();
    setColumnsByCategory((prev) => ({ ...prev, [category]: [...prev[category], created] }));
  }

  async function handleRenameColumn(columnId: string, name: string) {
    if (isAllView) return;
    setColumnsByCategory((prev) => ({
      ...prev,
      [category]: prev[category].map((c) => (c.id === columnId ? { ...c, name } : c)),
    }));
    await fetch(`/api/columns/${columnId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
  }

  async function handleDeleteColumn(columnId: string) {
    if (isAllView) return;
    const res = await fetch(`/api/columns/${columnId}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      alert(body?.error ?? "Não deu pra excluir essa coluna.");
      return;
    }
    setColumnsByCategory((prev) => ({
      ...prev,
      [category]: prev[category].filter((c) => c.id !== columnId),
    }));
  }

  async function handleMoveColumn(columnId: string, direction: "left" | "right") {
    if (isAllView) return;
    const cols = [...columnsByCategory[category]];
    const idx = cols.findIndex((c) => c.id === columnId);
    const swapWith = direction === "left" ? idx - 1 : idx + 1;
    if (idx === -1 || swapWith < 0 || swapWith >= cols.length) return;
    [cols[idx], cols[swapWith]] = [cols[swapWith], cols[idx]];

    setColumnsByCategory((prev) => ({ ...prev, [category]: cols }));
    await fetch("/api/columns/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: cols.map((c) => c.id) }),
    });
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
            {isAllView && (
              <span className="text-xs text-zinc-400">
                (resumo — escolha uma categoria pra arrastar cards e editar colunas)
              </span>
            )}
          </div>

          <button
            onClick={openNewItemButton}
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
          items={boardItems}
          columns={boardColumns}
          readOnly={isAllView}
          showCategoryChip={isAllView}
          onOpenItem={openExistingItem}
          onAddItem={openNewItem}
          onMoveItem={handleMoveItem}
          onAddColumn={isAllView ? undefined : handleAddColumn}
          onRenameColumn={isAllView ? undefined : handleRenameColumn}
          onDeleteColumn={isAllView ? undefined : handleDeleteColumn}
          onMoveColumn={isAllView ? undefined : handleMoveColumn}
        />
      </main>

      {modalOpen && (
        <ItemModal
          item={editingItem}
          defaultCategory={newItemCategory}
          defaultColumnId={newItemColumnId}
          columnsByCategory={columnsByCategory}
          onClose={() => setModalOpen(false)}
          onSave={handleSave}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
