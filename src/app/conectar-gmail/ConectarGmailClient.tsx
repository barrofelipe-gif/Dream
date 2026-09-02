"use client";

import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { IconGoogle, IconMail } from "@/components/icons";

interface Account {
  id: string;
  email: string;
  lastSyncAt: string | null;
  createdAt: string;
}

interface Status {
  connected: boolean;
  accounts: Account[];
}

export default function ConectarGmailClient() {
  const searchParams = useSearchParams();
  const callbackStatus = searchParams.get("status");
  const detail = searchParams.get("detail");

  const [status, setStatus] = useState<Status | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const loadStatus = useCallback(
    () =>
      fetch("/api/gmail/status")
        .then((r) => r.json())
        .then(setStatus),
    []
  );

  useEffect(() => {
    loadStatus();
  }, [callbackStatus, loadStatus]);

  async function handleSync() {
    setSyncing(true);
    setSyncMsg(null);
    const res = await fetch("/api/gmail/sync", { method: "POST" });
    const data = await res.json();
    setSyncing(false);
    if (res.ok) {
      const falhas =
        data.errors?.length > 0
          ? ` Falhou em: ${data.errors.map((e: { email: string }) => e.email).join(", ")}.`
          : "";
      setSyncMsg(`Sincronizado: ${data.created} novo(s), ${data.updated} atualizado(s).${falhas}`);
      loadStatus();
    } else {
      setSyncMsg(`Erro: ${data.error}`);
    }
  }

  async function handleDisconnect(account: Account) {
    const ok = window.confirm(
      `Desconectar ${account.email}? Os e-mails já importados continuam no painel.`
    );
    if (!ok) return;
    await fetch("/api/gmail/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ connectionId: account.id }),
    });
    loadStatus();
  }

  const accounts = status?.accounts ?? [];

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50">
          <IconMail className="h-5 w-5 text-sky-600" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-zinc-900">Contas Google</h1>
          <p className="text-xs text-zinc-500">
            Dá pra conectar várias contas (pessoal, empresa, fornecedor). O painel só sincroniza
            e-mails marcados com a label{" "}
            <span className="font-medium text-zinc-700">&quot;Pendente&quot;</span> em cada uma.
          </p>
        </div>
      </div>

      {callbackStatus === "ok" && (
        <p className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          Conta conectada com sucesso{detail ? `: ${detail}` : ""}.
        </p>
      )}
      {callbackStatus === "erro" && (
        <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          Não deu pra conectar ({detail ?? "erro desconhecido"}). Tenta de novo.
        </p>
      )}

      {accounts.length > 0 ? (
        <div className="space-y-4">
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-zinc-800">{account.email}</p>
                  <p className="text-xs text-zinc-400">
                    {account.lastSyncAt
                      ? `Última sincronização: ${new Date(account.lastSyncAt).toLocaleString("pt-BR")}`
                      : "Ainda não sincronizada"}
                  </p>
                </div>
                <button
                  onClick={() => handleDisconnect(account)}
                  className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-rose-600 hover:bg-rose-50"
                >
                  Desconectar
                </button>
              </li>
            ))}
          </ul>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={handleSync}
              disabled={syncing}
              className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {syncing ? "Sincronizando..." : "Sincronizar agora"}
            </button>
            <a
              href="/api/gmail/connect"
              className="flex items-center gap-2 rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
            >
              <IconGoogle className="h-4 w-4" />
              Conectar outra conta
            </a>
          </div>

          {syncMsg && <p className="text-xs text-zinc-500">{syncMsg}</p>}
          <p className="text-xs text-zinc-400">
            A sincronização automática também roda 1x por dia (cron job da Vercel).
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
