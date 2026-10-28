"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  aplicarVariaveis,
  avaliarCondicao,
  BLOCOS,
  descreverAtraso,
  descreverCondicao,
  descreverGatilho,
  grafoInicial,
  MAX_BOTOES,
  MAX_PASSOS,
  nomeVariavel,
  noGatilho,
  novoId,
  novoNo,
  problemasParaAtivar,
  proximoNo,
  saidasDe,
  type DadosAtendente,
  type DadosAtraso,
  type DadosCondicao,
  type DadosEtiqueta,
  type DadosGatilho,
  type DadosIrPara,
  type DadosMensagem,
  type DadosPergunta,
  type Grafo,
  type No,
  type TipoNo,
} from "@/lib/igFluxosModelo";
import ModelosFluxo, { type Modelo } from "@/components/hub/growth/InstagramModelos";

type Conta = { id: string; username: string | null; loja: string };
type Fluxo = {
  id: string;
  accountId: string;
  nome: string;
  ativo: boolean;
  gatilho: DadosGatilho | Record<string, never>;
  grafo: Grafo;
  updatedAt: string;
  stats: Record<string, number>;
  account: { username: string | null; loja: string };
};
type Midia = { id: string; legenda: string; tipo: string; miniatura: string | null };

// ───────── Medidas fixas dos blocos (as posições das bolinhas de ligação saem daqui) ─────────
const LARG = 240;
const CAB = 36;
const PREV = 52;
const LINHA = 26;
const altura = (n: No) => CAB + PREV + saidasDe(n).length * LINHA + 8;
const pontoEntrada = (n: No) => ({ x: n.x, y: n.y + CAB / 2 });
const pontoSaida = (n: No, i: number) => ({ x: n.x + LARG, y: n.y + CAB + PREV + i * LINHA + LINHA / 2 });
const curva = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = Math.max(50, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
};

const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";
const rotulo = "mb-1 block text-[11px] font-medium uppercase tracking-wide text-[#8a8f9c]";

