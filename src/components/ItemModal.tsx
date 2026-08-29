"use client";

import { useEffect, useState } from "react";
import {
  BFF_SUBS,
  CATEGORIES,
  Category,
  ColumnDTO,
  ItemDTO,
  PRIORITIES,
  RECURRING_OPTIONS,
  UserOption,
  VoiceDraft,
} from "@/lib/types";
import { IconClose, IconTrash } from "@/components/icons";
import MicButton from "@/components/MicButton";

interface ItemModalProps {
  item: ItemDTO | null; // null = criando novo
  defaultCategory: Category;
  defaultColumnId: string;
  columnsByCategory: Record<Category, ColumnDTO[]>;
  currentUserId: string;
  otherUsers: UserOption[]; // pra "Atribuir para" — só aparece se tiver alguém além de você
  // pré-preenche o formulário de um item novo (vindo do ditado por voz)
  initialDraft?: VoiceDraft | null;
  onClose: () => void;
  onSave: (data: Partial<ItemDTO> & { id?: string; ownerId?: string }) => Promise<void>;
  onDelete?: (id: string) => Promise<void>;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

export default function ItemModal({
  item,
  defaultCategory,
  defaultColumnId,
  columnsByCategory,
  currentUserId,
  otherUsers,
  initialDraft,
  onClose,
  onSave,
  onDelete,
}: ItemModalProps) {
  const [form, setForm] = useState({
    category: item?.category ?? initialDraft?.category ?? defaultCategory,
    bffSub: item?.bffSub ?? initialDraft?.bffSub ?? null,
    ownerId: item?.ownerId ?? currentUserId,
    title: item?.title ?? initialDraft?.title ?? "",
    detail: item?.detail ?? initialDraft?.detail ?? "",
    company: item?.company ?? initialDraft?.company ?? "",
    lawyer: item?.lawyer ?? "",
    processNumber: item?.processNumber ?? initialDraft?.processNumber ?? "",
    lastMovement: item?.lastMovement ?? "",
    due: toDateInputValue(item?.due ?? initialDraft?.due ?? null),
    priority: item?.priority ?? initialDraft?.priority ?? "media",
    columnId:
      item?.columnId ??
      (initialDraft ? columnsByCategory[initialDraft.category]?.[0]?.id : undefined) ??
      defaultColumnId,
    recurring: item?.recurring ?? "none",
  });

  // Colunas de quem a pendência está sendo atribuída — busca sob demanda
  // quando "Atribuir para" muda pra outra pessoa (o board dela é diferente
  // do seu). null = ainda não buscou / é você mesmo (usa columnsByCategory).
  const [assigneeColumns, setAssigneeColumns] = useState<ColumnDTO[] | null>(null);

  useEffect(() => {
    // assigneeColumns só é lido quando ownerId !== currentUserId (ver
    // columnsForCategory abaixo) — nada pra buscar quando é você mesmo.
    if (form.ownerId === currentUserId) return;

    let cancelled = false;
    fetch(`/api/columns?category=${form.category}&userId=${form.ownerId}`)
      .then((r) => r.json())
      .then((cols: ColumnDTO[]) => {
        if (cancelled) return;
        setAssigneeColumns(cols);
        setForm((f) => (cols.some((c) => c.id === f.columnId) ? f : { ...f, columnId: cols[0]?.id ?? f.columnId }));
      });
    return () => {
      cancelled = true;
    };
  }, [form.ownerId, form.category, currentUserId]);

  const columnsForCategory =
    form.ownerId === currentUserId ? columnsByCategory[form.category] ?? [] : assigneeColumns ?? [];

  function handleCategoryChange(newCategory: Category) {
    const firstColumn = (form.ownerId === currentUserId ? columnsByCategory[newCategory] : assigneeColumns)?.[0];
    setForm((f) => ({
      ...f,
      category: newCategory,
      // a coluna atual só faz sentido dentro da categoria antiga
      columnId: firstColumn ? firstColumn.id : f.columnId,
    }));
  }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) {
      setError("Dá um título pra essa pendência.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        id: item?.id,
        ...form,
        due: form.due ? new Date(form.due + "T12:00:00").toISOString() : null,
      });
      onClose();
    } catch {
      setError("Não deu pra salvar. Tenta de novo.");
    } finally {
      setSaving(false);
    }
  }

  const isProcesso = form.category === "processos";
  const isBff = form.category === "bff";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl">
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-100 px-5 py-4">
            <h2 className="text-base font-semibold text-zinc-900">
              {item ? "Editar pendência" : "Nova pendência"}
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600"
            >
              <IconClose />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {initialDraft && (
              <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-700">
                Preenchido a partir do que você ditou — confere se ficou certo antes de salvar.
              </p>
            )}

            {!item && otherUsers.length > 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Atribuir para</label>
                <select
                  value={form.ownerId}
                  onChange={(e) => setForm((f) => ({ ...f, ownerId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  <option value={currentUserId}>Você</option>
                  {otherUsers.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {item && (item.assignedByName || item.completedAt) && (
              <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
                {item.assignedByName && <>Enviado por {item.assignedByName} · </>}
                {new Date(item.createdAt).toLocaleDateString("pt-BR")}
                {item.completedAt && <> · Concluído em {new Date(item.completedAt).toLocaleDateString("pt-BR")}</>}
              </p>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-zinc-600">Título</label>
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
                  placeholder="Ex: Responder cobrança do fornecedor X"
                />
                <MicButton
                  label="Ditar título"
                  onResult={(text) =>
                    setForm((f) => ({ ...f, title: [f.title, text].filter(Boolean).join(" ") }))
                  }
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Categoria</label>
                <select
                  value={form.category}
                  onChange={(e) => handleCategoryChange(e.target.value as Category)}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>

              {isBff && (
                <div>
                  <label className="mb-1 block text-xs font-medium text-zinc-600">Subcategoria</label>
                  <select
                    value={form.bffSub ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, bffSub: (e.target.value || null) as never }))}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  >
                    <option value="">—</option>
                    {BFF_SUBS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {isProcesso && (
              <div className="space-y-3 rounded-lg border border-zinc-100 bg-zinc-50 p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">Empresa</label>
                    <input
                      value={form.company}
                      onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">Advogado</label>
                    <input
                      value={form.lawyer}
                      onChange={(e) => setForm((f) => ({ ...f, lawyer: e.target.value }))}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">Nº do processo</label>
                    <input
                      value={form.processNumber}
                      onChange={(e) => setForm((f) => ({ ...f, processNumber: e.target.value }))}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-zinc-600">Última movimentação</label>
                    <input
                      value={form.lastMovement}
                      onChange={(e) => setForm((f) => ({ ...f, lastMovement: e.target.value }))}
                      className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-xs font-medium text-zinc-600">Detalhes</label>
                <MicButton
                  label="Ditar detalhes"
                  onResult={(text) =>
                    setForm((f) => ({ ...f, detail: [f.detail, text].filter(Boolean).join(" ") }))
                  }
                />
              </div>
              <textarea
                value={form.detail}
                onChange={(e) => setForm((f) => ({ ...f, detail: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Prazo</label>
                <input
                  type="date"
                  value={form.due}
                  onChange={(e) => setForm((f) => ({ ...f, due: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Repetição</label>
                <select
                  value={form.recurring}
                  onChange={(e) => setForm((f) => ({ ...f, recurring: e.target.value as never }))}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  {RECURRING_OPTIONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Prioridade</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value as never }))}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-zinc-600">Coluna</label>
                <select
                  value={form.columnId}
                  onChange={(e) => setForm((f) => ({ ...f, columnId: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                >
                  {columnsForCategory.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {error && <p className="text-sm text-rose-600">{error}</p>}
          </div>

          <div className="flex shrink-0 items-center justify-between border-t border-zinc-100 px-5 py-4">
            {item && onDelete ? (
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
              >
                <IconTrash className="h-4 w-4" />
                Excluir
              </button>
            ) : (
              <span />
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
              >
                {saving ? "Salvando..." : "Salvar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
