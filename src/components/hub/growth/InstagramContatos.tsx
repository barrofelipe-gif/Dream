"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Valor = string | number | boolean | null;
type Campo = { id: string; accountId: string; nome: string; tipo: "TEXTO" | "NUMERO" | "DATA" | "SIM_NAO" | string };
type Conta = { id: string; username: string | null; loja: string; active: boolean };
type Contato = {
  id: string;
  accountId: string;
  conta: string | null;
  loja: string;
  cliente: string;
  nome: string | null;
  username: string | null;
  fotoUrl: string | null;
  seguidores: number | null;
  verificado: boolean;
  seguePagina: boolean | null;
  status: string;
  naoLida: boolean;
  tags: string[];
  origem: string | null;
  campos: Record<string, Valor>;
  janelaAberta: boolean;
  primeiroContato: string;
  ultimaEm: string;
  ultima: { de: "cliente" | "equipe" | "robo"; texto: string } | null;
};
type Resposta = {
  total: number;
  pagina: number;
  porPagina: number;
  paginas: number;
  contas: Conta[];
  campos: Campo[];
  tags: { tag: string; total: number }[];
  contatos: Contato[];
};
type ResultadoImport = {
  simulado: boolean;
  linhas: number;
  linhasCasadas: number;
  contatosAtualizados: number;
  semUsuario: number;
  totalNaoEncontrados: number;
  naoEncontrados: string[];
  errosValor: { linha: number; erro: string }[];
  totalErrosValor: number;
  colunasCampo: string[];
  colunaEtiquetas: boolean;
  colunasIgnoradas: string[];
};

const STATUS: Record<string, { rotulo: string; cor: string; ponto: string }> = {
  BOT: { rotulo: "Robô atendendo", cor: "bg-emerald-50 text-emerald-700", ponto: "bg-emerald-500" },
  NEEDS_HUMAN: { rotulo: "Aguardando atendente", cor: "bg-amber-50 text-amber-700", ponto: "bg-amber-500" },
  HUMAN: { rotulo: "Atendente na conversa", cor: "bg-sky-50 text-sky-700", ponto: "bg-sky-500" },
  CLOSED: { rotulo: "Encerrada", cor: "bg-zinc-100 text-zinc-600", ponto: "bg-zinc-400" },
};
const ORIGEM: Record<string, { rotulo: string; cor: string }> = {
  anuncio: { rotulo: "Anúncio", cor: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200" },
  story: { rotulo: "Story", cor: "bg-orange-50 text-orange-700 ring-orange-200" },
  organico: { rotulo: "Orgânico", cor: "bg-teal-50 text-teal-700 ring-teal-200" },
};
const TIPOS: [string, string][] = [
  ["TEXTO", "Texto"],
  ["NUMERO", "Número"],
  ["DATA", "Data"],
  ["SIM_NAO", "Sim/Não"],
];
const ORDENS: [string, string][] = [
  ["recentes", "Última mensagem (recentes)"],
  ["antigos", "Última mensagem (antigas)"],
  ["novos", "Primeiro contato (novos)"],
  ["primeiros", "Primeiro contato (antigos)"],
  ["seguidores", "Mais seguidores"],
  ["nome", "Nome (A–Z)"],
];

const campoCss =
  "w-full rounded-xl border border-[#e3e5ea] bg-white px-3 py-2 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";
const botao = "rounded-lg border border-[#e3e5ea] bg-white px-3 py-2 text-xs font-semibold text-[#1b1f2b] hover:bg-[#f7f8fa] disabled:opacity-40";
const botaoEscuro = "rounded-lg bg-[#1b1f2b] px-3 py-2 text-xs font-semibold text-white hover:bg-black disabled:opacity-40";

const PALETA = [
  "bg-violet-100 text-violet-700",
  "bg-sky-100 text-sky-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-fuchsia-100 text-fuchsia-700",
];
const corTag = (t: string) => {
  if (t === "Não atendido") return "bg-red-100 text-red-700";
  if (t === "Atendido pela equipe") return "bg-emerald-100 text-emerald-700";
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
};

function quando(iso: string) {
  const d = new Date(iso);
  const min = Math.round((Date.now() - d.getTime()) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  if (min < 60 * 24) return `há ${Math.floor(min / 60)} h`;
  if (min < 60 * 24 * 7) return `há ${Math.floor(min / 1440)} d`;
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
}
const dataLonga = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

function seguidoresCurto(n: number | null) {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (n >= 10_000) return `${Math.round(n / 1000)} mil`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".", ",")} mil`;
  return String(n);
}
const nomeExibido = (c: { nome: string | null; username: string | null; cliente: string }) =>
  c.nome || (c.username ? `@${c.username}` : `Cliente …${c.cliente}`);

function Avatar({ c, tamanho }: { c: { nome: string | null; username: string | null; cliente: string; fotoUrl: string | null }; tamanho: number }) {
  const [falhou, setFalhou] = useState(false);
  const inicial = (c.nome || c.username || c.cliente).replace("@", "").slice(0, 2).toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: tamanho, height: tamanho }}>
      {c.fotoUrl && !falhou ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={c.fotoUrl} alt="" referrerPolicy="no-referrer" onError={() => setFalhou(true)} className="h-full w-full rounded-full object-cover ring-2 ring-white" />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#c7d2fe] to-[#fbcfe8] font-semibold text-[#4b4f63] ring-2 ring-white"
          style={{ fontSize: tamanho * 0.34 }}
        >
          {inicial}
        </span>
      )}
    </span>
  );
}

function Etiqueta({ t, onRemover }: { t: string; onRemover?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${corTag(t)}`}>
      {t}
      {onRemover && (
        <button onClick={onRemover} className="opacity-60 hover:opacity-100" title="Tirar etiqueta">
          ×
        </button>
      )}
    </span>
  );
}

