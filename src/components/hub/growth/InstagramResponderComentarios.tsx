"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Rede = "instagram" | "facebook" | "youtube";
type Resposta = { autor: string; texto: string; em: string; nossa: boolean };
type Comentario = {
  rede: Rede;
  loja: string;
  contaId: string;
  contaNome: string;
  id: string;
  texto: string;
  autor: string;
  em: string;
  oculto: boolean;
  podeOcultar: boolean;
  respondido: boolean;
  respostas: Resposta[];
  post: { id: string; legenda: string; miniatura: string | null; link: string | null };
};
type ContaStatus = { contaId: string; rede: Rede; loja: string; nome: string; ler: boolean; responder: boolean; aviso?: string };
type Rascunho = { texto: string; daIa: boolean; observacao: string; gerando: boolean; enviando: boolean; erro: string };

const ROTULO: Record<Rede, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube" };
const LOJA: Record<string, string> = { bff: "BFF", moranga: "Moranga" };
const RASCUNHO_VAZIO: Rascunho = { texto: "", daIa: false, observacao: "", gerando: false, enviando: false, erro: "" };
const chave = (c: Comentario) => `${c.rede}:${c.contaId}:${c.id}`;

const fmt = (s: string) => {
  const d = new Date(s);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(d);
};

const botao = "rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50";
const seletor = "rounded-lg border border-[#e3e5ea] bg-white px-2.5 py-1.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1]";

async function postar<T>(url: string, corpo: unknown): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error ?? `Erro ${r.status}`);
  return j;
}

