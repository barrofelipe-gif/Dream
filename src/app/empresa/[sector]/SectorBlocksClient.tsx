"use client";

import { useState } from "react";
import { Sector } from "@/lib/sectors";
import { STATUS_STYLE, SectorStatus } from "@/lib/sectorStatus";
import type { SectorMetricDTO } from "@/lib/sectorMetrics";

interface Props {
  sector: Sector;
  blocks: string[];
  initialMetrics: Record<string, SectorMetricDTO>;
}

const STATUS_OPTIONS: SectorStatus[] = ["good", "warning", "critical", "unknown"];

export default function SectorBlocksClient({ sector, blocks, initialMetrics }: Props) {
  const [metrics, setMetrics] = useState(initialMetrics);
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="mt-6 space-y-2">
      {blocks.map((block) => {
        const metric = metrics[block];
        const status = metric?.status ?? "unknown";
        const style = STATUS_STYLE[status];
        const isEditing = editing === block;

        return (
          <div key={block} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
            <button
              type="button"
              onClick={() => setEditing(isEditing ? null : block)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <div className="min-w-0">
                <span className="text-sm text-zinc-700">{block}</span>
                {metric?.value && <span className="ml-2 text-sm font-medium text-zinc-900">{metric.value}</span>}
                {metric?.note && <p className="mt-0.5 truncate text-xs text-zinc-500">{metric.note}</p>}
              </div>
              <span
                className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{ background: `${style.hex}1a`, color: style.hex }}
              >
                {style.label}
              </span>
            </button>

            {isEditing && (
              <BlockEditForm
                sector={sector}
                blockKey={block}
                label={block}
                metric={metric}
                onSaved={(updated) => {
                  setMetrics((prev) => ({ ...prev, [block]: updated }));
                  setEditing(null);
                }}
                onCancel={() => setEditing(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function BlockEditForm({
  sector,
  blockKey,
  label,
  metric,
  onSaved,
  onCancel,
}: {
  sector: Sector;
  blockKey: string;
  label: string;
  metric?: SectorMetricDTO;
  onSaved: (m: SectorMetricDTO) => void;
  onCancel: () => void;
}) {
  const [status, setStatus] = useState<SectorStatus>(metric?.status ?? "unknown");
  const [value, setValue] = useState(metric?.value ?? "");
  const [note, setNote] = useState(metric?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    const res = await fetch("/api/sector-metrics", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sector, blockKey, label, status, value: value || null, note: note || null }),
    });
    setSaving(false);
    if (!res.ok) {
      setError("Não deu pra salvar. Tenta de novo.");
      return;
    }
    onSaved({ blockKey, label, status, value: value || null, note: note || null, updatedAt: new Date().toISOString() });
  }

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
      <div className="flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((opt) => {
          const style = STATUS_STYLE[opt];
          const active = status === opt;
          return (
            <button
              key={opt}
              type="button"
              onClick={() => setStatus(opt)}
              className="rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors"
              style={
                active
                  ? { background: style.hex, borderColor: style.hex, color: "#fff" }
                  : { borderColor: `${style.hex}55`, color: style.hex }
              }
            >
              {style.label}
            </button>
          );
        })}
      </div>

      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Valor (ex: R$ 42.000, 18 dias, 12%)"
        className="w-full rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
      />
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Observação (opcional)"
        rows={2}
        className="w-full resize-none rounded-lg border border-[var(--border)] bg-transparent px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
      />

      {error && <p className="text-xs text-rose-600">{error}</p>}

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-xs font-medium text-zinc-500 hover:bg-zinc-100">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </div>
  );
}