const valorTexto = (tipo: string, v: Valor | undefined) => {
  if (v === null || v === undefined || v === "") return "";
  if (tipo === "SIM_NAO") return v ? "Sim" : "Não";
  if (tipo === "DATA" && typeof v === "string") {
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
  }
  if (typeof v === "number") return String(v).replace(".", ",");
  return String(v);
};

function EntradaCampo({ campo, valor, onChange }: { campo: Campo; valor: Valor | undefined; onChange: (v: Valor) => void }) {
  if (campo.tipo === "SIM_NAO") {
    return (
      <div className="flex gap-1">
        {(
          [
            [true, "Sim"],
            [false, "Não"],
            [null, "—"],
          ] as [Valor, string][]
        ).map(([v, r]) => (
          <button
            key={r}
            type="button"
            onClick={() => onChange(v)}
            className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium ring-1 transition ${
              (valor ?? null) === v ? "bg-[#1b1f2b] text-white ring-[#1b1f2b]" : "bg-white text-[#5a5f6d] ring-[#e3e5ea] hover:bg-[#f7f8fa]"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
    );
  }
  if (campo.tipo === "DATA") {
    return <input type="date" value={typeof valor === "string" ? valor : ""} onChange={(e) => onChange(e.target.value || null)} className={campoCss} />;
  }
  if (campo.tipo === "NUMERO") {
    return (
      <input
        type="number"
        step="any"
        value={typeof valor === "number" ? valor : typeof valor === "string" ? valor : ""}
        onChange={(e) => onChange(e.target.value === "" ? null : e.target.value)}
        className={campoCss}
      />
    );
  }
  return <input value={typeof valor === "string" ? valor : valor === null || valor === undefined ? "" : String(valor)} onChange={(e) => onChange(e.target.value)} maxLength={500} className={campoCss} />;
}

/** Fundo escuro + caixa central (modais). */
function Modal({ titulo, onFechar, children, largura = "max-w-lg" }: { titulo: string; onFechar: () => void; children: React.ReactNode; largura?: string }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div className={`max-h-[90vh] w-full ${largura} overflow-y-auto rounded-2xl bg-white p-5 shadow-xl`}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-base font-semibold text-[#1b1f2b]">{titulo}</p>
          <button onClick={onFechar} className="text-lg text-[#8a8f9c] hover:text-[#1b1f2b]">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function InstagramContatos() {
  // filtros
  const [busca, setBusca] = useState("");
  const [q, setQ] = useState("");
  const [conta, setConta] = useState("");
  const [status, setStatus] = useState("");
  const [origem, setOrigem] = useState("");
  const [segMin, setSegMin] = useState("");
  const [incluir, setIncluir] = useState<string[]>([]);
  const [excluir, setExcluir] = useState<string[]>([]);
  const [modoIncluir, setModoIncluir] = useState<"qualquer" | "todas">("qualquer");
  const [ordem, setOrdem] = useState("recentes");
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(25);

  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // seleção: ids marcados, ou "todos do filtro"
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [todosDoFiltro, setTodosDoFiltro] = useState(false);

  const [aberto, setAberto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [modal, setModal] = useState<null | "campos" | "importar">(null);
  const [mostrarTags, setMostrarTags] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(busca.trim()), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const filtroObj = useMemo(
    () => ({ q, conta, status, origem, segMin, incluir: incluir.join(","), excluir: excluir.join(","), modoIncluir }),
    [q, conta, status, origem, segMin, incluir, excluir, modoIncluir],
  );
  const filtroQs = useMemo(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtroObj)) if (v && !(k === "modoIncluir" && v === "qualquer")) p.set(k, v);
    return p;
  }, [filtroObj]);

  // mudou o filtro: volta para a página 1 e limpa a seleção
  useEffect(() => {
    setPagina(1);
    setMarcados(new Set());
    setTodosDoFiltro(false);
  }, [filtroQs]);

  const pedido = useRef(0);
  const carregar = useCallback(async () => {
    const meu = ++pedido.current;
    setCarregando(true);
    const p = new URLSearchParams(filtroQs);
    p.set("ordem", ordem);
    p.set("pagina", String(pagina));
    p.set("porPagina", String(porPagina));
    const r = await fetch(`/api/instagram/contatos?${p}`, { cache: "no-store" }).catch(() => null);
    if (meu !== pedido.current) return;
    setCarregando(false);
    if (!r || !r.ok) {
      setErro(r?.status === 403 ? "Só administradores veem os contatos." : "Não foi possível carregar os contatos.");
      return;
    }
    setErro(null);
    setDados(await r.json());
  }, [filtroQs, ordem, pagina, porPagina]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 5000);
    return () => clearTimeout(t);
  }, [aviso]);

  const contatos = dados?.contatos ?? [];
  const contatoAberto = contatos.find((c) => c.id === aberto) ?? null;
  const multiContas = (dados?.contas.length ?? 0) > 1;
  const todosDaPagina = contatos.length > 0 && contatos.every((c) => marcados.has(c.id));
  const qtdSelecionada = todosDoFiltro ? dados?.total ?? 0 : marcados.size;
  const nomesCampos = [...new Set((dados?.campos ?? []).map((c) => c.nome))];
  const filtrosAtivos = [q, conta, status, origem, segMin].filter(Boolean).length + incluir.length + excluir.length;

  function ciclarTag(t: string) {
    if (incluir.includes(t)) {
      setIncluir(incluir.filter((x) => x !== t));
      setExcluir([...excluir, t]);
    } else if (excluir.includes(t)) {
      setExcluir(excluir.filter((x) => x !== t));
    } else setIncluir([...incluir, t]);
  }
  function limparFiltros() {
    setBusca("");
    setQ("");
    setConta("");
    setStatus("");
    setOrigem("");
    setSegMin("");
    setIncluir([]);
    setExcluir([]);
    setModoIncluir("qualquer");
  }
  function marcar(id: string) {
    setTodosDoFiltro(false);
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  function marcarPagina() {
    setTodosDoFiltro(false);
    setMarcados((m) => {
      const n = new Set(m);
      if (todosDaPagina) contatos.forEach((c) => n.delete(c.id));
      else contatos.forEach((c) => n.add(c.id));
      return n;
    });
  }
  function limparSelecao() {
    setMarcados(new Set());
    setTodosDoFiltro(false);
  }

  async function acaoEmMassa(acao: string, extra: Record<string, unknown> = {}, confirmar?: string) {
    if (!qtdSelecionada) return;
    if (confirmar && !window.confirm(confirmar)) return;
    const alvo = todosDoFiltro ? { filtro: Object.fromEntries(filtroQs) } : { ids: [...marcados] };
    const r = await fetch("/api/instagram/contatos/acoes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao, ...alvo, ...extra }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setAviso({ tipo: "ok", texto: `Pronto: ${j.afetados} contato${j.afetados === 1 ? "" : "s"} atualizado${j.afetados === 1 ? "" : "s"}.` });
      carregar();
    } else setAviso({ tipo: "erro", texto: j.error ?? "Não foi possível aplicar a ação" });
  }

  function exportar(soSelecionados: boolean) {
    const p = new URLSearchParams(filtroQs);
    p.set("ordem", ordem);
    if (soSelecionados && !todosDoFiltro && marcados.size) p.set("ids", [...marcados].join(","));
    const a = document.createElement("a");
    a.href = `/api/instagram/contatos/exportar?${p}`;
    a.download = "";
    a.click();
  }

  const sugestoesTags = (dados?.tags ?? []).map((t) => t.tag);

  return (
    <div className="space-y-3">
      <datalist id="ig-contatos-tags">
        {sugestoesTags.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      {/* Cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-base font-semibold text-[#1b1f2b]">Contatos</p>
          <p className="text-xs text-[#8a8f9c]">
            {dados ? `${dados.total.toLocaleString("pt-BR")} contato${dados.total === 1 ? "" : "s"}${filtrosAtivos ? " neste filtro" : ""}` : "Carregando…"} · todo mundo que já
            escreveu para a loja no Instagram
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => setModal("campos")} className={botao}>
            Campos personalizados
          </button>
          <button onClick={() => setModal("importar")} className={botao}>
            Importar CSV
          </button>
          <button onClick={() => exportar(false)} className={botaoEscuro} disabled={!dados?.total}>
            Exportar CSV
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="space-y-2.5 rounded-2xl border border-[#e3e5ea] bg-white p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(5,minmax(0,1fr))]">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome ou @" className={campoCss} />
          {multiContas ? (
            <select value={conta} onChange={(e) => setConta(e.target.value)} className={campoCss}>
              <option value="">Todas as contas</option>
              {dados?.contas.map((c) => (
                <option key={c.id} value={c.id}>
                  @{c.username ?? c.loja}
                </option>
              ))}
            </select>
          ) : (
            <span className="hidden lg:block" />
          )}
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={campoCss}>
            <option value="">Qualquer status</option>
            {Object.entries(STATUS).map(([k, s]) => (
              <option key={k} value={k}>
                {s.rotulo}
              </option>
            ))}
          </select>
          <select value={origem} onChange={(e) => setOrigem(e.target.value)} className={campoCss}>
            <option value="">Qualquer origem</option>
            {Object.entries(ORIGEM).map(([k, o]) => (
              <option key={k} value={k}>
                {o.rotulo}
              </option>
            ))}
            <option value="sem">Sem origem</option>
          </select>
          <input
            type="number"
            min={0}
            value={segMin}
            onChange={(e) => setSegMin(e.target.value)}
            placeholder="Seguidores mín."
            className={campoCss}
          />
          <select value={ordem} onChange={(e) => setOrdem(e.target.value)} className={campoCss}>
            {ORDENS.map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setMostrarTags(!mostrarTags)} className="text-[11px] font-medium text-[#6366f1] hover:underline">
            {mostrarTags ? "Esconder etiquetas" : `Filtrar por etiqueta (${dados?.tags.length ?? 0})`}
          </button>
          {incluir.map((t) => (
            <span key={`i-${t}`} className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-medium text-emerald-700">
              com: {t}
              <button onClick={() => setIncluir(incluir.filter((x) => x !== t))} className="opacity-60 hover:opacity-100">
                ×
              </button>
            </span>
          ))}
          {excluir.map((t) => (
            <span key={`e-${t}`} className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
              sem: {t}
              <button onClick={() => setExcluir(excluir.filter((x) => x !== t))} className="opacity-60 hover:opacity-100">
                ×
              </button>
            </span>
          ))}
          {incluir.length > 1 && (
            <button
              onClick={() => setModoIncluir(modoIncluir === "qualquer" ? "todas" : "qualquer")}
              className="rounded-full bg-[#eef0f4] px-2 py-0.5 text-[10px] font-medium text-[#5a5f6d] hover:bg-[#e3e5ea]"
              title="Trocar entre ter qualquer uma ou todas as etiquetas marcadas"
            >
              {modoIncluir === "qualquer" ? "tem qualquer uma" : "tem todas"} ⇄
            </button>
          )}
          {filtrosAtivos > 0 && (
            <button onClick={limparFiltros} className="ml-auto text-[11px] text-[#8a8f9c] hover:text-[#1b1f2b]">
              Limpar filtros
            </button>
          )}
        </div>
        {mostrarTags && (
          <div className="rounded-xl bg-[#f7f8fa] p-2.5">
            <p className="mb-1.5 text-[11px] text-[#8a8f9c]">Clique uma vez para mostrar quem tem a etiqueta, de novo para mostrar quem não tem, e de novo para tirar o filtro.</p>
            <div className="flex flex-wrap gap-1">
              {(dados?.tags ?? []).map(({ tag, total }) => {
                const est = incluir.includes(tag) ? "inc" : excluir.includes(tag) ? "exc" : "";
                return (
                  <button
                    key={tag}
                    onClick={() => ciclarTag(tag)}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition ${
                      est === "inc"
                        ? "bg-emerald-600 text-white ring-emerald-600"
                        : est === "exc"
                          ? "bg-red-600 text-white ring-red-600 line-through"
                          : `${corTag(tag)} ring-transparent hover:ring-[#c9ccd6]`
                    }`}
                  >
                    {tag} <span className="opacity-70">{total}</span>
                  </button>
                );
              })}
              {dados && dados.tags.length === 0 && <span className="text-[11px] text-[#a1a5b0]">Nenhuma etiqueta ainda.</span>}
            </div>
          </div>
        )}
      </div>

      {aviso && (
        <p className={`rounded-xl px-3 py-2 text-xs ${aviso.tipo === "ok" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>{aviso.texto}</p>
      )}

      {/* Barra de ações em massa */}
      {qtdSelecionada > 0 && (
        <BarraAcoes
          qtd={qtdSelecionada}
          todosDoFiltro={todosDoFiltro}
          total={dados?.total ?? 0}
          podeTodos={todosDaPagina && (dados?.total ?? 0) > contatos.length}
          onTodos={() => setTodosDoFiltro(true)}
          onLimpar={limparSelecao}
          campos={dados?.campos ?? []}
          nomesCampos={nomesCampos}
          onAcao={acaoEmMassa}
          onExportar={() => exportar(true)}
        />
      )}

      {/* Tabela */}
      <div className="overflow-hidden rounded-2xl border border-[#e3e5ea] bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b border-[#e3e5ea] bg-[#fafbfc] text-[11px] font-medium uppercase tracking-wide text-[#8a8f9c]">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input type="checkbox" checked={todosDaPagina} onChange={marcarPagina} className="h-4 w-4 accent-[#6366f1]" aria-label="Marcar a página" />
                </th>
                <th className="px-2 py-2.5">Contato</th>
                <th className="px-2 py-2.5 text-right">Seguidores</th>
                <th className="px-2 py-2.5">Etiquetas</th>
                <th className="px-2 py-2.5">Última mensagem</th>
                <th className="px-2 py-2.5">Origem</th>
                <th className="px-3 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody className={carregando ? "opacity-60" : ""}>
              {erro && (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-xs text-red-600">
                    {erro}
                  </td>
                </tr>
              )}
              {!erro && dados && contatos.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-[#8a8f9c]">
                    Nenhum contato {filtrosAtivos ? "neste filtro" : "ainda"}.
                  </td>
                </tr>
              )}
              {!dados && !erro && (
                <tr>
                  <td colSpan={7} className="px-4 py-10 text-center text-xs text-[#8a8f9c]">
                    Carregando…
                  </td>
                </tr>
              )}
              {contatos.map((c) => {
                const s = STATUS[c.status] ?? STATUS.CLOSED;
                const marcado = todosDoFiltro || marcados.has(c.id);
                const o = c.origem ? ORIGEM[c.origem] : null;
                return (
                  <tr
                    key={c.id}
                    onClick={() => setAberto(c.id)}
                    className={`cursor-pointer border-b border-[#f1f2f5] transition last:border-0 ${
                      aberto === c.id ? "bg-[#f1f2ff]" : marcado ? "bg-[#f7f7ff]" : "hover:bg-[#f9fafb]"
                    }`}
                  >
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={marcado} onChange={() => marcar(c.id)} className="h-4 w-4 accent-[#6366f1]" aria-label="Marcar contato" />
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar c={c} tamanho={36} />
                        <div className="min-w-0">
                          <p className="flex items-center gap-1 truncate font-semibold text-[#1b1f2b]">
                            <span className="truncate">{nomeExibido(c)}</span>
                            {c.verificado && <span className="text-[#3b82f6]">✔</span>}
                            {c.naoLida && <span className="h-2 w-2 shrink-0 rounded-full bg-[#6366f1]" title="Não lida" />}
                          </p>
                          <p className="truncate text-xs text-[#8a8f9c]">
                            {c.username ? `@${c.username}` : "sem @"}
                            {multiContas && c.conta ? <span className="text-[#c0c3cc]"> · em @{c.conta}</span> : null}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-[#1b1f2b]">
                      {seguidoresCurto(c.seguidores)}
                      {c.seguidores !== null && c.seguidores >= 10000 && <span className="ml-1 text-amber-500">★</span>}
                    </td>
                    <td className="max-w-[220px] px-2 py-2.5">
                      <div className="flex flex-wrap gap-1">
                        {c.tags.slice(0, 3).map((t) => (
                          <Etiqueta key={t} t={t} />
                        ))}
                        {c.tags.length > 3 && <span className="text-[10px] text-[#a1a5b0]">+{c.tags.length - 3}</span>}
                        {c.tags.length === 0 && <span className="text-[11px] text-[#c0c3cc]">—</span>}
                      </div>
                    </td>
                    <td className="max-w-[260px] px-2 py-2.5">
                      <p className="text-[11px] text-[#a1a5b0]">{quando(c.ultimaEm)}</p>
                      <p className="truncate text-xs text-[#5a5f6d]">
                        {c.ultima ? `${c.ultima.de === "cliente" ? "" : c.ultima.de === "equipe" ? "Equipe: " : "Robô: "}${c.ultima.texto}` : "—"}
                      </p>
                    </td>
                    <td className="px-2 py-2.5">
                      {o ? (
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${o.cor}`}>{o.rotulo}</span>
                      ) : (
                        <span className="text-[11px] text-[#c0c3cc]">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cor}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${s.ponto}`} />
                        {s.rotulo}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Paginação */}
        {dados && dados.total > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e3e5ea] px-4 py-2.5 text-xs text-[#8a8f9c]">
            <span>
              {((dados.pagina - 1) * dados.porPagina + 1).toLocaleString("pt-BR")}–{Math.min(dados.pagina * dados.porPagina, dados.total).toLocaleString("pt-BR")} de{" "}
              {dados.total.toLocaleString("pt-BR")}
            </span>
            <div className="flex items-center gap-2">
              <select value={porPagina} onChange={(e) => (setPorPagina(Number(e.target.value)), setPagina(1))} className="rounded-lg border border-[#e3e5ea] bg-white px-2 py-1 text-xs">
                {[25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n} por página
                  </option>
                ))}
              </select>
              <button onClick={() => setPagina((p) => Math.max(1, p - 1))} disabled={dados.pagina <= 1} className={botao}>
                ← Anterior
              </button>
              <span>
                {dados.pagina} / {dados.paginas}
              </span>
              <button onClick={() => setPagina((p) => Math.min(dados.paginas, p + 1))} disabled={dados.pagina >= dados.paginas} className={botao}>
                Próxima →
              </button>
            </div>
          </div>
        )}
      </div>

      {contatoAberto && (
        <PainelContato
          key={contatoAberto.id}
          c={contatoAberto}
          campos={(dados?.campos ?? []).filter((f) => f.accountId === contatoAberto.accountId)}
          onFechar={() => setAberto(null)}
          onMudou={carregar}
          onAbrirCampos={() => setModal("campos")}
        />
      )}

      {modal === "campos" && dados && <GerenciarCampos contas={dados.contas} contaAtual={conta} onFechar={() => setModal(null)} onMudou={carregar} />}
      {modal === "importar" && dados && (
        <Importar contas={dados.contas} campos={dados.campos} onFechar={() => setModal(null)} onMudou={carregar} />
      )}
    </div>
  );
}

function BarraAcoes({
  qtd,
  todosDoFiltro,
  total,
  podeTodos,
  onTodos,
  onLimpar,
  campos,
  nomesCampos,
  onAcao,
  onExportar,
}: {
  qtd: number;
  todosDoFiltro: boolean;
  total: number;
  podeTodos: boolean;
  onTodos: () => void;
  onLimpar: () => void;
  campos: Campo[];
  nomesCampos: string[];
  onAcao: (acao: string, extra?: Record<string, unknown>, confirmar?: string) => Promise<void>;
  onExportar: () => void;
}) {
  const [aba, setAba] = useState<null | "add" | "rem" | "campo">(null);
  const [tag, setTag] = useState("");
  const [campoNome, setCampoNome] = useState(nomesCampos[0] ?? "");
  const [valor, setValor] = useState<Valor>(null);
  const [rodando, setRodando] = useState(false);
  const campoSel = campos.find((c) => c.nome === campoNome);
  const plural = qtd === 1 ? "contato" : "contatos";

  async function rodar(acao: string, extra?: Record<string, unknown>, confirmar?: string) {
    setRodando(true);
    await onAcao(acao, extra, confirmar);
    setRodando(false);
    setAba(null);
    setTag("");
  }

  return (
    <div className="sticky top-2 z-20 rounded-2xl border border-[#c7d2fe] bg-[#f5f6ff] p-3 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[#1b1f2b]">
          {qtd.toLocaleString("pt-BR")} {plural} selecionado{qtd === 1 ? "" : "s"}
          {todosDoFiltro && <span className="font-normal text-[#5a5f6d]"> (todos do filtro)</span>}
        </span>
        {podeTodos && !todosDoFiltro && (
          <button onClick={onTodos} className="text-xs font-medium text-[#6366f1] hover:underline">
            Selecionar todos os {total.toLocaleString("pt-BR")} do filtro
          </button>
        )}
        <button onClick={onLimpar} className="text-xs text-[#8a8f9c] hover:text-[#1b1f2b]">
          Limpar seleção
        </button>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button onClick={() => setAba(aba === "add" ? null : "add")} className={botao} disabled={rodando}>
            + Etiqueta
          </button>
          <button onClick={() => setAba(aba === "rem" ? null : "rem")} className={botao} disabled={rodando}>
            − Etiqueta
          </button>
          <button onClick={() => setAba(aba === "campo" ? null : "campo")} className={botao} disabled={rodando || nomesCampos.length === 0} title={nomesCampos.length ? "" : "Crie um campo personalizado primeiro"}>
            Definir campo
          </button>
          <button onClick={() => rodar("DEVOLVER_ROBO", {}, `Devolver ${qtd} ${plural} ao robô? Ele volta a responder sozinho.`)} className={botao} disabled={rodando}>
            Devolver ao robô
          </button>
          <button onClick={() => rodar("ENCERRAR", {}, `Encerrar ${qtd} ${plural}?`)} className={botao} disabled={rodando}>
            Encerrar
          </button>
          <button onClick={onExportar} className={botao} disabled={rodando}>
            Exportar
          </button>
        </div>
      </div>
      {(aba === "add" || aba === "rem") && (
        <form
          className="mt-2.5 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!tag.trim()) return;
            rodar(aba === "add" ? "ADICIONAR_TAG" : "REMOVER_TAG", { tag: tag.trim() }, qtd > 50 ? `${aba === "add" ? "Adicionar" : "Remover"} "${tag.trim()}" em ${qtd} ${plural}?` : undefined);
          }}
        >
          <input autoFocus list="ig-contatos-tags" value={tag} onChange={(e) => setTag(e.target.value)} placeholder="Nome da etiqueta" maxLength={40} className={`${campoCss} max-w-xs`} />
          <button type="submit" className={botaoEscuro} disabled={rodando || !tag.trim()}>
            {rodando ? "Aplicando…" : aba === "add" ? "Adicionar etiqueta" : "Remover etiqueta"}
          </button>
        </form>
      )}
      {aba === "campo" && (
        <form
          className="mt-2.5 flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!campoNome) return;
            rodar("DEFINIR_CAMPO", { campo: campoNome, valor }, `Definir "${campoNome}" = ${valorTexto(campoSel?.tipo ?? "TEXTO", valor) || "(vazio)"} em ${qtd} ${plural}?`);
          }}
        >
          <select
            value={campoNome}
            onChange={(e) => {
              setCampoNome(e.target.value);
              setValor(null);
            }}
            className={`${campoCss} max-w-[200px]`}
          >
            {nomesCampos.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <div className="w-56">{campoSel && <EntradaCampo campo={campoSel} valor={valor} onChange={setValor} />}</div>
          <button type="submit" className={botaoEscuro} disabled={rodando}>
            {rodando ? "Aplicando…" : "Aplicar"}
          </button>
          <span className="text-[11px] text-[#8a8f9c]">Vazio apaga o valor.</span>
        </form>
      )}
    </div>
  );
}

function PainelContato({
  c,
  campos,
  onFechar,
  onMudou,
  onAbrirCampos,
}: {
  c: Contato;
  campos: Campo[];
  onFechar: () => void;
  onMudou: () => void;
  onAbrirCampos: () => void;
}) {
  const [valores, setValores] = useState<Record<string, Valor>>(c.campos);
  const [tags, setTags] = useState<string[]>(c.tags);
  const [novaTag, setNovaTag] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const s = STATUS[c.status] ?? STATUS.CLOSED;
  const o = c.origem ? ORIGEM[c.origem] : null;

  const alterados = campos.filter((f) => JSON.stringify(valores[f.nome] ?? null) !== JSON.stringify(c.campos[f.nome] ?? null));

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  async function patch(corpo: Record<string, unknown>) {
    const r = await fetch(`/api/instagram/contatos/${c.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  }
  async function mexerTag(corpo: { tagAdd?: string; tagRemove?: string }) {
    const { ok, j } = await patch(corpo);
    if (ok && j.tags) {
      setTags(j.tags);
      onMudou();
    }
  }
  async function salvar() {
    setSalvando(true);
    setMsg(null);
    const mud = Object.fromEntries(alterados.map((f) => [f.nome, valores[f.nome] ?? null]));
    const { ok, j } = await patch({ campos: mud });
    setSalvando(false);
    if (ok) {
      setValores(j.campos);
      setMsg({ tipo: "ok", texto: "Campos salvos." });
      onMudou();
    } else setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível salvar" });
  }

  const linha = (rotulo: string, valor: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <span className="text-[#8a8f9c]">{rotulo}</span>
      <span className="text-right font-medium text-[#1b1f2b]">{valor}</span>
    </div>
  );

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/20" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <aside className="flex h-full w-full max-w-[400px] flex-col bg-white shadow-2xl">
        <div className="flex items-start gap-3 border-b border-[#e3e5ea] p-5">
          <Avatar c={c} tamanho={56} />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1 truncate text-base font-semibold text-[#1b1f2b]">
              {nomeExibido(c)}
              {c.verificado && <span className="text-[#3b82f6]">✔</span>}
            </p>
            {c.username && (
              <a href={`https://instagram.com/${c.username}`} target="_blank" rel="noreferrer" className="text-xs text-[#6366f1] hover:underline">
                @{c.username}
              </a>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1">
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${s.cor}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${s.ponto}`} />
                {s.rotulo}
              </span>
              {o && <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${o.cor}`}>{o.rotulo}</span>}
            </div>
          </div>
          <button onClick={onFechar} className="text-xl leading-none text-[#8a8f9c] hover:text-[#1b1f2b]">
            ×
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <section>
            <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[#a1a5b0]">Perfil</p>
            <div className="divide-y divide-[#f1f2f5]">
              {linha("Seguidores", c.seguidores !== null ? c.seguidores.toLocaleString("pt-BR") : "—")}
              {linha("Segue a loja", c.seguePagina === null ? "—" : c.seguePagina ? "Sim" : "Não")}
              {linha("Conta", c.conta ? `@${c.conta}` : c.loja)}
              {linha("Primeiro contato", dataLonga(c.primeiroContato))}
              {linha("Última mensagem", dataLonga(c.ultimaEm))}
              {linha("Janela de 24h", c.janelaAberta ? <span className="text-emerald-700">aberta</span> : <span className="text-[#8a8f9c]">fechada</span>)}
            </div>
            {c.ultima && <p className="mt-2 rounded-xl bg-[#f7f8fa] px-3 py-2 text-xs text-[#5a5f6d]">“{c.ultima.texto}”</p>}
          </section>

          <section>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-[#a1a5b0]">Etiquetas</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {tags.map((t) => (
                <Etiqueta key={t} t={t} onRemover={() => mexerTag({ tagRemove: t })} />
              ))}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (novaTag.trim()) mexerTag({ tagAdd: novaTag.trim() });
                  setNovaTag("");
                }}
              >
                <input
                  list="ig-contatos-tags"
                  value={novaTag}
                  onChange={(e) => setNovaTag(e.target.value)}
                  placeholder="+ etiqueta"
                  maxLength={40}
                  className="w-28 rounded-full border border-dashed border-[#d5d8e0] bg-transparent px-2.5 py-0.5 text-[11px] outline-none focus:border-[#6366f1]"
                />
              </form>
            </div>
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#a1a5b0]">Campos personalizados</p>
              <button onClick={onAbrirCampos} className="text-[11px] font-medium text-[#6366f1] hover:underline">
                Gerenciar
              </button>
            </div>
            {campos.length === 0 ? (
              <p className="rounded-xl bg-[#f7f8fa] px-3 py-3 text-xs text-[#8a8f9c]">
                Nenhum campo criado para esta conta. Crie campos como “Cidade”, “CNPJ” ou “Data do último pedido” em Gerenciar.
              </p>
            ) : (
              <div className="space-y-2.5">
                {campos.map((f) => (
                  <label key={f.id} className="block">
                    <span className="mb-1 flex items-center justify-between text-xs font-medium text-[#5a5f6d]">
                      {f.nome}
                      <span className="text-[10px] font-normal text-[#a1a5b0]">{TIPOS.find(([k]) => k === f.tipo)?.[1] ?? f.tipo}</span>
                    </span>
                    <EntradaCampo campo={f} valor={valores[f.nome]} onChange={(v) => setValores((x) => ({ ...x, [f.nome]: v }))} />
                  </label>
                ))}
              </div>
            )}
          </section>
        </div>

        {campos.length > 0 && (
          <div className="flex items-center justify-between gap-2 border-t border-[#e3e5ea] p-4">
            <span className={`text-xs ${msg?.tipo === "erro" ? "text-red-600" : "text-emerald-700"}`}>
              {msg?.texto ?? (alterados.length ? `${alterados.length} alteraç${alterados.length === 1 ? "ão" : "ões"} não salva${alterados.length === 1 ? "" : "s"}` : "")}
            </span>
            <button onClick={salvar} disabled={salvando || alterados.length === 0} className={botaoEscuro}>
              {salvando ? "Salvando…" : "Salvar campos"}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

function GerenciarCampos({ contas, contaAtual, onFechar, onMudou }: { contas: Conta[]; contaAtual: string; onFechar: () => void; onMudou: () => void }) {
  const [campos, setCampos] = useState<(Campo & { conta: string | null })[] | null>(null);
  const [accountId, setAccountId] = useState(contaAtual || contas[0]?.id || "");
  const [nome, setNome] = useState("");
  const [tipo, setTipo] = useState("TEXTO");
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/instagram/campos", { cache: "no-store" });
    if (r.ok) setCampos((await r.json()).campos);
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function criar() {
    setMsg(null);
    const r = await fetch("/api/instagram/campos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, nome, tipo }) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setNome("");
      setMsg({ tipo: "ok", texto: `Campo “${j.campo.nome}” criado.` });
      carregar();
      onMudou();
    } else setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível criar" });
  }
  async function apagar(c: Campo) {
    if (!window.confirm(`Apagar o campo “${c.nome}”? O valor dele some de todos os contatos.`)) return;
    const r = await fetch(`/api/instagram/campos?id=${encodeURIComponent(c.id)}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (r.ok) {
      setMsg({ tipo: "ok", texto: `Campo apagado${j.contatosLimpos ? ` (tirado de ${j.contatosLimpos} contato${j.contatosLimpos === 1 ? "" : "s"})` : ""}.` });
      carregar();
      onMudou();
    } else setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível apagar" });
  }

  const doGrupo = (campos ?? []).filter((c) => c.accountId === accountId);

  return (
    <Modal titulo="Campos personalizados" onFechar={onFechar}>
      <p className="mb-3 text-xs text-[#8a8f9c]">
        Guarde informações próprias de cada contato (como no ManyChat): cidade, CNPJ, tamanho, se já é revendedora… Cada conta do Instagram tem os seus campos.
      </p>
      {contas.length > 1 && (
        <div className="mb-3 flex gap-1.5">
          {contas.map((c) => (
            <button
              key={c.id}
              onClick={() => setAccountId(c.id)}
              className={`rounded-full px-3 py-1 text-[11px] font-medium transition ${accountId === c.id ? "bg-[#1b1f2b] text-white" : "bg-[#eef0f4] text-[#5a5f6d] hover:bg-[#e3e5ea]"}`}
            >
              @{c.username ?? c.loja}
            </button>
          ))}
        </div>
      )}
      <div className="divide-y divide-[#f1f2f5] rounded-xl border border-[#e3e5ea]">
        {campos === null && <p className="p-3 text-xs text-[#8a8f9c]">Carregando…</p>}
        {campos && doGrupo.length === 0 && <p className="p-3 text-xs text-[#8a8f9c]">Nenhum campo ainda.</p>}
        {doGrupo.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className="text-sm font-medium text-[#1b1f2b]">{c.nome}</span>
            <span className="flex items-center gap-3">
              <span className="rounded-full bg-[#eef0f4] px-2 py-0.5 text-[10px] font-medium text-[#5a5f6d]">{TIPOS.find(([k]) => k === c.tipo)?.[1] ?? c.tipo}</span>
              <button onClick={() => apagar(c)} className="text-[11px] text-red-600 hover:underline">
                Apagar
              </button>
            </span>
          </div>
        ))}
      </div>
      <form
        className="mt-3 flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (nome.trim() && accountId) criar();
        }}
      >
        <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do campo (ex.: Cidade)" maxLength={40} className={`${campoCss} min-w-0 flex-1`} />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} className={`${campoCss} w-32`}>
          {TIPOS.map(([k, r]) => (
            <option key={k} value={k}>
              {r}
            </option>
          ))}
        </select>
        <button type="submit" className={botaoEscuro} disabled={!nome.trim() || !accountId}>
          Criar campo
        </button>
      </form>
      {msg && <p className={`mt-2 text-xs ${msg.tipo === "ok" ? "text-emerald-700" : "text-red-600"}`}>{msg.texto}</p>}
    </Modal>
  );
}

function Importar({ contas, campos, onFechar, onMudou }: { contas: Conta[]; campos: Campo[]; onFechar: () => void; onMudou: () => void }) {
  const [csv, setCsv] = useState("");
  const [arquivo, setArquivo] = useState("");
  const [accountId, setAccountId] = useState("");
  const [res, setRes] = useState<ResultadoImport | null>(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(simular: boolean) {
    setRodando(true);
    setErro(null);
    const r = await fetch("/api/instagram/contatos/importar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csv, accountId: accountId || undefined, simular }),
    });
    const j = await r.json().catch(() => ({}));
    setRodando(false);
    if (!r.ok) {
      setErro(j.error ?? "Não foi possível ler o arquivo");
      setRes(null);
      return;
    }
    setRes(j);
    if (!simular) onMudou();
  }

  const nomes = [...new Set(campos.filter((c) => !accountId || c.accountId === accountId).map((c) => c.nome))];
  const modelo = ["@", "Etiquetas", "Remover etiquetas", ...nomes].join(";");

  return (
    <Modal titulo="Importar CSV" onFechar={onFechar} largura="max-w-xl">
      <div className="space-y-3 text-xs text-[#5a5f6d]">
        <p>
          Atualiza <b>só contatos que já existem</b>, casando pelo @ do Instagram. Ninguém novo é criado: o Instagram só cria o contato quando a pessoa escreve para a loja. Nada
          é enviado para os clientes.
        </p>
        <div className="rounded-xl bg-[#f7f8fa] p-3">
          <p className="mb-1 font-medium text-[#1b1f2b]">Colunas aceitas</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              <b>@</b> (obrigatória) — o usuário do Instagram
            </li>
            <li>
              <b>Etiquetas</b> — adiciona; separe várias por vírgula
            </li>
            <li>
              <b>Remover etiquetas</b> — tira as etiquetas listadas
            </li>
            <li>Uma coluna com o nome de cada campo personalizado{nomes.length ? `: ${nomes.join(", ")}` : " (crie os campos antes)"}</li>
          </ul>
          <p className="mt-1.5">Célula vazia não apaga nada. O arquivo exportado daqui pode ser editado e importado de volta.</p>
          <p className="mt-1.5 break-all font-mono text-[10px] text-[#8a8f9c]">{modelo}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${botao} cursor-pointer`}>
            Escolher arquivo
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                setArquivo(f.name);
                setRes(null);
                setErro(null);
                setCsv(await f.text());
              }}
            />
          </label>
          <span className="truncate text-[#8a8f9c]">{arquivo || "nenhum arquivo"}</span>
          {contas.length > 1 && (
            <select value={accountId} onChange={(e) => (setAccountId(e.target.value), setRes(null))} className={`${campoCss} ml-auto w-auto`}>
              <option value="">Todas as contas</option>
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  Só @{c.username ?? c.loja}
                </option>
              ))}
            </select>
          )}
        </div>

        {erro && <p className="rounded-xl bg-red-50 px-3 py-2 text-red-700">{erro}</p>}

        {res && (
          <div className={`rounded-xl p-3 ${res.simulado ? "bg-[#f5f6ff]" : "bg-emerald-50"}`}>
            <p className="mb-1 font-semibold text-[#1b1f2b]">{res.simulado ? "Prévia (nada foi gravado ainda)" : "Importação concluída"}</p>
            <ul className="space-y-0.5">
              <li>
                {res.linhas} linha{res.linhas === 1 ? "" : "s"} no arquivo · {res.linhasCasadas} com contato encontrado
              </li>
              <li>
                <b>
                  {res.contatosAtualizados} contato{res.contatosAtualizados === 1 ? "" : "s"} {res.simulado ? "seriam atualizados" : "atualizados"}
                </b>
              </li>
              {res.colunasCampo.length > 0 && <li>Campos lidos: {res.colunasCampo.join(", ")}</li>}
              {!res.colunaEtiquetas && res.colunasCampo.length === 0 && <li className="text-amber-700">Nenhuma coluna de etiquetas ou de campo reconhecida.</li>}
              {res.colunasIgnoradas.length > 0 && <li className="text-amber-700">Colunas ignoradas (não são campos desta conta): {res.colunasIgnoradas.join(", ")}</li>}
              {res.semUsuario > 0 && <li className="text-amber-700">{res.semUsuario} linha(s) sem @</li>}
              {res.totalNaoEncontrados > 0 && (
                <li className="text-amber-700">
                  {res.totalNaoEncontrados} @ não encontrado{res.totalNaoEncontrados === 1 ? "" : "s"} (nunca escreveram para a loja): {res.naoEncontrados.slice(0, 12).join(", ")}
                  {res.naoEncontrados.length > 12 ? "…" : ""}
                </li>
              )}
              {res.totalErrosValor > 0 && (
                <li className="text-red-700">
                  {res.totalErrosValor} valor(es) inválido(s), ignorado(s):
                  <ul className="mt-0.5 list-disc pl-4">
                    {res.errosValor.slice(0, 8).map((e, i) => (
                      <li key={i}>
                        linha {e.linha}: {e.erro}
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onFechar} className={botao}>
            {res && !res.simulado ? "Fechar" : "Cancelar"}
          </button>
          <button onClick={() => enviar(true)} className={botao} disabled={!csv || rodando}>
            {rodando ? "Lendo…" : "Ver prévia"}
          </button>
          <button
            onClick={() => enviar(false)}
            className={botaoEscuro}
            disabled={!csv || rodando || !res || !res.simulado || res.contatosAtualizados === 0}
            title={!res ? "Veja a prévia antes" : ""}
          >
            Importar
          </button>
        </div>
      </div>
    </Modal>
  );
}
