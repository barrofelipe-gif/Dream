"use client";

import { useCallback, useEffect, useState } from "react";

type Conta = { id: string; username: string | null; loja: string };
type Automacao = {
  id: string;
  accountId: string;
  nome: string;
  ativo: boolean;
  midiaId: string;
  midiaLegenda: string;
  midiaThumb: string;
  palavras: string;
  modoPalavra: string;
  respostasPublicas: string;
  dmTexto: string;
  dmBotaoTitulo: string;
  dmBotaoUrl: string;
  exigirSeguir: boolean;
  seguirTexto: string;
  seguirBotao: string;
  execucoes: number;
  account: { username: string | null; loja: string };
};
type Midia = { id: string; legenda: string; tipo: string; miniatura: string | null; link: string | null; em: string | null };

const VAZIA = {
  nome: "",
  midiaId: "",
  midiaLegenda: "",
  midiaThumb: "",
  palavras: "",
  modoPalavra: "contem",
  respostasPublicas: "Te mandei no direct! 💌\nVai lá ver, te enviei agora!\nConfere seu direct, mandei tudo por lá!",
  dmTexto: "Oi! Que bom que você comentou. Aqui está o que você pediu:",
  dmBotaoTitulo: "Abrir",
  dmBotaoUrl: "",
  exigirSeguir: false,
  seguirTexto: "Para liberar, segue a gente aqui no Instagram e toca em \"Já segui\" que eu te mando agora.",
  seguirBotao: "Já segui",
};
type Form = typeof VAZIA;