function Toggle({ valor, onChange, disabled }: { valor: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!valor)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${valor ? "bg-[#6366f1]" : "bg-[#d5d8e0]"}`}
      aria-pressed={valor}
    >
      <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${valor ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

/** Texto curto que aparece dentro do bloco no canvas. */
function resumo(n: No, fluxos: Fluxo[]): string {
  switch (n.tipo) {
    case "gatilho":
      return descreverGatilho(n.dados as DadosGatilho);
    case "mensagem": {
      const d = n.dados as DadosMensagem;
      return (d.texto || "(sem texto)") + (d.botoesTipo === "link" ? `  🔗 ${d.link.titulo || "Abrir"}` : "");
    }
    case "pergunta": {
      const d = n.dados as DadosPergunta;
      return `${d.texto || "(sem texto)"}  → {${d.variavel}}`;
    }
    case "condicao":
      return descreverCondicao(n.dados as DadosCondicao);
    case "atraso":
      return `Espera ${descreverAtraso(n.dados as DadosAtraso)}`;
    case "etiqueta": {
      const d = n.dados as DadosEtiqueta;
      return `${d.acao === "adicionar" ? "Adiciona" : "Remove"}: ${d.etiquetas || "…"}`;
    }
    case "atendente":
      return "Marca a conversa para a equipe (aguardando, não lida)";
    case "irpara": {
      const d = n.dados as DadosIrPara;
      return `Vai para: ${fluxos.find((f) => f.id === d.fluxoId)?.nome ?? "(escolha o fluxo)"}`;
    }
    case "fim":
      return "Encerra o fluxo";
  }
}

// ═════════════════════════════ Simulador ═════════════════════════════

type Bolha = { de: "bot" | "cliente" | "sistema"; texto: string; botoes?: string[]; link?: string };
type Sim = {
  bolhas: Bolha[];
  vars: Record<string, unknown>;
  tags: string[];
  fluxoId: string;
  grafo: Grafo;
  esperando: { noId: string; tipo: "botoes" | "pergunta" } | null;
  terminou: boolean;
};

function simTexto(t: string, vars: Record<string, unknown>) {
  return aplicarVariaveis(t.replace(/\{nome\}/g, "Maria"), vars);
}

/** Percorre o grafo no navegador, sem enviar nada. */
function simRodar(s: Sim, inicio: string | null, segue: boolean, fluxos: Fluxo[]): Sim {
  const r: Sim = { ...s, bolhas: [...s.bolhas], vars: { ...s.vars }, tags: [...s.tags], esperando: null };
  let noId = inicio;
  let passos = 0;
  while (noId) {
    const no = r.grafo.nos.find((n) => n.id === noId);
    if (!no) break;
    if (++passos > MAX_PASSOS) {
      r.bolhas.push({ de: "sistema", texto: `⛔ Parou: passou de ${MAX_PASSOS} blocos seguidos (laço?).` });
      r.terminou = true;
      return r;
    }
    switch (no.tipo) {
      case "gatilho":
        noId = proximoNo(r.grafo, no.id, "proximo");
        break;
      case "mensagem": {
        const d = no.dados as DadosMensagem;
        const botoes = d.botoesTipo === "rapidos" ? d.botoes.map((b) => b.titulo.trim()).filter(Boolean) : [];
        r.bolhas.push({ de: "bot", texto: simTexto(d.texto, r.vars), botoes, link: d.botoesTipo === "link" ? d.link.titulo || "Abrir" : undefined });
        if (botoes.length) {
          r.esperando = { noId: no.id, tipo: "botoes" };
          return r;
        }
        noId = proximoNo(r.grafo, no.id, "proximo");
        break;
      }
      case "pergunta": {
        const d = no.dados as DadosPergunta;
        r.bolhas.push({ de: "bot", texto: simTexto(d.texto, r.vars), botoes: d.sugestoes.map((b) => b.titulo.trim()).filter(Boolean) });
        r.esperando = { noId: no.id, tipo: "pergunta" };
        return r;
      }
      case "condicao": {
        const d = no.dados as DadosCondicao;
        const ok = avaliarCondicao(d, { tags: r.tags, variaveis: r.vars, seguePagina: segue, ultimoTexto: String(r.vars._ultimoTexto ?? "") });
        r.bolhas.push({ de: "sistema", texto: `${descreverCondicao(d)} → ${ok ? "Sim" : "Não"}` });
        noId = proximoNo(r.grafo, no.id, ok ? "sim" : "nao");
        break;
      }
      case "atraso":
        r.bolhas.push({ de: "sistema", texto: `⏱ Espera ${descreverAtraso(no.dados as DadosAtraso)} (pulado na simulação)` });
        noId = proximoNo(r.grafo, no.id, "proximo");
        break;
      case "etiqueta": {
        const d = no.dados as DadosEtiqueta;
        const lista = d.etiquetas.split(",").map((t) => t.trim()).filter(Boolean);
        r.tags = d.acao === "adicionar" ? [...new Set([...r.tags, ...lista])] : r.tags.filter((t) => !lista.includes(t));
        r.bolhas.push({ de: "sistema", texto: `🏷 ${d.acao === "adicionar" ? "Adicionou" : "Removeu"}: ${lista.join(", ") || "—"}` });
        noId = proximoNo(r.grafo, no.id, "proximo");
        break;
      }
      case "atendente": {
        const d = no.dados as DadosAtendente;
        if (d.texto.trim()) r.bolhas.push({ de: "bot", texto: simTexto(d.texto, r.vars) });
        r.bolhas.push({ de: "sistema", texto: "🙋 Conversa passada para a equipe (aguardando atendente, não lida)" });
        noId = proximoNo(r.grafo, no.id, "proximo");
        break;
      }
      case "irpara": {
        const alvo = fluxos.find((f) => f.id === (no.dados as DadosIrPara).fluxoId);
        if (!alvo) {
          r.bolhas.push({ de: "sistema", texto: "↪ Ir para outro fluxo: nenhum fluxo escolhido" });
          noId = null;
          break;
        }
        r.bolhas.push({ de: "sistema", texto: `↪ Continua no fluxo "${alvo.nome}"` });
        r.fluxoId = alvo.id;
        r.grafo = alvo.grafo;
        const g = noGatilho(alvo.grafo);
        noId = g ? proximoNo(alvo.grafo, g.id, "proximo") : null;
        break;
      }
      case "fim":
        noId = null;
        break;
    }
  }
  r.bolhas.push({ de: "sistema", texto: "✔ Fim do fluxo" });
  r.terminou = true;
  return r;
}

function simInicial(grafo: Grafo, fluxoId: string, fluxos: Fluxo[], segue: boolean, tagsTexto: string): Sim {
  const g = noGatilho(grafo);
  const d = g?.dados;
  const primeira = d?.tipo === "palavra" || d?.tipo === "comentario" || d?.tipo === "story" ? d.palavras.split(",")[0]?.trim() : "";
  const entrada =
    d?.tipo === "comentario"
      ? `[Comentou] ${primeira || "Quero!"}`
      : d?.tipo === "story"
        ? primeira || "[Respondeu o story]"
        : d?.tipo === "etiqueta"
          ? null
          : d?.tipo === "postback"
            ? `[Tocou no menu: ${d.payload}]`
            : primeira || "Oi";
  const base: Sim = {
    bolhas: entrada ? [{ de: "cliente", texto: entrada }] : [{ de: "sistema", texto: `🏷 Etiqueta "${d?.tipo === "etiqueta" ? d.etiqueta : ""}" aplicada` }],
    vars: { _ultimoTexto: entrada ?? "", mensagem: entrada ?? "" },
    tags: tagsTexto.split(",").map((t) => t.trim()).filter(Boolean),
    fluxoId,
    grafo,
    esperando: null,
    terminou: false,
  };
  return g ? simRodar(base, g.id, segue, fluxos) : { ...base, terminou: true, bolhas: [{ de: "sistema", texto: "Fluxo sem gatilho" }] };
}

function Simulador({ grafo, fluxoId, fluxos, onFechar }: { grafo: Grafo; fluxoId: string; fluxos: Fluxo[]; onFechar: () => void }) {
  const [segue, setSegue] = useState(false);
  const [tagsTexto, setTagsTexto] = useState("");
  const [sim, setSim] = useState<Sim>(() => simInicial(grafo, fluxoId, fluxos, false, ""));
  const [resposta, setResposta] = useState("");
  const fim = useRef<HTMLDivElement>(null);
  const comecar = () => setSim(simInicial(grafo, fluxoId, fluxos, segue, tagsTexto));
  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [sim]);

  function responder(texto: string, indice: number | null) {
    if (!sim?.esperando || !texto.trim()) return;
    const no = sim.grafo.nos.find((n) => n.id === sim.esperando!.noId);
    if (!no) return;
    const s: Sim = { ...sim, bolhas: [...sim.bolhas, { de: "cliente", texto }], vars: { ...sim.vars, _ultimoTexto: texto } };
    setResposta("");
    if (no.tipo === "pergunta") {
      const d = no.dados as DadosPergunta;
      s.vars[nomeVariavel(d.variavel) || "resposta"] = texto;
      s.bolhas.push({ de: "sistema", texto: `💾 Guardou {${nomeVariavel(d.variavel) || "resposta"}} = "${texto}"` });
      setSim(simRodar(s, proximoNo(s.grafo, no.id, "proximo"), segue, fluxos));
      return;
    }
    const d = no.dados as DadosMensagem;
    let i = indice;
    if (i === null) {
      const k = d.botoes.findIndex((b) => b.titulo.trim().toLowerCase() === texto.trim().toLowerCase());
      if (k >= 0) i = k;
    }
    const prox = proximoNo(s.grafo, no.id, i !== null ? `b${i}` : "proximo");
    if (!prox) {
      setSim({ ...s, esperando: null, terminou: true, bolhas: [...s.bolhas, { de: "sistema", texto: "✔ Fim do fluxo (nada ligado aqui: o robô normal responderia essa mensagem)" }] });
      return;
    }
    if (i !== null) s.vars.botao = d.botoes[i]?.titulo;
    setSim(simRodar(s, prox, segue, fluxos));
  }

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-[#1b1f2b]">Simular</p>
          <p className="text-[11px] text-[#8a8f9c]">Percorre o fluxo sem enviar nada. Atrasos são pulados.</p>
        </div>
        <button onClick={onFechar} className="text-xs text-[#8a8f9c] hover:text-[#1b1f2b]">✕ Fechar</button>
      </div>
      <div className="mb-3 space-y-2 rounded-xl bg-[#f7f8fa] p-3 text-xs text-[#5a5f6d]">
        <p className="font-medium text-[#1b1f2b]">Contato de teste: Maria</p>
        <label className="flex items-center justify-between gap-2">
          Segue a loja <Toggle valor={segue} onChange={setSegue} />
        </label>
        <input value={tagsTexto} onChange={(e) => setTagsTexto(e.target.value)} placeholder="Etiquetas que ela já tem (separe por vírgula)" className={campo} />
        <button onClick={comecar} className="w-full rounded-lg bg-white px-3 py-1.5 font-medium text-[#6366f1] ring-1 ring-[#e3e5ea] hover:bg-[#eef0ff]">↻ Recomeçar</button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto rounded-2xl bg-[#12131a] p-3 text-[12px] leading-snug">
        <div className="space-y-2">
          {(sim?.bolhas ?? []).map((b, i) =>
            b.de === "sistema" ? (
              <p key={i} className="text-center text-[10px] text-[#8b8fa0]">{b.texto}</p>
            ) : b.de === "cliente" ? (
              <div key={i} className="flex justify-end">
                <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl bg-[#6366f1] px-3 py-1.5 text-white">{b.texto}</div>
              </div>
            ) : (
              <div key={i} className="max-w-[90%]">
                <div className="whitespace-pre-wrap rounded-2xl bg-[#262833] px-3 py-2 text-[#e9eaf0]">
                  {b.texto}
                  {b.link && <div className="mt-2 rounded-lg bg-[#343644] px-3 py-1.5 text-center text-[11px] font-medium">🔗 {b.link}</div>}
                </div>
              </div>
            ),
          )}
          {sim?.esperando && (
            <div className="flex flex-wrap justify-end gap-1.5 pt-1">
              {(() => {
                const no = sim.grafo.nos.find((n) => n.id === sim.esperando!.noId);
                const lista = no?.tipo === "mensagem" ? (no.dados as DadosMensagem).botoes : no?.tipo === "pergunta" ? (no.dados as DadosPergunta).sugestoes : [];
                return lista.map((b, i) =>
                  b.titulo.trim() ? (
                    <button key={i} onClick={() => responder(b.titulo, i)} className="rounded-full border border-[#6366f1] px-3 py-1 text-[11px] text-[#c7c8ff] hover:bg-[#6366f1] hover:text-white">
                      {b.titulo}
                    </button>
                  ) : null,
                );
              })()}
            </div>
          )}
          <div ref={fim} />
        </div>
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          responder(resposta, null);
        }}
      >
        <input
          value={resposta}
          onChange={(e) => setResposta(e.target.value)}
          disabled={!sim?.esperando}
          placeholder={sim?.esperando ? "Responder como a Maria…" : sim?.terminou ? "Fluxo terminou" : ""}
          className={campo}
        />
        <button disabled={!sim?.esperando} className="rounded-xl bg-[#6366f1] px-4 text-sm font-semibold text-white disabled:opacity-40">Enviar</button>
      </form>
    </div>
  );
}

// ═════════════════════════════ Painel do bloco ═════════════════════════════

function ListaBotoes({ itens, onChange, dica }: { itens: { titulo: string }[]; onChange: (v: { titulo: string }[]) => void; dica: string }) {
  return (
    <div className="space-y-1.5">
      {itens.map((b, i) => (
        <div key={i} className="flex gap-1.5">
          <input
            value={b.titulo}
            maxLength={20}
            onChange={(e) => onChange(itens.map((x, k) => (k === i ? { titulo: e.target.value } : x)))}
            placeholder={`Botão ${i + 1}`}
            className={campo}
          />
          <button onClick={() => onChange(itens.filter((_, k) => k !== i))} className="rounded-lg px-2 text-xs text-red-600 hover:bg-red-50" title="Remover">✕</button>
        </div>
      ))}
      {itens.length < MAX_BOTOES && (
        <button onClick={() => onChange([...itens, { titulo: "" }])} className="text-xs font-medium text-[#6366f1] hover:underline">
          + Adicionar botão ({itens.length}/{MAX_BOTOES})
        </button>
      )}
      <p className="text-[11px] text-[#a1a5b0]">{dica}</p>
    </div>
  );
}

function Painel({
  no,
  set,
  fluxos,
  fluxoId,
  contaId,
  etiquetas,
  onExcluir,
}: {
  no: No;
  set: (patch: Record<string, unknown>) => void;
  fluxos: Fluxo[];
  fluxoId: string;
  contaId: string;
  etiquetas: string[];
  onExcluir: () => void;
}) {
  const [midias, setMidias] = useState<Midia[] | null>(null);
  const [buscando, setBuscando] = useState(false);
  const d = no.dados as Record<string, unknown>;

  async function abrirMidias() {
    setBuscando(true);
    const r = await fetch(`/api/instagram/midias?conta=${contaId}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    setMidias(r.ok ? j.midias : []);
    setBuscando(false);
  }

  const lista = <datalist id="fluxo-etiquetas">{etiquetas.map((t) => <option key={t} value={t} />)}</datalist>;
  let corpo: React.ReactNode = null;

  if (no.tipo === "gatilho") {
    const g = d as DadosGatilho;
    corpo = (
      <div className="space-y-3">
        <div>
          <label className={rotulo}>O fluxo começa quando…</label>
          <select value={g.tipo} onChange={(e) => set({ tipo: e.target.value })} className={campo}>
            <option value="palavra">Mandar uma palavra-chave na DM</option>
            <option value="story">Responder um story</option>
            <option value="comentario">Comentar numa publicação</option>
            <option value="etiqueta">Receber uma etiqueta</option>
            <option value="postback">Tocar num botão do menu (postback)</option>
          </select>
        </div>
        {(g.tipo === "palavra" || g.tipo === "story" || g.tipo === "comentario") && (
          <div>
            <label className={rotulo}>Palavras {g.tipo !== "palavra" && "(opcional)"}</label>
            <input value={g.palavras} onChange={(e) => set({ palavras: e.target.value })} placeholder="QUERO, PREÇO, CATÁLOGO" className={campo} />
            <div className="mt-1.5 flex gap-4 text-xs text-[#5a5f6d]">
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={g.modo === "contem"} onChange={() => set({ modo: "contem" })} /> Contém
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" checked={g.modo === "exata"} onChange={() => set({ modo: "exata" })} /> É exatamente
              </label>
            </div>
            <p className="mt-1 text-[11px] text-[#a1a5b0]">Separe por vírgula. Não diferencia maiúsculas nem acentos.{g.tipo !== "palavra" && " Vazio = qualquer texto."}</p>
          </div>
        )}
        {g.tipo === "comentario" && (
          <div>
            <label className={rotulo}>Publicação</label>
            <div className="flex items-center gap-2 text-xs">
              <span className="min-w-0 flex-1 truncate text-[#5a5f6d]">{g.midiaId ? `Específica (${g.midiaId})` : "Qualquer publicação"}</span>
              <button onClick={abrirMidias} className="text-[#6366f1] hover:underline">{buscando ? "Buscando…" : "Escolher"}</button>
              {g.midiaId && <button onClick={() => set({ midiaId: "" })} className="text-[#8a8f9c] hover:underline">Qualquer</button>}
            </div>
            {midias && (
              <div className="mt-2 grid grid-cols-3 gap-1.5">
                {midias.length === 0 && <p className="col-span-3 text-[11px] text-[#8a8f9c]">Nenhuma publicação encontrada.</p>}
                {midias.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      set({ midiaId: m.id });
                      setMidias(null);
                    }}
                    className={`overflow-hidden rounded-lg border ${g.midiaId === m.id ? "border-[#6366f1]" : "border-[#e3e5ea]"}`}
                    title={m.legenda}
                  >
                    {m.miniatura ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.miniatura} alt="" referrerPolicy="no-referrer" className="aspect-square w-full object-cover" />
                    ) : (
                      <div className="flex aspect-square items-center justify-center bg-[#eef0f4] text-[10px] text-[#8a8f9c]">{m.tipo}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-[#a1a5b0]">A 1ª mensagem vai como resposta privada ao comentário (com até 3 botões). Depois, o fluxo só continua se a pessoa responder.</p>
          </div>
        )}
        {g.tipo === "etiqueta" && (
          <div>
            <label className={rotulo}>Etiqueta</label>
            <input list="fluxo-etiquetas" value={g.etiqueta} onChange={(e) => set({ etiqueta: e.target.value })} className={campo} />
            {lista}
          </div>
        )}
        {g.tipo === "postback" && (
          <div>
            <label className={rotulo}>Payload do botão</label>
            <input value={g.payload} onChange={(e) => set({ payload: e.target.value })} placeholder="MENU_CATALOGO" className={campo} />
            <p className="mt-1 text-[11px] text-[#a1a5b0]">O mesmo payload configurado no botão do menu do Instagram.</p>
          </div>
        )}
      </div>
    );
  } else if (no.tipo === "mensagem") {
    const m = d as DadosMensagem;
    corpo = (
      <div className="space-y-3">
        <div>
          <label className={rotulo}>Texto</label>
          <textarea value={m.texto} onChange={(e) => set({ texto: e.target.value })} rows={5} maxLength={m.botoesTipo === "link" ? 640 : 1000} className={campo} />
          <p className="mt-1 text-[11px] text-[#a1a5b0]">Use {"{nome}"} e as variáveis das perguntas, ex.: {"{cidade}"}. Sem link o limite do Instagram é 1000 bytes (acentos e emojis pesam mais que 1); com link, 640 caracteres. O que passar é cortado.</p>
        </div>
        <div>
          <label className={rotulo}>Botões</label>
          <div className="flex gap-1 rounded-xl bg-[#f1f2f5] p-1 text-xs">
            {(["nenhum", "rapidos", "link"] as const).map((t) => (
              <button
                key={t}
                onClick={() => set({ botoesTipo: t })}
                className={`flex-1 rounded-lg px-2 py-1.5 font-medium ${m.botoesTipo === t ? "bg-white text-[#1b1f2b] shadow-sm" : "text-[#8a8f9c]"}`}
              >
                {t === "nenhum" ? "Sem botão" : t === "rapidos" ? "Respostas rápidas" : "Link"}
              </button>
            ))}
          </div>
        </div>
        {m.botoesTipo === "rapidos" && (
          <ListaBotoes
            itens={m.botoes}
            onChange={(v) => set({ botoes: v })}
            dica="Cada botão ganha uma saída no bloco: ligue cada uma ao próximo passo. Até 20 caracteres. O fluxo espera o toque."
          />
        )}
        {m.botoesTipo === "link" && (
          <div className="grid gap-2">
            <input value={m.link.titulo} maxLength={20} onChange={(e) => set({ link: { ...m.link, titulo: e.target.value } })} placeholder="Texto do botão" className={campo} />
            <input value={m.link.url} onChange={(e) => set({ link: { ...m.link, url: e.target.value } })} placeholder="https://…" className={campo} />
            <p className="text-[11px] text-[#a1a5b0]">Com link, o texto pode ter até 640 caracteres (o limite do campo acima muda sozinho).</p>
          </div>
        )}
      </div>
    );
  } else if (no.tipo === "pergunta") {
    const p = d as DadosPergunta;
    corpo = (
      <div className="space-y-3">
        <div>
          <label className={rotulo}>Pergunta</label>
          <textarea value={p.texto} onChange={(e) => set({ texto: e.target.value })} rows={4} className={campo} />
        </div>
        <div>
          <label className={rotulo}>Guardar a resposta em</label>
          <input value={p.variavel} onChange={(e) => set({ variavel: e.target.value })} onBlur={(e) => set({ variavel: nomeVariavel(e.target.value) || "resposta" })} className={campo} />
          <p className="mt-1 text-[11px] text-[#a1a5b0]">Depois use {`{${nomeVariavel(p.variavel) || "resposta"}}`} nas mensagens ou numa Condição.</p>
        </div>
        <label className="flex items-center justify-between gap-2 text-xs text-[#5a5f6d]">
          Gravar também no campo do contato
          <Toggle valor={p.salvarNoContato} onChange={(v) => set({ salvarNoContato: v })} />
        </label>
        <div>
          <label className={rotulo}>Sugestões de resposta (opcional)</label>
          <ListaBotoes itens={p.sugestoes} onChange={(v) => set({ sugestoes: v })} dica="Viram botões de resposta rápida; a pessoa também pode digitar." />
        </div>
      </div>
    );
  } else if (no.tipo === "condicao") {
    const c = d as DadosCondicao;
    const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    corpo = (
      <div className="space-y-3">
        <div>
          <label className={rotulo}>Condição</label>
          <select value={c.tipo} onChange={(e) => set({ tipo: e.target.value })} className={campo}>
            <option value="etiqueta">Tem a etiqueta</option>
            <option value="variavel_igual">Variável é igual a</option>
            <option value="contem_texto">Contém o texto</option>
            <option value="segue_loja">Segue a loja</option>
            <option value="horario">Está dentro do horário</option>
          </select>
        </div>
        {c.tipo === "etiqueta" && (
          <>
            <input list="fluxo-etiquetas" value={c.etiqueta} onChange={(e) => set({ etiqueta: e.target.value })} placeholder="Etiqueta" className={campo} />
            {lista}
          </>
        )}
        {(c.tipo === "variavel_igual" || c.tipo === "contem_texto") && (
          <div className="grid gap-2">
            <input
              value={c.variavel}
              onChange={(e) => set({ variavel: e.target.value })}
              placeholder={c.tipo === "contem_texto" ? "Variável (vazio = última mensagem)" : "Variável (ex.: cidade)"}
              className={campo}
            />
            <input value={c.valor} onChange={(e) => set({ valor: e.target.value })} placeholder={c.tipo === "contem_texto" ? "Textos, separados por vírgula" : "Valor"} className={campo} />
          </div>
        )}
        {c.tipo === "horario" && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-[#5a5f6d]">
              Das <input type="time" value={c.inicio} onChange={(e) => set({ inicio: e.target.value })} className={campo} />
              às <input type="time" value={c.fim} onChange={(e) => set({ fim: e.target.value })} className={campo} />
            </div>
            <div className="flex flex-wrap gap-1">
              {DIAS.map((nome, i) => (
                <button
                  key={i}
                  onClick={() => set({ dias: c.dias.includes(i) ? c.dias.filter((x) => x !== i) : [...c.dias, i].sort() })}
                  className={`rounded-lg px-2 py-1 text-[11px] font-medium ${c.dias.includes(i) ? "bg-[#6366f1] text-white" : "bg-[#eef0f4] text-[#5a5f6d]"}`}
                >
                  {nome}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#a1a5b0]">Horário de Brasília. Nenhum dia marcado = todos os dias.</p>
          </div>
        )}
        <p className="text-[11px] text-[#a1a5b0]">O bloco tem duas saídas: Sim e Não.</p>
      </div>
    );
  } else if (no.tipo === "atraso") {
    const a = d as DadosAtraso;
    corpo = (
      <div className="space-y-2">
        <label className={rotulo}>Esperar</label>
        <div className="flex gap-2">
          <input type="number" min={1} value={a.quantidade} onChange={(e) => set({ quantidade: Math.max(1, Number(e.target.value) || 1) })} className={campo} />
          <select value={a.unidade} onChange={(e) => set({ unidade: e.target.value })} className={campo}>
            <option value="minutos">minutos</option>
            <option value="horas">horas</option>
            <option value="dias">dias</option>
          </select>
        </div>
        <p className="text-[11px] text-[#a1a5b0]">
          O agendador confere a cada 5 minutos. Regra da Meta: se passar de 24h desde a última mensagem da pessoa, o fluxo é cancelado (não envia fora da janela).
        </p>
      </div>
    );
  } else if (no.tipo === "etiqueta") {
    const t = d as DadosEtiqueta;
    corpo = (
      <div className="space-y-2">
        <select value={t.acao} onChange={(e) => set({ acao: e.target.value })} className={campo}>
          <option value="adicionar">Adicionar etiqueta</option>
          <option value="remover">Remover etiqueta</option>
        </select>
        <input list="fluxo-etiquetas" value={t.etiquetas} onChange={(e) => set({ etiquetas: e.target.value })} placeholder="Etiquetas, separadas por vírgula" className={campo} />
        {lista}
      </div>
    );
  } else if (no.tipo === "atendente") {
    const a = d as DadosAtendente;
    corpo = (
      <div className="space-y-2">
        <label className={rotulo}>Mensagem antes de chamar (opcional)</label>
        <textarea value={a.texto} onChange={(e) => set({ texto: e.target.value })} rows={3} className={campo} />
        <p className="text-[11px] text-[#a1a5b0]">A conversa vai para &ldquo;Aguardando atendente&rdquo; e aparece como não lida na caixa de entrada.</p>
      </div>
    );
  } else if (no.tipo === "irpara") {
    const ir = d as DadosIrPara;
    const opcoes = fluxos.filter((f) => f.id !== fluxoId && f.accountId === contaId);
    corpo = (
      <div className="space-y-2">
        <label className={rotulo}>Continuar no fluxo</label>
        <select value={ir.fluxoId} onChange={(e) => set({ fluxoId: e.target.value })} className={campo}>
          <option value="">Escolha…</option>
          {opcoes.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
              {f.ativo ? "" : " (desligado)"}
            </option>
          ))}
        </select>
        <p className="text-[11px] text-[#a1a5b0]">As variáveis guardadas continuam valendo no outro fluxo.</p>
      </div>
    );
  } else {
    corpo = <p className="text-xs text-[#8a8f9c]">Encerra o fluxo. Depois disso o robô normal volta a responder as mensagens.</p>;
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="flex items-center gap-2 text-sm font-semibold text-[#1b1f2b]">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: BLOCOS[no.tipo].cor }} />
          {BLOCOS[no.tipo].rotulo}
        </p>
        {no.tipo !== "gatilho" && (
          <button onClick={onExcluir} className="text-xs text-red-600 hover:underline">Excluir bloco</button>
        )}
      </div>
      {corpo}
    </div>
  );
}

