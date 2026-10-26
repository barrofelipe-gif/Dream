"use client";

import { useCallback, useEffect, useState } from "react";

type Conta = { id: string; username: string; loja: string };
type Transmissao = {
  id: string;
  nome: string;
  texto: string;
  incluirTags: string[];
  excluirTags: string[];
  status: string;
  total: number;
  enviadas: number;
  falhas: number;
  createdAt: string;
  account: { username: string };
};

const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";
const SUGESTOES = ["Comprador", "Pediu humano", "Sem dúvida informada", "Não atendido", "Quer comprar", "Resolvido pelo robô", "Pedido atrasado"];

const quando = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

function EditorTags({ rotulo, valor, onChange, cor }: { rotulo: string; valor: string[]; onChange: (v: string[]) => void; cor: string }) {
  const [novo, setNovo] = useState("");
  const adicionar = (t: string) => {
    const x = t.trim();
    if (x && !valor.includes(x)) onChange([...valor, x]);
    setNovo("");
  };
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-[#5a5f6d]">{rotulo}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {valor.map((t) => (
          <span key={t} className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cor}`}>
            {t}
            <button onClick={() => onChange(valor.filter((v) => v !== t))} className="opacity-60 hover:opacity-100">
              ×
            </button>
          </span>
        ))}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            adicionar(novo);
          }}
        >
          <input
            list="tags-transmissao"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            onBlur={() => novo && adicionar(novo)}
            placeholder="+ etiqueta"
            className="w-32 rounded-full border border-dashed border-[#d5d8e0] bg-transparent px-2.5 py-0.5 text-[11px] outline-none focus:border-[#6366f1]"
          />
        </form>
      </div>
    </div>
  );
}

export default function InstagramTransmissoes() {
  const [contas, setContas] = useState<Conta[]>([]);
  const [lista, setLista] = useState<Transmissao[]>([]);
  const [accountId, setAccountId] = useState("");
  const [nome, setNome] = useState("");
  const [texto, setTexto] = useState("");
  const [incluir, setIncluir] = useState<string[]>([]);
  const [excluir, setExcluir] = useState<string[]>(["Comprador"]);
  const [previa, setPrevia] = useState<{ total: number; exemplos: string[] } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/transmissoes", { cache: "no-store" });
    if (!r.ok) return;
    const j = await r.json();
    setContas(j.contas);
    setLista(j.transmissoes);
    setAccountId((a) => a || j.contas[0]?.id || "");
  }, []);
  useEffect(() => {
    carregar();
    const t = setInterval(carregar, 10000);
    return () => clearInterval(t);
  }, [carregar]);

  useEffect(() => {
    setPrevia(null);
    if (!accountId) return;
    const t = setTimeout(async () => {
      const r = await fetch("/api/instagram/transmissoes/previa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, incluirTags: incluir, excluirTags: excluir }),
      });
      if (r.ok) setPrevia(await r.json());
    }, 400);
    return () => clearTimeout(t);
  }, [accountId, incluir, excluir]);

  async function enviar() {
    if (!previa || previa.total === 0 || !texto.trim()) return;
    if (!window.confirm(`Enviar esta mensagem para ${previa.total} pessoa${previa.total > 1 ? "s" : ""} agora?`)) return;
    setEnviando(true);
    setMsg(null);
    const r = await fetch("/api/instagram/transmissoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId, nome, texto, incluirTags: incluir, excluirTags: excluir }),
    });
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (r.ok) {
      setMsg({ tipo: "ok", texto: `Enviando para ${j.total} pessoa${j.total > 1 ? "s" : ""}. Acompanhe abaixo.` });
      setTexto("");
      setNome("");
      carregar();
    } else setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível enviar" });
  }

  async function cancelar(id: string) {
    await fetch(`/api/instagram/transmissoes/${id}`, { method: "DELETE" });
    carregar();
  }

  return (
    <section>
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-[#a1a5b0]">Transmissão (mensagem em massa)</p>
      <p className="mb-3 text-xs text-[#8a8f9c]">
        O Instagram só deixa mandar para quem falou com a loja nas últimas 24 horas. Escolha quem recebe pelas etiquetas: as que entram e as que ficam de fora (por exemplo, sem os
        compradores).
      </p>
      <datalist id="tags-transmissao">
        {SUGESTOES.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <div className="space-y-3 rounded-2xl border border-[#e3e5ea] p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={campo}>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                @{c.username} ({c.loja})
              </option>
            ))}
          </select>
          <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome da transmissão (só para você)" className={campo} maxLength={60} />
        </div>
        <textarea
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          rows={4}
          maxLength={900}
          placeholder="Mensagem. Use {nome} para o primeiro nome da pessoa."
          className={campo}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <EditorTags rotulo="Enviar para quem tem (qualquer uma). Vazio = todos" valor={incluir} onChange={setIncluir} cor="bg-emerald-100 text-emerald-700" />
          <EditorTags rotulo="Não enviar para quem tem" valor={excluir} onChange={setExcluir} cor="bg-red-100 text-red-700" />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-[#f7f8fa] px-3 py-2.5 text-sm">
          <span className="text-[#5a5f6d]">
            {previa === null ? "Calculando…" : previa.total === 0 ? "Ninguém nesse filtro está na janela de 24h." : `${previa.total} pessoa${previa.total > 1 ? "s" : ""} receberia${previa.total > 1 ? "m" : ""}`}
            {previa && previa.exemplos.length > 0 && <span className="text-[#a1a5b0]"> · {previa.exemplos.join(", ")}…</span>}
          </span>
          <button
            onClick={enviar}
            disabled={enviando || !previa || previa.total === 0 || !texto.trim()}
            className="rounded-lg bg-[#1b1f2b] px-4 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40"
          >
            {enviando ? "Enviando…" : "Enviar agora"}
          </button>
        </div>
        {msg && <p className={`text-xs ${msg.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.texto}</p>}
      </div>

      {lista.length > 0 && (
        <div className="mt-3 space-y-2">
          {lista.map((t) => {
            const pct = t.total ? Math.round(((t.enviadas + t.falhas) / t.total) * 100) : 0;
            return (
              <div key={t.id} className="rounded-xl border border-[#e3e5ea] p-3 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-[#1b1f2b]">{t.nome}</span>
                  <span className="text-[11px] text-[#8a8f9c]">
                    {quando(t.createdAt)} · @{t.account.username}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-[#5a5f6d]">{t.texto}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#eef0f4]">
                  <div className="h-full bg-[#6366f1]" style={{ width: `${t.status === "CONCLUIDA" ? 100 : pct}%` }} />
                </div>
                <div className="mt-1.5 flex items-center justify-between text-[11px] text-[#8a8f9c]">
                  <span>
                    {t.enviadas} enviada{t.enviadas !== 1 ? "s" : ""} de {t.total}
                    {t.falhas > 0 && <span className="text-red-600"> · {t.falhas} falha{t.falhas > 1 ? "s" : ""}</span>}
                    {" · "}
                    {t.status === "ENVIANDO" ? "enviando" : t.status === "CONCLUIDA" ? "concluída" : "cancelada"}
                  </span>
                  {t.status === "ENVIANDO" && (
                    <button onClick={() => cancelar(t.id)} className="text-red-600 hover:underline">
                      Cancelar
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