/** Aba "Responder comentários": lê os comentários das publicações e responde com a IA ou à mão. Nada sai sem o clique em Enviar. */
export default function InstagramResponderComentarios() {
  const [loja, setLoja] = useState("");
  const [rede, setRede] = useState("");
  const [soPendentes, setSoPendentes] = useState(true);
  const [dados, setDados] = useState<{ comentarios: Comentario[]; contas: ContaStatus[] } | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [rascunhos, setRascunhos] = useState<Record<string, Rascunho>>({});
  const [aviso, setAviso] = useState("");
  const [erroOcultar, setErroOcultar] = useState<Record<string, string>>({});
  // Só a busca mais recente vale: trocar de BFF para Moranga no meio não mistura as listas.
  const buscaAtual = useRef(0);
  // Geração da IA em andamento por comentário: cancelar ou pedir outra invalida a anterior.
  const geracao = useRef<Record<string, number>>({});

  const carregar = useCallback(async () => {
    const minha = ++buscaAtual.current;
    setCarregando(true);
    setErro("");
    setDados(null);
    try {
      const qs = new URLSearchParams();
      if (loja) qs.set("loja", loja);
      if (rede) qs.set("rede", rede);
      const r = await fetch(`/api/social/comentarios?${qs}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (minha !== buscaAtual.current) return;
      if (!r.ok) throw new Error(j.error ?? `Erro ${r.status}`);
      setDados(j);
    } catch (e) {
      if (minha === buscaAtual.current) setErro(e instanceof Error ? e.message : "Falha ao carregar.");
    } finally {
      if (minha === buscaAtual.current) setCarregando(false);
    }
  }, [loja, rede]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const mudar = (k: string, p: Partial<Rascunho>) =>
    setRascunhos((r) => ({ ...r, [k]: { ...(r[k] ?? RASCUNHO_VAZIO), ...p } }));

  async function gerar(c: Comentario) {
    const k = chave(c);
    const minha = (geracao.current[k] = (geracao.current[k] ?? 0) + 1);
    mudar(k, { gerando: true, erro: "" });
    try {
      const s = await postar<{ resposta: string; observacao: string }>("/api/social/comentarios/sugerir", {
        rede: c.rede,
        contaId: c.contaId,
        autor: c.autor,
        texto: c.texto,
        legenda: c.post.legenda,
        respostas: c.respostas.map((r) => r.texto),
      });
      if (geracao.current[k] !== minha) return; // cancelada ou substituída
      mudar(k, { texto: s.resposta, daIa: true, observacao: s.observacao, gerando: false });
    } catch (e) {
      if (geracao.current[k] !== minha) return;
      mudar(k, { gerando: false, erro: e instanceof Error ? e.message : "Falha na IA." });
    }
  }

  async function enviar(c: Comentario) {
    const k = chave(c);
    const texto = rascunhos[k]?.texto.trim() ?? "";
    if (!texto || rascunhos[k]?.enviando) return;
    mudar(k, { enviando: true, erro: "" });
    try {
      await postar("/api/social/comentarios/responder", { rede: c.rede, contaId: c.contaId, comentarioId: c.id, texto });
      setDados((d) =>
        d && {
          ...d,
          comentarios: d.comentarios.map((x) =>
            chave(x) === k ? { ...x, respondido: true, respostas: [...x.respostas, { autor: "nós", texto, em: new Date().toISOString(), nossa: true }] } : x,
          ),
        },
      );
      setRascunhos((r) => {
        const n = { ...r };
        delete n[k];
        return n;
      });
      setAviso(`Resposta enviada no ${ROTULO[c.rede]}.`);
    } catch (e) {
      mudar(k, { enviando: false, erro: e instanceof Error ? e.message : "Falha ao enviar." });
    }
  }

  async function ocultar(c: Comentario) {
    const k = chave(c);
    const novo = !c.oculto;
    if (novo && !window.confirm("Ocultar este comentário? Ele some para o público, mas não é apagado. Dá para mostrar de novo depois.")) return;
    setErroOcultar((x) => ({ ...x, [k]: "" }));
    try {
      await postar("/api/social/comentarios/ocultar", { rede: c.rede, contaId: c.contaId, comentarioId: c.id, ocultar: novo });
      setDados((d) => d && { ...d, comentarios: d.comentarios.map((x) => (chave(x) === k ? { ...x, oculto: novo } : x)) });
    } catch (e) {
      setErroOcultar((x) => ({ ...x, [k]: e instanceof Error ? e.message : "Falha ao ocultar." }));
    }
  }

  const statusPorConta = new Map((dados?.contas ?? []).map((s) => [`${s.rede}:${s.contaId}`, s]));
  const lista = (dados?.comentarios ?? []).filter((c) => !soPendentes || !c.respondido);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-[#1b1f2b]">Responder comentários</p>
        <p className="mt-0.5 text-xs text-[#8a8f9c]">
          Comentários das publicações, mais novos primeiro. A IA sugere, você lê e corrige. Nada é publicado antes de você clicar em Enviar resposta.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className={seletor} value={loja} onChange={(e) => setLoja(e.target.value)} aria-label="Loja">
          <option value="">Todas as lojas</option>
          <option value="bff">BFF</option>
          <option value="moranga">Moranga</option>
        </select>
        <select className={seletor} value={rede} onChange={(e) => setRede(e.target.value)} aria-label="Rede">
          <option value="">Todas as redes</option>
          <option value="instagram">Instagram</option>
          <option value="facebook">Facebook</option>
          <option value="youtube">YouTube</option>
        </select>
        <label className="flex items-center gap-1.5 text-sm text-[#5a5f6d]">
          <input type="checkbox" checked={soPendentes} onChange={(e) => setSoPendentes(e.target.checked)} />
          Só sem resposta nossa
        </label>
        <button onClick={carregar} disabled={carregando} className={`${botao} border border-[#e3e5ea] text-[#5a5f6d] hover:bg-[#f4f5f8]`}>
          {carregando ? "Carregando…" : "Atualizar"}
        </button>
      </div>

      {dados && dados.contas.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {dados.contas.map((s) => (
            <span
              key={`${s.rede}:${s.contaId}`}
              title={s.aviso ?? ""}
              className={`rounded-full px-2.5 py-1 text-[11px] ${
                !s.ler ? "bg-red-50 text-red-700" : s.responder ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"
              }`}
            >
              {ROTULO[s.rede]} · {s.nome} ({LOJA[s.loja] ?? s.loja}): {!s.ler ? "não leu" : s.responder ? "lê e responde" : "só lê"}
            </span>
          ))}
        </div>
      )}
      {dados?.contas
        .filter((s) => s.aviso)
        .map((s) => (
          <p key={`av-${s.rede}:${s.contaId}`} className="text-xs text-amber-800">
            {ROTULO[s.rede]} {s.nome}: {s.aviso}
          </p>
        ))}
      {dados && dados.contas.length === 0 && (
        <p className="rounded-xl border border-dashed border-[#e3e5ea] p-3 text-sm text-[#8a8f9c]">Nenhuma conta conectada para este filtro.</p>
      )}

      {erro && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{erro}</p>}
      {aviso && (
        <p className="flex items-center justify-between rounded-xl bg-emerald-50 p-3 text-sm text-emerald-700">
          {aviso}
          <button onClick={() => setAviso("")} className="text-xs underline">
            fechar
          </button>
        </p>
      )}

      {carregando && !dados && <p className="text-sm text-[#8a8f9c]">Buscando comentários nas redes…</p>}
      {dados && lista.length === 0 && !carregando && (
        <p className="rounded-xl border border-[#e3e5ea] p-3 text-sm text-[#8a8f9c]">
          {soPendentes ? "Nenhum comentário esperando resposta." : "Nenhum comentário recente."}
        </p>
      )}

      <div className="space-y-3">
        {lista.map((c) => {
          const k = chave(c);
          const r = rascunhos[k];
          const st = statusPorConta.get(`${c.rede}:${c.contaId}`);
          const podeResponder = st?.responder ?? false;
          return (
            <div key={k} className={`rounded-xl border p-3 ${c.oculto ? "border-dashed border-[#d5d8e0] bg-[#f9fafb]" : "border-[#e3e5ea]"}`}>
              <div className="flex gap-3">
                {c.post.link ? (
                  <a href={c.post.link} target="_blank" rel="noreferrer" className="shrink-0" title="Abrir a publicação">
                    {c.post.miniatura ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={c.post.miniatura} alt="" className="h-14 w-14 rounded-lg object-cover" />
                    ) : (
                      <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-[#f4f5f8] text-[10px] text-[#8a8f9c]">post</span>
                    )}
                  </a>
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#8a8f9c]">
                    <span className="font-medium text-[#1b1f2b]">{c.rede === "instagram" ? `@${c.autor}` : c.autor}</span>
                    <span>{fmt(c.em)}</span>
                    <span>
                      {ROTULO[c.rede]} · {LOJA[c.loja] ?? c.loja}
                    </span>
                    {c.respondido && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">respondido</span>}
                    {c.oculto && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">oculto</span>}
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[#1b1f2b]">{c.texto || "(sem texto)"}</p>
                  {c.post.legenda && <p className="mt-1 line-clamp-1 text-[11px] text-[#a1a5b0]">Post: {c.post.legenda}</p>}
                  {c.respostas.length > 0 && (
                    <div className="mt-2 space-y-1 border-l-2 border-[#e3e5ea] pl-2">
                      {c.respostas.map((y, i) => (
                        <p key={i} className="text-xs text-[#5a5f6d]">
                          <span className={y.nossa ? "font-medium text-[#4f46e5]" : "font-medium"}>{y.nossa ? "Nós" : y.autor || "alguém"}:</span> {y.texto}
                        </p>
                      ))}
                    </div>
                  )}

                  {r ? (
                    <div className="mt-2 space-y-2">
                      {r.daIa && (
                        <p className="text-[11px] text-amber-800">Texto da IA: leia e corrija antes de enviar.{r.observacao ? ` Nota: ${r.observacao}` : ""}</p>
                      )}
                      <textarea
                        value={r.texto}
                        onChange={(e) => mudar(k, { texto: e.target.value })}
                        rows={3}
                        readOnly={r.gerando}
                        placeholder={r.gerando ? "A IA está escrevendo…" : "Escreva a resposta…"}
                        className="w-full rounded-xl border border-[#e3e5ea] px-3 py-2 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => enviar(c)}
                          disabled={!r.texto.trim() || r.enviando || r.gerando || !podeResponder}
                          className={`${botao} bg-[#1b1f2b] text-white hover:bg-black`}
                        >
                          {r.enviando ? "Enviando…" : "Enviar resposta"}
                        </button>
                        <button onClick={() => gerar(c)} disabled={r.gerando || r.enviando} className={`${botao} border border-[#e3e5ea] text-[#5a5f6d] hover:bg-[#f4f5f8]`}>
                          {r.gerando ? "Escrevendo…" : r.daIa ? "Outra sugestão" : "Responder com IA"}
                        </button>
                        <button
                          onClick={() => {
                            geracao.current[k] = (geracao.current[k] ?? 0) + 1;
                            setRascunhos((x) => {
                              const n = { ...x };
                              delete n[k];
                              return n;
                            });
                          }}
                          disabled={r.enviando}
                          className={`${botao} text-[#8a8f9c] hover:text-[#1b1f2b]`}
                        >
                          Cancelar
                        </button>
                        <span className="text-[11px] text-[#a1a5b0]">{r.texto.length} caracteres</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button onClick={() => gerar(c)} className={`${botao} bg-[#eef0ff] text-[#4f46e5] hover:bg-[#e2e5ff]`}>
                        Responder com IA
                      </button>
                      <button onClick={() => mudar(k, {})} className={`${botao} border border-[#e3e5ea] text-[#5a5f6d] hover:bg-[#f4f5f8]`}>
                        Escrever resposta
                      </button>
                      {c.podeOcultar && (
                        <button onClick={() => ocultar(c)} className={`${botao} text-[#8a8f9c] hover:text-[#1b1f2b]`}>
                          {c.oculto ? "Mostrar de novo" : "Ocultar"}
                        </button>
                      )}
                    </div>
                  )}
                  {r?.erro && <p className="mt-1 text-xs text-red-700">{r.erro}</p>}
                  {erroOcultar[k] && <p className="mt-1 text-xs text-red-700">{erroOcultar[k]}</p>}
                  {!podeResponder && st?.ler && <p className="mt-1 text-[11px] text-amber-800">{st.aviso ?? "Esta conta ainda não responde pelo painel."}</p>}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
