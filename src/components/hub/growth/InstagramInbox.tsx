"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Resumo = {
  id: string;
  status: string;
  cliente: string;
  conta: string;
  loja: string;
  ultimaEm: string;
  ultima: { de: "cliente" | "equipe" | "robo"; texto: string } | null;
};
type Msg = { id: string; de: "cliente" | "equipe" | "robo"; texto: string; em: string; origem: string | null };
type Conversa = {
  id: string;
  status: string;
  cliente: string;
  conta: string;
  loja: string;
  janelaAberta: boolean;
  mensagens: Msg[];
};

const STATUS: Record<string, { rotulo: string; cor: string; ponto: string }> = {
  BOT: { rotulo: "Robô atendendo", cor: "bg-emerald-50 text-emerald-700", ponto: "bg-emerald-500" },
  NEEDS_HUMAN: { rotulo: "Aguardando atendente", cor: "bg-amber-50 text-amber-700", ponto: "bg-amber-500" },
  HUMAN: { rotulo: "Atendente na conversa", cor: "bg-sky-50 text-sky-700", ponto: "bg-sky-500" },
  CLOSED: { rotulo: "Encerrada", cor: "bg-zinc-100 text-zinc-600", ponto: "bg-zinc-400" },
};
const ORIGEM: Record<string, string> = {
  esclarecer: "pediu detalhes",
  atendente: "chamou atendente",
  saudacao: "conversa",
  faq: "resposta da base",
  pergunta: "resposta da base",
};

