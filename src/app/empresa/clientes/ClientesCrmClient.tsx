"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { IconUsers, IconSearch } from "@/components/icons";
import type { TrayCustomer, CustomerSummary, RecencyStatus } from "@/lib/trayCustomers";

const RECENCY_LABEL: Record<RecencyStatus, { label: string; hex: string }> = {
  ativo: { label: "Ativo", hex: "#0ca30c" },
  esfriando: { label: "Esfriando", hex: "#fab219" },
  sumido: { label: "Sumido", hex: "#d03b3b" },
  nunca_comprou: { label: "Nunca comprou", hex: "#71717a" },
};

type ListState =
  | { status: "loading" }
  | { status: "not-connected" }
  | { status: "error"; message: string }
  | { status: "ok"; customers: TrayCustomer[]; total: number };

export default function ClientesCrmClient() {
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const qs = search ? `?search=${encodeURIComponent(search)}` : "";
    fetch(`/api/tray/customers${qs}`)
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setState(data.notConnected ? { status: "not-connected" } : { status: "error", message: data.error });
          return;
        }
        setState({ status: "ok", customers: data.customers, total: data.paging.total });
      })
      .catch(() => !cancelled && setState({ status: "error", message: "Falha de rede" }));
    return () => {
      cancelled = true;
    };
  }, [search]);

  if (state.status === "not-connected") {
    return (
      <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
          <IconUsers className="h-5 w-5 text-amber-600" />
        </div>
        <p className="text-sm font-medium text-zinc-800">A Tray ainda não está conectada</p>
        <p className="mt-1 text-sm text-zinc-500">
          O CRM já está pronto pra puxar os dados — falta só autorizar a conexão.
        </p>
        <Link
          href="/conectar-tray"
          className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Conectar com a Tray
        </Link>
      </div>
    );
  }

  if (state.status === "error") {
    return <p className="mt-8 text-sm text-rose-600">Erro ao carregar clientes: {state.message}</p>;
  }

  return (
    <div className="mt-6">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por e-mail"
          className="w-full rounded-lg border border-[var(--border)] bg-transparent py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-400"
        />
      </div>

      {state.status === "loading" && <p className="mt-4 text-sm text-zinc-500">Carregando...</p>}

      {state.status === "ok" && (
        <>
          <p className="mt-3 text-xs text-zinc-500">{state.total} cliente(s)</p>
          <div className="mt-2 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
            {state.customers.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className="flex w-full items-center justify-between gap-3 bg-[var(--surface)] px-4 py-3 text-left hover:bg-zinc-50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800">{c.name}</p>
                  <p className="truncate text-xs text-zinc-500">
                    {c.email ?? "sem e-mail"} {c.city ? `· ${c.city}/${c.state}` : ""}
                  </p>
                </div>
                {/* Contador de pedidos da Tray vem zerado na listagem, então
                    mostramos a última visita — o histórico real de pedidos
                    aparece ao abrir o cliente (busca em /orders). */}
                <span className="shrink-0 text-xs text-zinc-400">
                  {c.last_visit ? `visitou ${c.last_visit.slice(0, 10).split("-").reverse().join("/")}` : "—"}
                </span>
              </button>
            ))}
            {state.customers.length === 0 && (
              <p className="bg-[var(--surface)] px-4 py-6 text-center text-sm text-zinc-500">Nenhum cliente encontrado.</p>
            )}
          </div>
        </>
      )}

      {selectedId && <CustomerDetail key={selectedId} id={selectedId} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function CustomerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [summary, setSummary] = useState<CustomerSummary | "loading" | "error">("loading");

  useEffect(() => {
    fetch(`/api/tray/customers/${id}`)
      .then(async (r) => {
        if (!r.ok) return setSummary("error");
        setSummary(await r.json());
      })
      .catch(() => setSummary("error"));
  }, [id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {summary === "loading" && <p className="text-sm text-zinc-500">Carregando...</p>}
        {summary === "error" && <p className="text-sm text-rose-600">Não deu pra carregar esse cliente.</p>}
        {typeof summary === "object" && (
          <>
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-base font-semibold text-zinc-900">{summary.customer.name}</h2>
                <p className="text-sm text-zinc-500">{summary.customer.email}</p>
              </div>
              <span
                className="rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={{
                  background: `${RECENCY_LABEL[summary.recency].hex}1a`,
                  color: RECENCY_LABEL[summary.recency].hex,
                }}
              >
                {RECENCY_LABEL[summary.recency].label}
              </span>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <Stat label="Pedidos" value={String(summary.totalOrders)} />
              <Stat
                label="Total gasto"
                value={summary.totalSpent.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              />
              <Stat
                label="Ticket médio"
                value={summary.avgTicket.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
              />
            </div>

            <p className="mt-3 text-xs text-zinc-500">
              {summary.daysSinceLastOrder !== null
                ? `Última compra há ${summary.daysSinceLastOrder} dia(s)`
                : "Nunca comprou"}
            </p>

            <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Histórico de pedidos</h3>
            <div className="mt-2 space-y-1.5">
              {summary.orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 text-sm">
                  <span className="text-zinc-600">{o.date}</span>
                  <span className="text-zinc-500">{o.status}</span>
                  <span className="font-medium text-zinc-800">
                    {(parseFloat(o.total) || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                  </span>
                </div>
              ))}
              {summary.orders.length === 0 && <p className="text-sm text-zinc-500">Sem pedidos.</p>}
            </div>

            <button onClick={onClose} className="mt-5 w-full rounded-lg bg-zinc-100 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-200">
              Fechar
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 px-3 py-2">
      <p className="text-[11px] text-zinc-500">{label}</p>
      <p className="text-sm font-semibold text-zinc-900">{value}</p>
    </div>
  );
}