// ═════════════════════════════ Editor (canvas) ═════════════════════════════

type Sel = { tipo: "no" | "lig"; id: string } | null;
type Arraste =
  | { modo: "no"; id: string; dx: number; dy: number; moveu: boolean }
  | { modo: "pan"; sx: number; sy: number; vx: number; vy: number }
  | { modo: "ligar"; de: string; saida: string };

function Editor({
  fluxo,
  fluxos,
  contas,
  etiquetas,
  onFechar,
  onSalvo,
}: {
  fluxo: Fluxo;
  fluxos: Fluxo[];
  contas: Conta[];
  etiquetas: string[];
  onFechar: () => void;
  onSalvo: () => Promise<void>;
}) {
  const [nome, setNome] = useState(fluxo.nome);
  const [ativo, setAtivo] = useState(fluxo.ativo);
  const [grafo, setGrafo] = useState<Grafo>(() => (fluxo.grafo?.nos?.length ? fluxo.grafo : grafoInicial()));
  const [sujo, setSujo] = useState(false);
  const [sel, setSel] = useState<Sel>(null);
  const [view, setView] = useState({ x: 40, y: 40, z: 1 });
  const [ligando, setLigando] = useState<{ de: string; saida: string; x: number; y: number } | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [salvando, setSalvando] = useState(false);
  const area = useRef<HTMLDivElement>(null);
  const arraste = useRef<Arraste | null>(null);
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  const conta = contas.find((c) => c.id === fluxo.accountId);
  const selNo = sel?.tipo === "no" ? grafo.nos.find((n) => n.id === sel.id) ?? null : null;
  const problemas = useMemo(() => problemasParaAtivar(grafo), [grafo]);

  const mudar = useCallback((f: (g: Grafo) => Grafo) => {
    setGrafo(f);
    setSujo(true);
    setMsg(null);
  }, []);

  const mundo = useCallback((clientX: number, clientY: number) => {
    const r = area.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (clientX - r.left - v.x) / v.z, y: (clientY - r.top - v.y) / v.z };
  }, []);

  // Enquadra todos os blocos na tela.
  const enquadrar = useCallback(() => {
    const el = area.current;
    if (!el || !grafo.nos.length) return;
    const minX = Math.min(...grafo.nos.map((n) => n.x));
    const minY = Math.min(...grafo.nos.map((n) => n.y));
    const maxX = Math.max(...grafo.nos.map((n) => n.x + LARG));
    const maxY = Math.max(...grafo.nos.map((n) => n.y + altura(n)));
    const z = Math.min(1, Math.max(0.3, Math.min((el.clientWidth - 80) / (maxX - minX), (el.clientHeight - 80) / (maxY - minY))));
    setView({ z, x: (el.clientWidth - (maxX - minX) * z) / 2 - minX * z, y: (el.clientHeight - (maxY - minY) * z) / 2 - minY * z });
  }, [grafo.nos]);
  useEffect(() => {
    enquadrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Zoom com a roda do mouse (listener não passivo para poder impedir a rolagem da página).
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    const roda = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left;
      const cy = e.clientY - r.top;
      setView((v) => {
        const z = Math.min(1.8, Math.max(0.3, v.z * (1 - e.deltaY * 0.0015)));
        return { z, x: cx - ((cx - v.x) * z) / v.z, y: cy - ((cy - v.y) * z) / v.z };
      });
    };
    el.addEventListener("wheel", roda, { passive: false });
    return () => el.removeEventListener("wheel", roda);
  }, []);

  // Arrastar bloco, mover o canvas e puxar ligação: tudo pelo window para não perder o ponteiro.
  useEffect(() => {
    const mover = (e: PointerEvent) => {
      const a = arraste.current;
      if (!a) return;
      if (a.modo === "pan") {
        setView((v) => ({ ...v, x: a.vx + e.clientX - a.sx, y: a.vy + e.clientY - a.sy }));
      } else if (a.modo === "no") {
        const p = mundo(e.clientX, e.clientY);
        a.moveu = true;
        setGrafo((g) => ({ ...g, nos: g.nos.map((n) => (n.id === a.id ? { ...n, x: Math.round(p.x - a.dx), y: Math.round(p.y - a.dy) } : n)) }));
        setSujo(true);
      } else {
        const p = mundo(e.clientX, e.clientY);
        setLigando({ de: a.de, saida: a.saida, x: p.x, y: p.y });
      }
    };
    const soltar = (e: PointerEvent) => {
      const a = arraste.current;
      arraste.current = null;
      if (a?.modo === "ligar") {
        setLigando(null);
        const alvo = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest("[data-no]")?.getAttribute("data-no");
        if (alvo && alvo !== a.de) {
          mudar((g) => {
            const destino = g.nos.find((n) => n.id === alvo);
            if (!destino || destino.tipo === "gatilho") return g;
            return { ...g, ligacoes: [...g.ligacoes.filter((l) => !(l.de === a.de && l.saida === a.saida)), { id: novoId("l"), de: a.de, saida: a.saida, para: alvo }] };
          });
        }
      }
    };
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar);
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
  }, [mundo, mudar]);

  const excluirSel = useCallback(() => {
    if (!sel) return;
    if (sel.tipo === "lig") mudar((g) => ({ ...g, ligacoes: g.ligacoes.filter((l) => l.id !== sel.id) }));
    else {
      const no = grafo.nos.find((n) => n.id === sel.id);
      if (!no || no.tipo === "gatilho") return;
      mudar((g) => ({ nos: g.nos.filter((n) => n.id !== sel.id), ligacoes: g.ligacoes.filter((l) => l.de !== sel.id && l.para !== sel.id) }));
    }
    setSel(null);
  }, [sel, grafo.nos, mudar]);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName) || alvo.isContentEditable) return;
      if (e.key === "Delete" || e.key === "Backspace") excluirSel();
      if (e.key === "Escape") setSel(null);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [excluirSel]);

  function adicionar(tipo: TipoNo) {
    const el = area.current!;
    const v = viewRef.current;
    const desvio = (grafo.nos.length % 5) * 24; // blocos novos não nascem exatamente um em cima do outro
    const cx = (el.clientWidth / 2 - v.x) / v.z - LARG / 2 + desvio;
    const cy = (el.clientHeight / 2 - v.y) / v.z - 60 + desvio;
    const n = novoNo(tipo, cx, cy);
    mudar((g) => {
      // Liga sozinho ao bloco selecionado, se a saída "Próximo" dele estiver livre.
      const ligacoes = [...g.ligacoes];
      if (sel?.tipo === "no") {
        const origem = g.nos.find((x) => x.id === sel.id);
        if (origem && saidasDe(origem).some((s) => s.id === "proximo") && !ligacoes.some((l) => l.de === origem.id && l.saida === "proximo")) {
          ligacoes.push({ id: novoId("l"), de: origem.id, saida: "proximo", para: n.id });
          n.x = origem.x + LARG + 80;
          n.y = origem.y;
        }
      }
      return { nos: [...g.nos, n], ligacoes };
    });
    setSel({ tipo: "no", id: n.id });
  }

  function setDados(id: string, patch: Record<string, unknown>) {
    mudar((g) => {
      const nos = g.nos.map((n) => (n.id === id ? ({ ...n, dados: { ...n.dados, ...patch } } as No) : n));
      // Saídas que deixaram de existir (botão removido) perdem a ligação.
      const ligacoes = g.ligacoes.filter((l) => {
        if (l.de !== id) return true;
        const no = nos.find((n) => n.id === id)!;
        return saidasDe(no).some((s) => s.id === l.saida);
      });
      return { nos, ligacoes };
    });
  }

  async function salvar(): Promise<boolean> {
    setSalvando(true);
    const r = await fetch(`/api/instagram/fluxos/${fluxo.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nome, grafo }),
    });
    setSalvando(false);
    if (!r.ok) {
      setMsg({ tipo: "erro", texto: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível salvar." });
      return false;
    }
    setSujo(false);
    setMsg({ tipo: "ok", texto: "Salvo." });
    await onSalvo();
    return true;
  }

  async function alternarAtivo(v: boolean) {
    if (sujo && !(await salvar())) return;
    const r = await fetch(`/api/instagram/fluxos/${fluxo.id}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ativo: v }),
    });
    if (r.ok) {
      setAtivo(v);
      setMsg({ tipo: "ok", texto: v ? "Fluxo ativado." : "Fluxo desligado. Quem estava no meio dele foi parado." });
      await onSalvo();
    } else {
      setMsg({ tipo: "erro", texto: ((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível mudar." });
    }
  }

  function fechar() {
    if (sujo && !confirm("Há mudanças não salvas. Sair mesmo assim?")) return;
    onFechar();
  }

  const porId = useMemo(() => new Map(grafo.nos.map((n) => [n.id, n])), [grafo.nos]);
  const ligSel = sel?.tipo === "lig" ? grafo.ligacoes.find((l) => l.id === sel.id) : undefined;
  const meioLigSel = (() => {
    if (!ligSel) return null;
    const a = porId.get(ligSel.de);
    const b = porId.get(ligSel.para);
    if (!a || !b) return null;
    const i = saidasDe(a).findIndex((s) => s.id === ligSel.saida);
    const p1 = pontoSaida(a, Math.max(0, i));
    const p2 = pontoEntrada(b);
    return { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
  })();

  return (
    <section className="rounded-2xl border border-[#e3e5ea] bg-white p-4 shadow-sm">
      {/* Barra do topo */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button onClick={fechar} className="rounded-lg px-2 py-1.5 text-sm text-[#8a8f9c] hover:bg-[#f1f2f5] hover:text-[#1b1f2b]">← Fluxos</button>
        <input
          value={nome}
          onChange={(e) => {
            setNome(e.target.value);
            setSujo(true);
          }}
          className="min-w-[200px] flex-1 rounded-xl border border-transparent px-3 py-1.5 text-base font-semibold text-[#1b1f2b] outline-none hover:border-[#e3e5ea] focus:border-[#6366f1]"
        />
        <span className="text-[11px] text-[#8a8f9c]">@{conta?.username ?? fluxo.account.username}</span>
        <label className="flex items-center gap-2 rounded-xl bg-[#f7f8fa] px-3 py-1.5 text-xs font-medium text-[#5a5f6d]">
          {ativo ? "Ativo" : "Desligado"}
          <Toggle valor={ativo} onChange={alternarAtivo} disabled={salvando} />
        </label>
        <button
          onClick={() => {
            setSimulando(true);
            setSel(null);
          }}
          className="rounded-xl bg-[#eef0f4] px-4 py-2 text-sm font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]"
        >
          ▶ Simular
        </button>
        <button onClick={salvar} disabled={salvando || !sujo} className="rounded-xl bg-[#6366f1] px-5 py-2 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-50">
          {salvando ? "Salvando…" : sujo ? "Salvar" : "Salvo"}
        </button>
      </div>
      {msg && <p className={`mb-2 rounded-lg px-3 py-2 text-xs ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
      {!ativo && problemas.length > 0 && (
        <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-800">Antes de ativar: {problemas.join(" · ")}</p>
      )}

      <div className="grid gap-3 lg:grid-cols-[150px_1fr_300px]">
        {/* Paleta */}
        <div className="flex flex-row flex-wrap gap-1.5 lg:flex-col">
          <p className="hidden text-[11px] font-medium uppercase tracking-wide text-[#8a8f9c] lg:block">Adicionar bloco</p>
          {(Object.keys(BLOCOS) as TipoNo[])
            .filter((t) => t !== "gatilho")
            .map((t) => (
              <button
                key={t}
                onClick={() => adicionar(t)}
                title={BLOCOS[t].descricao}
                className="flex items-center gap-2 rounded-xl border border-[#e3e5ea] px-2.5 py-2 text-left text-xs font-medium text-[#1b1f2b] hover:border-[#6366f1] hover:bg-[#f7f7ff]"
              >
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: BLOCOS[t].cor }} />
                {BLOCOS[t].rotulo}
              </button>
            ))}
          <p className="mt-2 hidden text-[10px] leading-relaxed text-[#a1a5b0] lg:block">
            Arraste os blocos. Puxe a bolinha da direita até outro bloco para ligar. Clique numa linha para remover. Roda do mouse: zoom. Arraste o fundo para mover.
          </p>
        </div>

        {/* Canvas */}
        <div
          ref={area}
          className="relative h-[620px] touch-none select-none overflow-hidden rounded-xl border border-[#e3e5ea]"
          style={{
            backgroundColor: "#fafbfc",
            backgroundImage: "radial-gradient(#dfe2e8 1px, transparent 1px)",
            backgroundSize: `${20 * view.z}px ${20 * view.z}px`,
            backgroundPosition: `${view.x}px ${view.y}px`,
          }}
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            arraste.current = { modo: "pan", sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y };
            setSel(null);
          }}
        >
          <div className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})` }}>
            {/* Linhas */}
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
              {grafo.ligacoes.map((l) => {
                const a = porId.get(l.de);
                const b = porId.get(l.para);
                if (!a || !b) return null;
                const i = saidasDe(a).findIndex((s) => s.id === l.saida);
                if (i < 0) return null;
                const d = curva(pontoSaida(a, i), pontoEntrada(b));
                const ativa = sel?.tipo === "lig" && sel.id === l.id;
                const cor = l.saida === "sim" ? "#16a34a" : l.saida === "nao" ? "#ef4444" : "#9aa0ae";
                return (
                  <g key={l.id}>
                    <path d={d} fill="none" stroke={ativa ? "#6366f1" : cor} strokeWidth={ativa ? 3 : 2} />
                    <path
                      d={d}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={16}
                      style={{ pointerEvents: "stroke", cursor: "pointer" }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        setSel({ tipo: "lig", id: l.id });
                        setSimulando(false);
                      }}
                    />
                  </g>
                );
              })}
              {ligando &&
                (() => {
                  const a = porId.get(ligando.de);
                  if (!a) return null;
                  const i = saidasDe(a).findIndex((s) => s.id === ligando.saida);
                  return <path d={curva(pontoSaida(a, Math.max(0, i)), { x: ligando.x, y: ligando.y })} fill="none" stroke="#6366f1" strokeWidth={2} strokeDasharray="6 4" />;
                })()}
            </svg>

            {meioLigSel && (
              <button
                onPointerDown={(e) => e.stopPropagation()}
                onClick={excluirSel}
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-500 text-xs text-white shadow"
                style={{ left: meioLigSel.x, top: meioLigSel.y }}
                title="Remover ligação"
              >
                ✕
              </button>
            )}

            {/* Blocos */}
            {grafo.nos.map((n) => {
              const b = BLOCOS[n.tipo];
              const saidas = saidasDe(n);
              const selecionado = sel?.tipo === "no" && sel.id === n.id;
              return (
                <div
                  key={n.id}
                  data-no={n.id}
                  className={`absolute rounded-xl border bg-white shadow-sm ${selecionado ? "border-[#6366f1] ring-2 ring-[#6366f1]/25" : "border-[#e3e5ea]"}`}
                  style={{ left: n.x, top: n.y, width: LARG, height: altura(n) }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const p = mundo(e.clientX, e.clientY);
                    arraste.current = { modo: "no", id: n.id, dx: p.x - n.x, dy: p.y - n.y, moveu: false };
                    setSel({ tipo: "no", id: n.id });
                    setSimulando(false);
                  }}
                >
                  {n.tipo !== "gatilho" && (
                    <span className="absolute -left-[7px] h-3.5 w-3.5 rounded-full border-2 border-white shadow" style={{ top: CAB / 2 - 7, background: "#9aa0ae" }} />
                  )}
                  <div className="flex cursor-grab items-center gap-2 rounded-t-xl px-3 text-xs font-semibold text-white active:cursor-grabbing" style={{ height: CAB, background: b.cor }}>
                    {b.rotulo}
                    {n.tipo === "gatilho" && <span className="ml-auto rounded bg-white/25 px-1.5 py-0.5 text-[9px] uppercase">início</span>}
                  </div>
                  <p className="line-clamp-2 px-3 pt-2 text-[11px] leading-snug text-[#5a5f6d]" style={{ height: PREV }}>
                    {resumo(n, fluxos)}
                  </p>
                  {saidas.map((s, i) => (
                    <div key={s.id} className="relative flex items-center justify-end pr-4 text-[10px] text-[#8a8f9c]" style={{ height: LINHA }}>
                      <span className="truncate">{s.rotulo}</span>
                      <span
                        className="absolute -right-[7px] h-3.5 w-3.5 cursor-crosshair rounded-full border-2 border-white shadow hover:scale-125"
                        style={{ top: LINHA / 2 - 7, background: s.id === "sim" ? "#16a34a" : s.id === "nao" ? "#ef4444" : b.cor }}
                        title="Puxe até outro bloco para ligar"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          const p = pontoSaida(n, i);
                          arraste.current = { modo: "ligar", de: n.id, saida: s.id };
                          setLigando({ de: n.id, saida: s.id, x: p.x, y: p.y });
                        }}
                      />
                    </div>
                  ))}
                </div>
              );
            })}
          </div>

          {/* Zoom */}
          <div className="absolute bottom-3 left-3 flex gap-1" onPointerDown={(e) => e.stopPropagation()}>
            <button onClick={() => setView((v) => ({ ...v, z: Math.min(1.8, v.z + 0.15) }))} className="h-8 w-8 rounded-lg bg-white text-sm shadow ring-1 ring-[#e3e5ea]">+</button>
            <button onClick={() => setView((v) => ({ ...v, z: Math.max(0.3, v.z - 0.15) }))} className="h-8 w-8 rounded-lg bg-white text-sm shadow ring-1 ring-[#e3e5ea]">−</button>
            <button onClick={enquadrar} className="h-8 rounded-lg bg-white px-2 text-[11px] shadow ring-1 ring-[#e3e5ea]">Enquadrar</button>
            <span className="self-center pl-1 text-[10px] text-[#a1a5b0]">{Math.round(view.z * 100)}%</span>
          </div>
        </div>

        {/* Painel lateral */}
        <div className="h-[620px] overflow-y-auto rounded-xl border border-[#e3e5ea] p-4">
          {simulando ? (
            <Simulador grafo={grafo} fluxoId={fluxo.id} fluxos={fluxos.map((f) => (f.id === fluxo.id ? { ...f, grafo } : f))} onFechar={() => setSimulando(false)} />
          ) : selNo ? (
            <Painel
              key={selNo.id}
              no={selNo}
              set={(p) => setDados(selNo.id, p)}
              fluxos={fluxos}
              fluxoId={fluxo.id}
              contaId={fluxo.accountId}
              etiquetas={etiquetas}
              onExcluir={excluirSel}
            />
          ) : ligSel ? (
            <div className="space-y-3 text-xs text-[#5a5f6d]">
              <p className="text-sm font-semibold text-[#1b1f2b]">Ligação</p>
              <p>
                De <b>{BLOCOS[porId.get(ligSel.de)?.tipo ?? "fim"].rotulo}</b> ({saidasDe(porId.get(ligSel.de)!).find((s) => s.id === ligSel.saida)?.rotulo}) para{" "}
                <b>{BLOCOS[porId.get(ligSel.para)?.tipo ?? "fim"].rotulo}</b>.
              </p>
              <button onClick={excluirSel} className="rounded-lg bg-red-50 px-3 py-1.5 font-medium text-red-700 hover:bg-red-100">Remover ligação</button>
            </div>
          ) : (
            <div className="space-y-2 text-xs text-[#8a8f9c]">
              <p className="text-sm font-semibold text-[#1b1f2b]">Como montar</p>
              <p>1. Clique no <b>Gatilho</b> e escolha o que faz o fluxo começar.</p>
              <p>2. Adicione blocos pela lista à esquerda (com um bloco selecionado, o novo já nasce ligado nele).</p>
              <p>3. Ligue as saídas (bolinhas da direita) na entrada do próximo bloco.</p>
              <p>4. Use <b>Simular</b> para testar sem enviar nada, salve e ative.</p>
              <p className="pt-2 text-[11px] text-[#a1a5b0]">Regra da Meta: o robô só manda mensagem até 24h depois da última mensagem da pessoa. Fora disso, o fluxo para sozinho.</p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ═════════════════════════════ Lista ═════════════════════════════

function haQuanto(iso: string) {
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.floor(min / 60)} h`;
  const d = Math.floor(min / 1440);
  return d < 30 ? `há ${d} dia${d === 1 ? "" : "s"}` : new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short" }).format(new Date(iso));
}

/** Menu ⋮ de cada automação (Editar, Duplicar, Excluir). */
function MenuLinha({ onEditar, onDuplicar, onExcluir }: { onEditar: () => void; onDuplicar: () => void; onExcluir: () => void }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto]);
  const opcao = "block w-full px-3 py-2 text-left text-[13px] hover:bg-[#f6f7f9]";
  return (
    <div ref={caixa} className="relative">
      <button onClick={() => setAberto(!aberto)} aria-label="Mais ações" className="flex h-8 w-8 items-center justify-center rounded-lg text-lg text-[#5a5f6d] hover:bg-[#f2f3f5]">
        ⋮
      </button>
      {aberto && (
        <div className="absolute right-0 top-9 z-20 w-36 overflow-hidden rounded-lg bg-white py-1 shadow-lg ring-1 ring-[#e3e5ea]">
          <button className={opcao} onClick={() => (setAberto(false), onEditar())}>
            Editar
          </button>
          <button className={opcao} onClick={() => (setAberto(false), onDuplicar())}>
            Duplicar
          </button>
          <button className={`${opcao} text-red-600`} onClick={() => (setAberto(false), onExcluir())}>
            Excluir
          </button>
        </div>
      )}
    </div>
  );
}

export default function InstagramFluxos() {
  const [lista, setLista] = useState<Fluxo[] | null>(null);
  const [contas, setContas] = useState<Conta[]>([]);
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [modelos, setModelos] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/fluxos", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      setLista(j.fluxos);
      setContas(j.contas);
      setEtiquetas(j.etiquetas ?? []);
    } else {
      setLista([]);
      setErro(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não consegui carregar os fluxos.");
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // Atalhos da Inicial ("Veja todos os modelos" e os cartões de "Comece aqui") abrem a janela de modelos.
  useEffect(() => {
    try {
      const m = window.sessionStorage.getItem("ig-abrir-modelos");
      if (m) {
        window.sessionStorage.removeItem("ig-abrir-modelos");
        setModelos(m);
      }
    } catch {
      /* sem armazenamento */
    }
  }, []);

  async function criar(accountId: string, nome: string, grafo?: unknown) {
    const r = await fetch("/api/instagram/fluxos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountId, nome, ...(grafo ? { grafo } : {}) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setErro(j.error ?? "Não foi possível criar.");
    setErro(null);
    setModelos(null);
    await carregar();
    setAbertoId(j.id);
  }
  async function duplicar(f: Fluxo) {
    const r = await fetch("/api/instagram/fluxos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ duplicarDe: f.id }) });
    if (r.ok) await carregar();
  }
  async function alternar(f: Fluxo) {
    const r = await fetch(`/api/instagram/fluxos/${f.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ativo: !f.ativo }) });
    if (!r.ok) setErro(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não foi possível mudar.");
    else setErro(null);
    await carregar();
  }
  async function excluir(f: Fluxo) {
    if (!confirm(`Excluir o fluxo "${f.nome}"? Quem estiver no meio dele para. Isso não pode ser desfeito.`)) return;
    await fetch(`/api/instagram/fluxos/${f.id}`, { method: "DELETE" });
    await carregar();
  }

  const aberto = lista?.find((f) => f.id === abertoId);
  if (aberto) {
    return <Editor key={aberto.id} fluxo={aberto} fluxos={lista ?? []} contas={contas} etiquetas={etiquetas} onFechar={() => setAbertoId(null)} onSalvo={carregar} />;
  }

  const q = busca.trim().toLowerCase();
  const visiveis = (lista ?? []).filter((f) => !q || f.nome.toLowerCase().includes(q));
  const multiContas = contas.length > 1;

  return (
    <div className="-mx-1 rounded-2xl bg-[#f6f7f9] px-3 py-5 sm:px-6">
      <div className="mx-auto max-w-[900px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-[#1b1f2b]">Minhas automações</h2>
            <p className="text-[12px] text-[#8a8f9c]">Conversas do robô montadas em blocos: mensagens com botões, perguntas, condições, atrasos e etiquetas.</p>
          </div>
          <button
            onClick={() => setModelos("todos")}
            disabled={!contas.length}
            className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-40"
          >
            + Nova automação
          </button>
        </div>

        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#e3e5ea] bg-white px-3 sm:max-w-[280px]">
            <span className="text-[#a1a5b0]" aria-hidden>
              ⌕
            </span>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Pesquisar todas as automações" className="min-w-0 flex-1 py-2 text-sm outline-none" />
          </label>
          <span className="ml-auto text-[12px] text-[#8a8f9c]">
            {(lista ?? []).filter((f) => f.ativo).length} ativa{(lista ?? []).filter((f) => f.ativo).length === 1 ? "" : "s"} de {(lista ?? []).length}
          </span>
        </div>

        {erro && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>}

        {lista === null && <p className="py-10 text-center text-sm text-[#8a8f9c]">Carregando…</p>}
        {lista && lista.length === 0 && !erro && (
          <div className="rounded-xl bg-white p-10 text-center ring-1 ring-[#eceef2]">
            <p className="text-base font-semibold text-[#1b1f2b]">Crie sua primeira automação</p>
            <p className="mx-auto mt-1 max-w-sm text-[13px] text-[#8a8f9c]">Comece por um modelo pronto (como responder stories ou mandar link para quem comenta) e ajuste o texto.</p>
            <button onClick={() => setModelos("todos")} className="mt-4 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8]">
              Ver modelos
            </button>
          </div>
        )}

        {lista && lista.length > 0 && (
          <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-[#eceef2]">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-[#eceef2] text-[11px] text-[#8a8f9c]">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Nome</th>
                  {multiContas && <th className="px-2 py-2.5 font-medium">Conta</th>}
                  <th className="px-2 py-2.5 text-right font-medium">Execuções</th>
                  <th className="px-2 py-2.5 text-right font-medium">Em andamento</th>
                  <th className="px-2 py-2.5 font-medium">Modificado</th>
                  <th className="px-2 py-2.5 font-medium">Ligado</th>
                  <th className="w-10 px-2 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visiveis.map((f) => {
                  const g = noGatilho(f.grafo ?? { nos: [], ligacoes: [] });
                  const emAndamento = (f.stats.ATIVO ?? 0) + (f.stats.ESPERANDO_RESPOSTA ?? 0) + (f.stats.ESPERANDO_TEMPO ?? 0);
                  const execucoes = emAndamento + (f.stats.CONCLUIDO ?? 0) + (f.stats.CANCELADO ?? 0);
                  return (
                    <tr key={f.id} className="border-b border-[#f1f2f5] last:border-0 hover:bg-[#fafbfc]">
                      <td className="max-w-0 px-4 py-3">
                        <button onClick={() => setAbertoId(f.id)} className="flex w-full min-w-0 items-center gap-2 text-left">
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${f.ativo ? "bg-[#dcfce7] text-[#15803d]" : "bg-[#eef0f3] text-[#6b6f80]"}`}
                          >
                            {f.ativo ? "ATIVO" : "PARADO"}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-[#1b1f2b] hover:text-[#2563eb]">{f.nome}</span>
                            <span className="block truncate text-[11px] text-[#8a8f9c]">⚡ {g ? descreverGatilho(g.dados) : "Sem gatilho"}</span>
                          </span>
                        </button>
                      </td>
                      {multiContas && <td className="whitespace-nowrap px-2 py-3 text-[12px] text-[#5a5f6d]">@{f.account.username}</td>}
                      <td className="px-2 py-3 text-right tabular-nums text-[#1b1f2b]">{execucoes.toLocaleString("pt-BR")}</td>
                      <td className="px-2 py-3 text-right tabular-nums text-[#5a5f6d]">{emAndamento.toLocaleString("pt-BR")}</td>
                      <td className="whitespace-nowrap px-2 py-3 text-[12px] text-[#5a5f6d]">{haQuanto(f.updatedAt)}</td>
                      <td className="px-2 py-3">
                        <Toggle valor={f.ativo} onChange={() => alternar(f)} />
                      </td>
                      <td className="px-2 py-3">
                        <MenuLinha onEditar={() => setAbertoId(f.id)} onDuplicar={() => duplicar(f)} onExcluir={() => excluir(f)} />
                      </td>
                    </tr>
                  );
                })}
                {visiveis.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-[13px] text-[#8a8f9c]">
                      Nenhuma automação com esse nome.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modelos && (
        <ModelosFluxo
          contas={contas}
          inicial={modelos}
          onFechar={() => setModelos(null)}
          onEscolher={(m: Modelo, contaId) => criar(contaId, m.titulo, m.grafo())}
          onDoZero={(contaId) => criar(contaId, "Novo fluxo")}
        />
      )}
    </div>
  );
}