function quando(iso: string) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `${min} min`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} h`;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(d);
}
const hora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

const FILTROS: [string, string][] = [
  ["todas", "Todas"],
  ["NEEDS_HUMAN", "Aguardando"],
  ["BOT", "Robô"],
  ["HUMAN", "Equipe"],
];

export default function InstagramInbox() {
  const [lista, setLista] = useState<Resumo[] | null>(null);
  const [filtro, setFiltro] = useState("todas");
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  const carregarLista = useCallback(async () => {
    const r = await fetch("/api/instagram/conversas", { cache: "no-store" });
    if (r.ok) setLista((await r.json()).conversas);
  }, []);

  const carregarConversa = useCallback(async (id: string) => {
    const r = await fetch(`/api/instagram/conversas/${id}`, { cache: "no-store" });
    if (r.ok) setConversa(await r.json());
  }, []);

  useEffect(() => {
    carregarLista();
    const t = setInterval(carregarLista, 10000);
    return () => clearInterval(t);
  }, [carregarLista]);

  useEffect(() => {
    if (!selecionada) return;
    carregarConversa(selecionada);
    const t = setInterval(() => carregarConversa(selecionada), 5000);
    return () => clearInterval(t);
  }, [selecionada, carregarConversa]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [conversa?.mensagens.length, selecionada]);

  const visiveis = (lista ?? []).filter((c) => filtro === "todas" || c.status === filtro);
  const aguardando = (lista ?? []).filter((c) => c.status === "NEEDS_HUMAN").length;

  async function enviar() {
    if (!selecionada || !texto.trim() || enviando) return;
    setEnviando(true);
    setAviso(null);
    const r = await fetch(`/api/instagram/conversas/${selecionada}/responder`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto }),
    });
    setEnviando(false);
    if (!r.ok) {
      setAviso(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível enviar.");
      return;
    }
    setTexto("");
    await Promise.all([carregarConversa(selecionada), carregarLista()]);
  }

  async function mudarStatus(status: string) {
    if (!selecionada) return;
    await fetch(`/api/instagram/conversas/${selecionada}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    await Promise.all([carregarConversa(selecionada), carregarLista()]);
  }

  const st = conversa ? (STATUS[conversa.status] ?? STATUS.CLOSED) : null;

  return (
    <div className="grid h-[640px] grid-cols-1 overflow-hidden rounded-2xl border border-[#e3e5ea] bg-white md:grid-cols-[320px_1fr]">
      {/* Lista */}
      <div className={`${selecionada ? "hidden md:flex" : "flex"} min-h-0 flex-col border-r border-[#e3e5ea]`}>
        <div className="border-b border-[#e3e5ea] p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-[#1b1f2b]">Caixa de entrada</p>
            {aguardando > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                {aguardando} aguardando
              </span>
            )}
          </div>
          <div className="mt-2 flex gap-1.5">
            {FILTROS.map(([v, r]) => (
              <button
                key={v}
                onClick={() => setFiltro(v)}
                className={`rounded-full px-2.5 py-1 text-[11px] ${filtro === v ? "bg-[#1b1f2b] text-white" : "bg-[#eef0f4] text-[#5a5f6d] hover:bg-[#e3e5ea]"}`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {lista === null && <p className="p-4 text-xs text-[#8a8f9c]">Carregando…</p>}
          {lista && visiveis.length === 0 && <p className="p-4 text-xs text-[#8a8f9c]">Nenhuma conversa nesse filtro.</p>}
          {visiveis.map((c) => {
            const s = STATUS[c.status] ?? STATUS.CLOSED;
            const ativa = c.id === selecionada;
            return (
              <button
                key={c.id}
                onClick={() => setSelecionada(c.id)}
                className={`flex w-full items-start gap-3 border-b border-[#f1f2f5] px-3 py-3 text-left ${ativa ? "bg-[#f4f5ff]" : "hover:bg-[#f9fafb]"}`}
              >
                <span className="relative mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eef0f4] text-xs font-semibold text-[#5a5f6d]">
                  {c.cliente.slice(-2).toUpperCase()}
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${s.ponto}`} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-[#1b1f2b]">Cliente …{c.cliente}</span>
                    <span className="shrink-0 text-[11px] text-[#a1a5b0]">{quando(c.ultimaEm)}</span>
                  </span>
                  <span className="block truncate text-xs text-[#8a8f9c]">
                    {c.ultima ? `${c.ultima.de === "cliente" ? "" : c.ultima.de === "equipe" ? "Equipe: " : "Robô: "}${c.ultima.texto}` : "—"}
                  </span>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-[#a1a5b0]">
                    @{c.conta}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat */}
      <div className={`${selecionada ? "flex" : "hidden md:flex"} min-h-0 flex-col`}>
        {!selecionada || !conversa ? (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-[#8a8f9c]">
            {selecionada ? "Carregando conversa…" : "Escolha uma conversa à esquerda."}
          </div>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e3e5ea] px-4 py-3">
              <div className="flex items-center gap-3">
                <button onClick={() => setSelecionada(null)} className="text-xs text-[#6366f1] md:hidden">
                  ← Voltar
                </button>
                <div>
                  <p className="text-sm font-semibold text-[#1b1f2b]">Cliente …{conversa.cliente}</p>
                  <p className="text-[11px] text-[#8a8f9c]">
                    @{conversa.conta} · loja {conversa.loja}
                  </p>
                </div>
                {st && <span className={`rounded-full px-2 py-0.5 text-[11px] ${st.cor}`}>{st.rotulo}</span>}
              </div>
              <div className="flex gap-1.5">
                {conversa.status !== "HUMAN" && (
                  <button onClick={() => mudarStatus("HUMAN")} className="rounded-lg bg-[#1b1f2b] px-3 py-1.5 text-xs text-white hover:bg-black">
                    Assumir conversa
                  </button>
                )}
                {conversa.status !== "BOT" && (
                  <button onClick={() => mudarStatus("BOT")} className="rounded-lg bg-[#eef0f4] px-3 py-1.5 text-xs text-[#1b1f2b] hover:bg-[#e3e5ea]">
                    Devolver ao robô
                  </button>
                )}
                {conversa.status !== "CLOSED" && (
                  <button onClick={() => mudarStatus("CLOSED")} className="rounded-lg bg-[#eef0f4] px-3 py-1.5 text-xs text-[#1b1f2b] hover:bg-[#e3e5ea]">
                    Encerrar
                  </button>
                )}
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-[#f7f8fa] px-4 py-4">
              {conversa.mensagens.map((m) => {
                const cliente = m.de === "cliente";
                const cor = cliente
                  ? "bg-white text-[#1b1f2b] border border-[#e3e5ea]"
                  : m.de === "equipe"
                    ? "bg-[#6366f1] text-white"
                    : "bg-emerald-100 text-emerald-950";
                return (
                  <div key={m.id} className={`flex ${cliente ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${cor}`}>
                      <div className="whitespace-pre-wrap break-words">{m.texto}</div>
                      <div className={`mt-1 text-[10px] ${m.de === "equipe" ? "text-white/70" : "text-[#8a8f9c]"}`}>
                        {hora(m.em)}
                        {m.de === "robo" && ` · robô${m.origem ? ` (${ORIGEM[m.origem] ?? m.origem})` : ""}`}
                        {m.de === "equipe" && " · equipe"}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={fim} />
            </div>

            <div className="border-t border-[#e3e5ea] p-3">
              {!conversa.janelaAberta && (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Passaram mais de 24h desde a última mensagem do cliente: o Instagram não permite responder por aqui. Quando ele
                  escrever de novo, a janela reabre.
                </p>
              )}
              {aviso && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{aviso}</p>}
              <div className="flex items-end gap-2">
                <textarea
                  value={texto}
                  onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      enviar();
                    }
                  }}
                  rows={2}
                  disabled={!conversa.janelaAberta}
                  placeholder={conversa.janelaAberta ? "Escreva a resposta… (Enter envia, Shift+Enter quebra a linha)" : "Janela de 24h fechada"}
                  className="min-h-[44px] flex-1 resize-none rounded-xl border border-[#e3e5ea] px-3 py-2 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] disabled:bg-[#f4f5f7]"
                />
                <button
                  onClick={enviar}
                  disabled={enviando || !texto.trim() || !conversa.janelaAberta}
                  className="rounded-xl bg-[#6366f1] px-4 py-2.5 text-sm font-medium text-white hover:bg-[#4f52d9] disabled:opacity-40"
                >
                  {enviando ? "Enviando…" : "Enviar"}
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-[#a1a5b0]">
                Ao enviar, a conversa passa para &ldquo;Atendente na conversa&rdquo; e o robô fica quieto até você devolver.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
