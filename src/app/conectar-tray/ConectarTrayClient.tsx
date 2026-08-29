"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconBox } from "@/components/icons";

interface Status {
  connected: boolean;
  storeId?: string | null;
  apiAddress?: string | null;
  lastSyncAt?: string | null;
}

export default function ConectarTrayClient() {
  const searchParams = useSearchParams();
  const callbackStatus = searchParams.get("status");
  const detail = searchParams.get("detail");

  const [status, setStatus] = useState<Status | null>(null);

  useEffect(() => {
    fetch("/api/tray/status")
      .then((r) => r.json())
      .then(setStatus);
  }, [callbackStatus]);

  async function handleDisconnect() {
    await fetch("/api/tray/disconnect", { method: "POST" });
    setStatus({ connected: false });
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
          <IconBox className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-zinc-900">Conectar Tray</h1>
          <p className="text-xs text-zinc-500">
            Traz pedidos, produtos e clientes da loja pra alimentar o Mapa da Empresa. Conexão é da empresa, não do
            usuário — quem clicar aqui autoriza pra todo mundo.
          </p>
        </div>
      </div>

      {callbackStatus === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Tray conectada com sucesso.
        </p>
      )}
      {callbackStatus === "erro" && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Não deu pra conectar ({detail ?? "erro desconhecido"}). Tenta de novo.
        </p>
      )}

      {status?.connected ? (
        <div className="space-y-3">
          <p className="text-sm text-zinc-600">
            Conectado à loja {status.storeId}
            {status.lastSyncAt
              ? ` · última sincronização: ${new Date(status.lastSyncAt).toLocaleString("pt-BR")}`
              : " · ainda sem sincronização"}
          </p>
          <button
            onClick={handleDisconnect}
            className="rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
          >
            Desconectar
          </button>
        </div>
      ) : (
        <a
          href="/api/tray/connect"
          className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <IconBox className="h-4 w-4" />
          Conectar com a Tray
        </a>
      )}
    </div>
  );
}