function Toggle({ valor, onChange }: { valor: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!valor)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${valor ? "bg-[#6366f1]" : "bg-[#d5d8e0]"}`}
      aria-pressed={valor}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${valor ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";

function Passo({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-[#e3e5ea] p-4">
      <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#1b1f2b]">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1b1f2b] text-[11px] text-white">{n}</span>
        {titulo}
      </p>
      {children}
    </div>
  );
}

export default function InstagramAutomacoes() {
  const [lista, setLista] = useState<Automacao[] | null>(null);
  const [contas, setContas] = useState<Conta[]>([]);
  const [editando, setEditando] = useState<{ id: string | null; contaId: string; form: Form } | null>(null);
  const [midias, setMidias] = useState<Midia[] | null>(null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/automacoes", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      setLista(j.automacoes);
      setContas(j.contas);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setEditando((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));
    setMsg(null);
  };

  function nova() {
    setMsg(null);
    setMidias(null);
    setEscolhendo(false);
    setEditando({ id: null, contaId: contas[0]?.id ?? "", form: { ...VAZIA } });
  }
  function editar(a: Automacao) {
    setMsg(null);
    setMidias(null);
    setEscolhendo(false);
    const { nome, midiaId, midiaLegenda, midiaThumb, palavras, modoPalavra, respostasPublicas, dmTexto, dmBotaoTitulo, dmBotaoUrl, exigirSeguir, seguirTexto, seguirBotao } = a;
    setEditando({
      id: a.id,
      contaId: a.accountId,
      form: { nome, midiaId, midiaLegenda, midiaThumb, palavras, modoPalavra, respostasPublicas, dmTexto, dmBotaoTitulo, dmBotaoUrl, exigirSeguir, seguirTexto: seguirTexto || VAZIA.seguirTexto, seguirBotao },
    });
  }

  async function abrirMidias() {
    if (!editando) return;
    setEscolhendo(true);
    setMidias(null);
    const r = await fetch(`/api/instagram/midias?conta=${editando.contaId}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) setMidias(j.midias);
    else {
      setMidias([]);
      setMsg({ tipo: "erro", texto: j.error ?? "Não consegui buscar as publicações." });
    }
  }

  async function salvar(ativar: boolean) {
    if (!editando) return;
    setSalvando(true);
    const nome = editando.form.nome.trim() || `Comentário${editando.form.palavras ? ` ${editando.form.palavras.split(",")[0].trim().toUpperCase()}` : ""}`;
    const dados = { ...editando.form, nome, ativo: ativar };
    const r = await fetch(editando.id ? `/api/instagram/automacoes/${editando.id}` : "/api/instagram/automacoes", {
      method: editando.id ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...dados, accountId: editando.contaId }),
    });
    setSalvando(false);
    if (r.ok) {
      setEditando(null);
      await carregar();
    } else {
      setMsg({ tipo: "erro", texto: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível salvar." });
    }
  }

  async function alternar(a: Automacao) {
    await fetch(`/api/instagram/automacoes/${a.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ soAtivo: true, ativo: !a.ativo }),
    });
    await carregar();
  }
  async function excluir(a: Automacao) {
    if (!confirm(`Excluir a automação "${a.nome}"? Isso não pode ser desfeito.`)) return;
    await fetch(`/api/instagram/automacoes/${a.id}`, { method: "DELETE" });
    await carregar();
  }

  // ───────── Editor ─────────
  if (editando) {
    const f = editando.form;
    const conta = contas.find((c) => c.id === editando.contaId);
    const variante = f.respostasPublicas.split("\n").map((v) => v.trim()).filter(Boolean)[0];
    const palavraExemplo = f.palavras.split(",")[0]?.trim() || "eu quero";
    return (
      <section className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-base font-semibold text-[#1b1f2b]">{editando.id ? "Editar automação" : "Nova automação"}</p>
            <p className="text-xs text-[#8a8f9c]">Comentário na publicação → resposta pública + mensagem no direct.</p>
          </div>
          <button onClick={() => setEditando(null)} className="text-xs text-[#8a8f9c] hover:text-[#1b1f2b]">
            ✕ Fechar
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={f.nome} onChange={(e) => set("nome", e.target.value)} placeholder="Nome da automação (ex: Link do catálogo)" className={campo} />
              {contas.length > 1 && (
                <select value={editando.contaId} onChange={(e) => setEditando({ ...editando, contaId: e.target.value })} className={campo}>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      @{c.username} ({c.loja})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <Passo n={1} titulo="Quando alguém comentar…">
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={f.midiaId === ""} onChange={() => { set("midiaId", ""); set("midiaLegenda", ""); set("midiaThumb", ""); }} /> Em qualquer publicação ou reel
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={f.midiaId !== ""} onChange={abrirMidias} /> Em uma publicação ou reel específico
                </label>
                {f.midiaId && (
                  <div className="flex items-center gap-3 rounded-lg bg-[#f7f8fa] p-2">
                    {f.midiaThumb && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.midiaThumb} alt="" referrerPolicy="no-referrer" className="h-14 w-14 rounded-lg object-cover" />
                    )}
                    <p className="min-w-0 flex-1 truncate text-xs text-[#5a5f6d]">{f.midiaLegenda || f.midiaId}</p>
                    <button onClick={abrirMidias} className="text-xs text-[#6366f1] hover:underline">Trocar</button>
                  </div>
                )}
                {escolhendo && (
                  <div className="rounded-xl border border-[#e3e5ea] p-3">
                    {midias === null && <p className="text-xs text-[#8a8f9c]">Buscando suas publicações…</p>}
                    {midias && midias.length === 0 && <p className="text-xs text-[#8a8f9c]">Nenhuma publicação encontrada.</p>}
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                      {(midias ?? []).map((m) => (
                        <button
                          key={m.id}
                          onClick={() => {
                            set("midiaId", m.id);
                            set("midiaLegenda", m.legenda);
                            set("midiaThumb", m.miniatura ?? "");
                            setEscolhendo(false);
                          }}
                          className="group relative overflow-hidden rounded-lg border border-[#e3e5ea] text-left hover:border-[#6366f1]"
                        >
                          {m.miniatura ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.miniatura} alt="" referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />
                          ) : (
                            <div className="flex aspect-square items-center justify-center bg-[#eef0f4] text-[10px] text-[#8a8f9c]">{m.tipo}</div>
                          )}
                          <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">{m.tipo}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Passo>

            <Passo n={2} titulo="E o comentário tiver…">
              <div className="space-y-2 text-sm">
                <label className="flex items-center gap-2">
                  <input type="radio" checked={f.palavras === ""} onChange={() => set("palavras", "")} /> Qualquer comentário
                </label>
                <label className="flex items-center gap-2">
                  <input type="radio" checked={f.palavras !== ""} onChange={() => set("palavras", f.palavras || "QUERO")} /> Uma ou mais palavras
                </label>
                {f.palavras !== "" && (
                  <>
                    <input value={f.palavras} onChange={(e) => set("palavras", e.target.value)} placeholder="QUERO, PREÇO, CATÁLOGO" className={campo} />
                    <p className="text-[11px] text-[#a1a5b0]">Separe várias palavras por vírgula. Não diferencia maiúsculas de minúsculas.</p>
                    <div className="flex gap-4 text-xs text-[#5a5f6d]">
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={f.modoPalavra === "contem"} onChange={() => set("modoPalavra", "contem")} /> Contém a palavra
                      </label>
                      <label className="flex items-center gap-1.5">
                        <input type="radio" checked={f.modoPalavra === "exata"} onChange={() => set("modoPalavra", "exata")} /> É exatamente a palavra
                      </label>
                    </div>
                  </>
                )}
              </div>
            </Passo>

            <Passo n={3} titulo="Responder o comentário em público (opcional)">
              <textarea value={f.respostasPublicas} onChange={(e) => set("respostasPublicas", e.target.value)} rows={4} className={campo} />
              <p className="mt-1 text-[11px] text-[#a1a5b0]">Uma resposta por linha: o sistema sorteia uma. Deixe vazio para não responder em público. Varie o texto: o Instagram desconfia de respostas idênticas.</p>
            </Passo>

            <Passo n={4} titulo="Enviar esta mensagem no direct">
              <textarea value={f.dmTexto} onChange={(e) => set("dmTexto", e.target.value)} rows={4} className={campo} />
              <div className="mt-2 grid gap-2 sm:grid-cols-[160px_1fr]">
                <input value={f.dmBotaoTitulo} maxLength={20} onChange={(e) => set("dmBotaoTitulo", e.target.value)} placeholder="Texto do botão" className={campo} />
                <input value={f.dmBotaoUrl} onChange={(e) => set("dmBotaoUrl", e.target.value)} placeholder="https://… (link do botão, opcional)" className={campo} />
              </div>
            </Passo>

            <Passo n={5} titulo="Pedir para seguir antes de liberar">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[#8a8f9c]">A pessoa recebe primeiro o pedido para seguir, toca em &ldquo;Já segui&rdquo; e o sistema confere antes de enviar a mensagem do passo 4.</p>
                <Toggle valor={f.exigirSeguir} onChange={(v) => set("exigirSeguir", v)} />
              </div>
              {f.exigirSeguir && (
                <div className="mt-3 space-y-2">
                  <textarea value={f.seguirTexto} onChange={(e) => set("seguirTexto", e.target.value)} rows={2} className={campo} />
                  <input value={f.seguirBotao} maxLength={20} onChange={(e) => set("seguirBotao", e.target.value)} className={campo} />
                  <p className="text-[11px] text-[#a1a5b0]">Se o Instagram não informar se a pessoa segue, o sistema libera (não prende quem já segue).</p>
                </div>
              )}
            </Passo>

            {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
            <div className="flex flex-wrap gap-2">
              <button onClick={() => salvar(true)} disabled={salvando} className="rounded-xl bg-[#6366f1] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-50">
                {salvando ? "Salvando…" : "Salvar e ativar"}
              </button>
              <button onClick={() => salvar(false)} disabled={salvando} className="rounded-xl bg-[#eef0f4] px-5 py-2.5 text-sm font-medium text-[#1b1f2b] hover:bg-[#e3e5ea] disabled:opacity-50">
                Salvar desligada
              </button>
            </div>
          </div>

          {/* Prévia */}
          <div className="flex justify-center">
            <div className="w-[280px] rounded-[2.2rem] bg-[#0b0c10] p-3 shadow-xl">
              <div className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-[#2a2c35]" />
              <div className="rounded-[1.6rem] bg-[#12131a] p-3" style={{ minHeight: 480 }}>
                <p className="mb-2 text-center text-[10px] uppercase tracking-wide text-[#7d8190]">Na publicação</p>
                <div className="space-y-2 text-[12px] leading-snug">
                  <div className="rounded-xl bg-[#1d1f28] px-3 py-2 text-[#e9eaf0]">
                    <p className="text-[10px] text-[#7d8190]">@cliente</p>
                    <p>{palavraExemplo}</p>
                  </div>
                  {variante && (
                    <div className="ml-4 rounded-xl bg-[#1d1f28] px-3 py-2 text-[#e9eaf0]">
                      <p className="text-[10px] text-[#7d8190]">@{conta?.username ?? "sua_loja"}</p>
                      <p>{variante}</p>
                    </div>
                  )}
                  <p className="pt-2 text-center text-[10px] uppercase tracking-wide text-[#7d8190]">No direct</p>
                  {f.exigirSeguir ? (
                    <>
                      <div className="max-w-[90%] rounded-2xl bg-[#262833] px-3 py-2 text-[#e9eaf0]">{f.seguirTexto}</div>
                      <div className="max-w-[60%] rounded-lg bg-[#343644] px-3 py-1.5 text-center text-[11px] font-medium text-white">{f.seguirBotao || "Já segui"}</div>
                      <div className="flex justify-end"><div className="rounded-2xl bg-[#6366f1] px-3 py-1.5 text-white">{f.seguirBotao || "Já segui"}</div></div>
                    </>
                  ) : null}
                  <div className="max-w-[90%] rounded-2xl bg-[#262833] px-3 py-2 text-[#e9eaf0]">
                    <p className="whitespace-pre-wrap">{f.dmTexto.replaceAll("{nome}", "Maria")}</p>
                    {f.dmBotaoUrl && <div className="mt-2 rounded-lg bg-[#343644] px-3 py-1.5 text-center text-[11px] font-medium">{f.dmBotaoTitulo || "Abrir"}</div>}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  // ───────── Lista ─────────
  return (
    <section className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-base font-semibold text-[#1b1f2b]">Automações</p>
          <p className="text-xs text-[#8a8f9c]">Quando alguém comenta numa publicação, responde em público e manda a mensagem no direct (com pedido para seguir, se quiser).</p>
        </div>
        <button onClick={nova} disabled={!contas.length} className="rounded-xl bg-[#6366f1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-40">
          + Nova automação
        </button>
      </div>

      {lista === null && <p className="py-6 text-center text-sm text-[#8a8f9c]">Carregando…</p>}
      {lista && lista.length === 0 && (
        <div className="rounded-xl border border-dashed border-[#d5d8e0] p-8 text-center">
          <p className="text-sm font-medium text-[#1b1f2b]">Nenhuma automação ainda</p>
          <p className="mt-1 text-xs text-[#8a8f9c]">Crie a primeira: por exemplo, quem comentar &ldquo;QUERO&rdquo; recebe o link do catálogo no direct.</p>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {(lista ?? []).map((a) => (
          <div key={a.id} className="min-w-0 rounded-xl border border-[#e3e5ea] p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#1b1f2b]">{a.nome}</p>
                <p className="text-[11px] text-[#8a8f9c]">@{a.account.username} · loja {a.account.loja}</p>
              </div>
              <Toggle valor={a.ativo} onChange={() => alternar(a)} />
            </div>
            <p className="mt-3 text-xs text-[#5a5f6d]">
              Comentário em {a.midiaId ? "uma publicação específica" : "qualquer publicação"}
              {a.palavras ? ` com: ${a.palavras}` : " (qualquer texto)"}
            </p>
            <p className="mt-1 truncate text-xs text-[#8a8f9c]">{a.dmTexto}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className={`rounded-full px-2 py-0.5 font-medium ${a.ativo ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>{a.ativo ? "Ativa" : "Desligada"}</span>
              {a.exigirSeguir && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-700">Pede para seguir</span>}
              <span className="text-[#8a8f9c]">{a.execucoes} {a.execucoes === 1 ? "execução" : "execuções"}</span>
              <span className="ml-auto flex gap-3">
                <button onClick={() => editar(a)} className="min-h-[36px] px-1 text-[#6366f1] hover:underline">Editar</button>
                <button onClick={() => excluir(a)} className="min-h-[36px] px-1 text-red-600 hover:underline">Excluir</button>
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
