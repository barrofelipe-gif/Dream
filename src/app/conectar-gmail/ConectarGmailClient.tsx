"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconGoogle, IconMail } from "@/components/icons";

interface Status {
  connected: boolean;
  email?: string | null;
  lastSyncAt?: string | null;
}

export default function ConectarGmailClient() {
  const searchParams = useSearchParams();
  const callbackStatus = searchParams.get("status");
  const detail = searchParams.get("detail");

  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/gmail/status")
      .then((r) => r.json())
      .then(setStatus);
  }, [callbackStatus]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    const res = await fetch("/api/gmail/sync", { method: "POST" });
    const data = await res.json();
    setSyncing(false);
    if (res.ok) {
      setSyncMsg(`Sincronizado: ${data.created} novo(s), ${data.updated} atualizado(s).`);
      fetch("/api/gmail/status")
        .then((r) => r.json())
        .then(setStatus);
    } else {
      setSyncMsg(`Erro: ${data.error}`);
    }
  }

  async function handleDisconnect() {
    await fetch("/api/gmail/disconnect", { method: "POST" });
    setStatus({ connected: false });
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50">
          <IconMail className="h-5 w-5 text-sky-600" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-zinc-900">Conectar Gmail</h1>
          <p className="text-xs text-zinc-500">
            O painel só sincroniza e-mails marcados com a label{" "}
            <span className="font-medium text-zinc-700">&quot;Pendente&quot;</span> no seu Gmail.
          </p>
        </div>
      </div>

      {callbackStatus === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Gmail conectado com sucesso.
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
            Conectado{status.lastSyncAt ? ` · última sincronização: ${new Date(status.lastSyncAt).toLocaleString("pt-BR")}` : " · ainda não sincronizado"}
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {syncing ? "Sincronizando..." : "Sincronizar agora"}
            </button>
            <button
              onClick={handleDisconnect}
              className="rounded-lg px-3 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50"
            >
              Desconectar
            </button>
          </div>
          {syncMsg && <p className="text-xs text-zinc-500">{syncMsg}</p>}
          <p className="text-xs text-zinc-400">
            A sincronização automática também roda de hora em hora (cron job da Vercel).
          </p>
        </div>
      ) : (
        <a
          href="/api/gmail/connect"
          className="flex items-center justify-center gap-2 rounded-lg border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
        >
          <IconGoogle className="h-4 w-4" />
          Conectar com o Google
        </a>
      )}
    </div>
  );
}
