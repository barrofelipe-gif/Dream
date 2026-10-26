"use client";

import { useCallback, useEffect, useState } from "react";

type Conta = { id: string; username: string; loja: string };
type Resposta = { id: string; accountId: string | null; atalho: string; titulo: string; texto: string };

const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";

const VAZIO = { id: "", accountId: "", atalho: "", titulo: "", texto: "" };

/** Respostas salvas: atalhos que a equipe usa na caixa de entrada (digitando /atalho). */
export default function InstagramRespostasSalvas() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [lista, setLista] = useState<Resposta[]>([]);
  const [form, setForm] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/respostas-salvas", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setContas(j.contas);
    setLista(j.respostas);
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function salvar() {
    if (!form.atalho.trim() || !form.texto.trim()) return;
    setSalvando(true);
    setMsg(null);
    const r = await fetch(form.id ? `/api/instagram/respostas-salvas/${form.id}` : "/api/instagram/respostas-salvas", {
      method: form.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ atalho: form.atalho, titulo: form.titulo, texto: form.texto, accountId: form.accountId || null }),
    });
    const j = await r.json().catch(() => ({}));
    setSalvando(false);
    if (r.ok) {
      setMsg({ tipo: "ok", texto: form.id ? "Resposta atualizada." : "Resposta salva." });
      setForm(VAZIO);
      carregar();
    } else setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível salvar" });
  }

  async function apagar(r: Resposta) {
    if (!window.confirm(`Apagar a resposta /${r.atalho}?`)) return;
    await fetch(`/api/instagram/respostas-salvas/${r.id}`, { method: "DELETE" });
    if (form.id === r.id) setForm(VAZIO);
    carregar();
  }

  const nomeConta = (id: string | null) => (id ? `@${contas.find((c) => c.id === id)?.username ?? "conta"}` : "Todas as contas");

  return (
    <section>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Respostas salvas</p>
      <p className="mb-3 text-xs text-[#8a8f9c]">
        Textos prontos para a equipe. Na caixa de entrada, digite <span className="font-mono">/atalho</span> para inserir. Use {"{nome}"} para o primeiro nome da pessoa.
      </p>

      <div className="space-y-3 rounded-2xl border border-[#e3e5ea] p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center rounded-xl border border-[#e3e5ea] focus-within:border-[#6366f1] focus-within:ring-2 focus-within:ring-[#6366f1]/15">
            <span className="pl-3 font-mono text-sm text-[#a1a5b0]">/</span>
            <input
              value={form.atalho}
              onChange={(e) => setForm({ ...form, atalho: e.target.value })}
              placeholder="atalho (ex.: frete)"
              maxLength={30}
              className="w-full bg-transparent px-1 py-2.5 font-mono text-sm text-[#1b1f2b] outline-none"
            />
          </div>
          <input value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Título (opcional)" maxLength={60} className={campo} />
          <select value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })} className={campo}>
            <option value="">Todas as contas</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                @{c.username} ({c.loja})
              </option>
            ))}
          </select>
        </div>
        <textarea value={form.texto} onChange={(e) => setForm({ ...form, texto: e.target.value })} rows={4} maxLength={1000} placeholder="Texto da resposta" className={campo} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          {form.id && (
            <button onClick={() => setForm(VAZIO)} className="rounded-lg px-3 py-2 text-xs font-medium text-[#5a5f6d] hover:bg-[#f2f3f6]">
              Cancelar edição
            </button>
          )}
          <button
            onClick={salvar}
            disabled={salvando || !form.atalho.trim() || !form.texto.trim()}
            className="rounded-lg bg-[#1b1f2b] px-4 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40"
          >
            {salvando ? "Salvando…" : form.id ? "Salvar alterações" : "Adicionar resposta"}
          </button>
        </div>
        {msg && <p className={`text-xs ${msg.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.texto}</p>}
      </div>

      {lista.length === 0 ? (
        <p className="mt-3 text-xs text-[#a1a5b0]">Nenhuma resposta salva ainda.</p>
      ) : (
        <div className="mt-3 space-y-2">
          {lista.map((r) => (
            <div key={r.id} className="rounded-xl border border-[#e3e5ea] p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate">
                  <span className="font-mono text-[#6366f1]">/{r.atalho}</span>
                  {r.titulo && r.titulo !== r.atalho && <span className="ml-2 font-medium text-[#1b1f2b]">{r.titulo}</span>}
                </span>
                <span className="shrink-0 text-[11px] text-[#8a8f9c]">{nomeConta(r.accountId)}</span>
              </div>
              <p className="mt-1 line-clamp-3 whitespace-pre-line text-xs text-[#5a5f6d]">{r.texto}</p>
              <div className="mt-2 flex justify-end gap-3 text-[11px]">
                <button
                  onClick={() => setForm({ id: r.id, accountId: r.accountId ?? "", atalho: r.atalho, titulo: r.titulo, texto: r.texto })}
                  className="text-[#6366f1] hover:underline"
                >
                  Editar
                </button>
                <button onClick={() => apagar(r)} className="text-red-600 hover:underline">
                  Apagar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
