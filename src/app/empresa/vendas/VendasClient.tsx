"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface SalesSummary {
  periodoDias: number;
  desde: string;
  pedidosValidos: number;
  pedidosCancelados: number;
  faturamento: number;
  ticketMedio: number;
  clientesUnicos: number;
  taxaCancelamento: number;
  porStatus: { status: string; pedidos: number; valor: number }[];
  porDia: { dia: string; pedidos: number; valor: number }[];
  topClientes: { customerId: string; pedidos: number; valor: number }[];
  truncado: boolean;
}

type State =
  | { status: "loading" }
  | { status: "not-connected" }
  | { status: "error"; message: string }
  | { status: "ok"; data: SalesSummary };

const brl = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });

const diaBR = (iso: string) => iso.slice(5).split("-").reverse().join("/");

export default function VendasClient() {
  const [dias, setDias] = useState(30);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tray/sales?dias=${dias}`)
      .then(async (r) => {
        const data = await r.json();
        if (cancelled) return;
        if (!r.ok) {
          setState(
            data.notConnected
              ? { status: "not-connected" }
              : { status: "error", message: data.error ?? "Erro desconhecido" }
          );
          return;
        }
        setState({ status: "ok", data });
      })
      .catch(() => !cancelled && setState({ status: "error", message: "Falha de rede" }));
    return () => {
      cancelled = true;
    };
  }, [dias]);

  if (state.status === "not-connected") {
    return (
      <div className="mt-8 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center">
        <p className="text-sm font-medium text-zinc-800">A Tray ainda não está conectada</p>
        <Link
          href="/conectar-tray"
          className="mt-4 inline-block rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Conectar com a Tray
        </Link>
      </div>
    );
  }

  const maxValorDia =
    state.status === "ok" ? Math.max(...state.data.porDia.map((d) => d.valor), 1) : 1;

  return (
    <div className="mt-6">
      <div className="flex gap-2">
        {[7, 30, 90].map((d) => (
          <button
            key={d}
            onClick={() => {
              if (d === dias) return;
              // volta pro "carregando" aqui (e não dentro do efeito) pra não
              // deixar na tela o número do período anterior enquanto busca
              setState({ status: "loading" });
              setDias(d);
            }}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              dias === d
                ? "bg-indigo-600 text-white"
                : "border border-[var(--border)] text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {d} dias
          </button>
        ))}
      </div>

      {state.status === "loading" && (
        <p className="mt-6 text-sm text-zinc-500">Buscando pedidos na Tray…</p>
      )}
      {state.status === "error" && (
        <p className="mt-6 text-sm text-rose-500">Erro: {state.message}</p>
      )}

      {state.status === "ok" && (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              { label: "Faturamento", valor: brl(state.data.faturamento) },
              { label: "Pedidos", valor: String(state.data.pedidosValidos) },
              { label: "Ticket médio", valor: brl(state.data.ticketMedio) },
              { label: "Clientes", valor: String(state.data.clientesUnicos) },
            ].map((kpi) => (
              <div
                key={kpi.label}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4"
              >
                <p className="text-xs text-zinc-500">{kpi.label}</p>
                <p className="mt-1 text-lg font-semibold text-zinc-100">{kpi.valor}</p>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-zinc-500">
            Desde {diaBR(state.data.desde)} · {state.data.pedidosCancelados} cancelado(s) (
            {(state.data.taxaCancelamento * 100).toFixed(1)}% dos pedidos)
            {state.data.truncado && " · mostrando os pedidos mais recentes do período"}
          </p>

          <h2 className="mt-8 text-sm font-semibold text-zinc-300">Faturamento por dia</h2>
          <div className="mt-3 flex items-end gap-1 overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            {state.data.porDia.length === 0 && (
              <p className="text-sm text-zinc-500">Nenhum pedido no período.</p>
            )}
            {state.data.porDia.map((d) => (
              <div key={d.dia} className="flex min-w-[22px] flex-1 flex-col items-center gap-1">
                <div
                  title={`${diaBR(d.dia)} · ${brl(d.valor)} · ${d.pedidos} pedido(s)`}
                  style={{ height: `${Math.max(4, (d.valor / maxValorDia) * 120)}px` }}
                  className="w-full rounded-t bg-indigo-500/70"
                />
                <span className="text-[9px] text-zinc-500">{diaBR(d.dia)}</span>
              </div>
            ))}
          </div>

          <h2 className="mt-8 text-sm font-semibold text-zinc-300">Pedidos por status</h2>
          <div className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)]">
            {state.data.porStatus.map((s) => (
              <div key={s.status} className="flex items-center justify-between px-4 py-2.5">
                <span className="text-sm text-zinc-300">{s.status}</span>
                <span className="text-xs text-zinc-500">
                  {s.pedidos} pedido(s) · {brl(s.valor)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
