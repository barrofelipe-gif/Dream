"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SinoInstagram } from "@/components/hub/growth/InstagramRegras";
import { useEstreito, useTelaCheiaCelular } from "@/components/hub/growth/useTelaCheiaCelular";

type Resumo = {
  id: string;
  status: string;
  naoLida: boolean;
  tags: string[];
  cliente: string;
  nome: string | null;
  username: string | null;
  fotoUrl: string | null;
  seguidores: number | null;
  verificado: boolean;
  conta: string;
  loja: string;
  ultimaEm: string;
  ultima: { de: "cliente" | "equipe" | "robo"; texto: string } | null;
};
type Msg = { id: string; de: "cliente" | "equipe" | "robo"; texto: string; em: string; origem: string | null };
type Conversa = {
  id: string;
  status: string;
  tags: string[];
  cliente: string;
  nome: string | null;
  username: string | null;
  fotoUrl: string | null;
  seguidores: number | null;
  verificado: boolean;
  seguePagina: boolean | null;
  primeiroContato: string;
  totalMensagens: number;
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
const GRANDE = 10000; // a partir de quantos seguidores destacamos o perfil

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
const dia = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "long", year: "numeric" }).format(new Date(iso));

function seguidoresCurto(n: number | null) {
  if (n === null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (n >= 10_000) return `${Math.round(n / 1000)} mil`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(".", ",")} mil`;
  return String(n);
}

function nomeExibido(c: { nome: string | null; username: string | null; cliente: string }) {
  return c.nome || (c.username ? `@${c.username}` : `Cliente …${c.cliente}`);
}

function Avatar({
  c,
  tamanho,
  pontoCor,
}: {
  c: { nome: string | null; username: string | null; cliente: string; fotoUrl: string | null };
  tamanho: number;
  pontoCor?: string;
}) {
  const [falhou, setFalhou] = useState(false);
  const inicial = (c.nome || c.username || c.cliente).replace("@", "").slice(0, 2).toUpperCase();
  return (
    <span className="relative inline-flex shrink-0" style={{ width: tamanho, height: tamanho }}>
      {c.fotoUrl && !falhou ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={c.fotoUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFalhou(true)}
          className="h-full w-full rounded-full object-cover ring-2 ring-white"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full bg-gradient-to-br from-[#c7d2fe] to-[#fbcfe8] font-semibold text-[#4b4f63] ring-2 ring-white"
          style={{ fontSize: tamanho * 0.34 }}
        >
          {inicial}
        </span>
      )}
      {pontoCor && (
        <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${pontoCor}`} />
      )}
    </span>
  );
}

function SeloGrande({ n }: { n: number | null }) {
  if (n === null || n < GRANDE) return null;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-100 to-pink-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
      ★ Perfil grande
    </span>
  );
}

const PALETA = ["bg-violet-100 text-violet-700", "bg-sky-100 text-sky-700", "bg-emerald-100 text-emerald-700", "bg-amber-100 text-amber-800", "bg-rose-100 text-rose-700", "bg-teal-100 text-teal-700", "bg-fuchsia-100 text-fuchsia-700"];
const corTag = (t: string) => {
  if (t === "Não atendido") return "bg-red-100 text-red-700";
  if (t === "Atendido pela equipe") return "bg-emerald-100 text-emerald-700";
  let h = 0;
  for (const ch of t) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA[h % PALETA.length];
};
const TAGS_SUGERIDAS = ["Pediu humano", "Sem dúvida informada", "Não atendido", "Atendido pela equipe", "Resolvido pelo robô", "Quer comprar", "Pedido atrasado", "Cliente VIP"];

function Etiqueta({ t, onRemover }: { t: string; onRemover?: () => void }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${corTag(t)}`}>
      {t}
      {onRemover && (
        <button onClick={onRemover} className="opacity-60 hover:opacity-100" title="Tirar etiqueta">
          ×
        </button>
      )}
    </span>
  );
}

const FILTROS: [string, string][] = [
  ["todas", "Todas"],
  ["NAO_LIDAS", "Não lidas"],
  ["NEEDS_HUMAN", "Aguardando"],
  ["BOT", "Robô"],
  ["HUMAN", "Equipe"],
];

export default function InstagramInbox() {
  const [lista, setLista] = useState<Resumo[] | null>(null);
  const [filtro, setFiltro] = useState("todas");
  const [filtroTag, setFiltroTag] = useState<string | null>(null);
  const [novaTag, setNovaTag] = useState("");
  const [salvas, setSalvas] = useState<{ id: string; atalho: string; titulo: string; texto: string }[]>([]);
  useEffect(() => {
    fetch("/api/instagram/respostas-salvas", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && setSalvas(j.respostas))
      .catch(() => {});
  }, []);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [mais, setMais] = useState(false); // celular: ações extras, etiquetas e perfil ficam recolhidos
  const fim = useRef<HTMLDivElement>(null);
  const caixa = useRef<HTMLDivElement>(null);

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

  // Celular (caixa mais estreita que 48rem, o mesmo corte do @3xl): a conversa aberta cobre a tela inteira.
  const estreita = useEstreito(768, caixa);
  const abrirConversa = useCallback((id: string | null) => {
    setMais(false);
    setSelecionada(id);
  }, []);
  const fecharConversa = useCallback(() => abrirConversa(null), [abrirConversa]);
  const estiloTela = useTelaCheiaCelular(!!selecionada && estreita, fecharConversa);

  const noFiltro = (c: Resumo, f: string) => f === "todas" || (f === "NAO_LIDAS" ? c.naoLida : c.status === f);
  const termo = busca.trim().toLowerCase().replace(/^@/, "");
  const visiveis = (lista ?? [])
    .filter((c) => noFiltro(c, filtro))
    .filter((c) => !filtroTag || c.tags.includes(filtroTag))
    .filter(
      (c) =>
        !termo ||
        [c.nome, c.username, c.ultima?.texto, ...c.tags].some((v) => v?.toLowerCase().includes(termo)),
    );
  const todasTags = [...new Set((lista ?? []).flatMap((c) => c.tags))].sort();
  async function mexerTag(corpo: { tagAdd?: string; tagRemove?: string }) {
    if (!selecionada) return;
    const r = await fetch(`/api/instagram/conversas/${selecionada}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    });
    if (r.ok) {
      const { tags } = await r.json();
      setConversa((c) => (c ? { ...c, tags } : c));
      carregarLista();
    }
  }
  const naoLidas = (lista ?? []).filter((c) => c.naoLida).length;
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

  async function marcarNaoLida() {
    if (!selecionada) return;
    await fetch(`/api/instagram/conversas/${selecionada}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ naoLida: true }),
    });
    setSelecionada(null);
    setConversa(null);
    await carregarLista();
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

  // Mensagens agrupadas por dia, com separador.
  const blocos: { dia: string; msgs: Msg[] }[] = [];
  for (const m of conversa?.mensagens ?? []) {
    const d = dia(m.em);
    if (!blocos.length || blocos[blocos.length - 1].dia !== d) blocos.push({ dia: d, msgs: [] });
    blocos[blocos.length - 1].msgs.push(m);
  }

  return (
    <div className="@container" ref={caixa}>
    <div className="grid grid-cols-1 overflow-hidden rounded-2xl border border-[#e3e5ea] bg-white shadow-sm @3xl:h-[max(640px,calc(100vh-200px))] @3xl:grid-cols-[290px_minmax(0,1fr)] @5xl:grid-cols-[290px_minmax(0,1fr)_270px]">
      {/* Lista (no celular continua montada por baixo da conversa aberta: a rolagem e o filtro ficam onde estavam) */}
      <div className="flex min-h-0 flex-col border-[#e3e5ea] @3xl:border-r">
        <div className="border-b border-[#e3e5ea] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <p className="flex items-center gap-2 text-base font-semibold text-[#1b1f2b]">
              Mensagens
              <SinoInstagram onAbrirConversa={(id) => abrirConversa(id)} />
            </p>
            {naoLidas > 0 && (
              <span className="rounded-full bg-[#6366f1] px-2.5 py-0.5 text-[11px] font-semibold text-white">{naoLidas} não lida{naoLidas > 1 ? "s" : ""}</span>
            )}
            {aguardando > 0 && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
                {aguardando} aguardando
              </span>
            )}
          </div>
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar nome, @, mensagem ou etiqueta"
            aria-label="Buscar conversa"
            className="mt-2.5 min-h-[40px] w-full rounded-xl border border-[#e3e5ea] bg-[#f7f8fa] px-3 text-base text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:bg-white @3xl:min-h-[34px] @3xl:text-sm"
          />
          <div className="-mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
            {FILTROS.map(([v, r]) => {
              const n = v === "todas" ? 0 : (lista ?? []).filter((c) => noFiltro(c, v)).length;
              return (
                <button
                  key={v}
                  onClick={() => setFiltro(v)}
                  aria-pressed={filtro === v}
                  className={`min-h-[32px] shrink-0 whitespace-nowrap rounded-full px-3 py-1 text-[11px] font-medium transition ${filtro === v ? "bg-[#1b1f2b] text-white" : "bg-[#eef0f4] text-[#5a5f6d] hover:bg-[#e3e5ea]"}`}
                >
                  {r}
                  {n > 0 && <span className="ml-1 opacity-70">{n}</span>}
                </button>
              );
            })}
          </div>
          {todasTags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {todasTags.map((t) => (
                <button
                  key={t}
                  onClick={() => setFiltroTag(filtroTag === t ? null : t)}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 transition ${filtroTag === t ? "bg-[#1b1f2b] text-white ring-[#1b1f2b]" : `${corTag(t)} ring-transparent hover:ring-[#c9ccd6]`}`}
                >
                  {t}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 @3xl:overflow-y-auto">
          {lista === null && <p className="p-4 text-xs text-[#8a8f9c]">Carregando…</p>}
          {lista && visiveis.length === 0 && (
            <div className="p-6 text-center">
              <p className="text-sm font-medium text-[#1b1f2b]">{lista.length === 0 ? "Nenhuma conversa ainda" : "Nada encontrado"}</p>
              <p className="mt-1 text-xs text-[#8a8f9c]">
                {lista.length === 0
                  ? "Quando alguém mandar mensagem para a loja no Instagram, a conversa aparece aqui."
                  : "Nenhuma conversa com esse filtro ou busca."}
              </p>
              {lista.length > 0 && (filtro !== "todas" || filtroTag || termo) && (
                <button
                  onClick={() => {
                    setFiltro("todas");
                    setFiltroTag(null);
                    setBusca("");
                  }}
                  className="mt-3 min-h-[40px] rounded-xl bg-[#eef0f4] px-4 text-xs font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]"
                >
                  Limpar filtros
                </button>
              )}
            </div>
          )}
          {visiveis.map((c) => {
            const s = STATUS[c.status] ?? STATUS.CLOSED;
            const ativa = c.id === selecionada;
            return (
              <button
                key={c.id}
                onClick={() => abrirConversa(c.id)}
                className={`flex w-full items-start gap-3 border-b border-[#f1f2f5] px-4 py-3 text-left transition ${ativa ? "bg-[#f1f2ff]" : c.naoLida ? "bg-[#f7f7ff] hover:bg-[#f1f2ff]" : "hover:bg-[#f9fafb]"}`}
              >
                <Avatar c={c} tamanho={44} pontoCor={s.ponto} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className={`truncate text-sm text-[#1b1f2b] ${c.naoLida ? "font-bold" : "font-semibold"}`}>{nomeExibido(c)}</span>
                      {c.naoLida && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#6366f1]" title="Não lida" />}
                      {c.verificado && <span className="text-[#3b82f6]" title="Verificado">✔</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-[#a1a5b0]">{quando(c.ultimaEm)}</span>
                  </span>
                  <span className="block truncate text-xs text-[#8a8f9c]">
                    {c.username && c.nome ? `@${c.username} · ` : ""}
                    {c.seguidores !== null ? `${seguidoresCurto(c.seguidores)} seguidores` : ""}
                  </span>
                  <span className={`mt-0.5 block truncate text-[13px] ${c.naoLida ? "font-semibold text-[#1b1f2b]" : "text-[#5a5f6d]"}`}>
                    {c.ultima
                      ? `${c.ultima.de === "cliente" ? "" : c.ultima.de === "equipe" ? "Equipe: " : "Robô: "}${c.ultima.texto}`
                      : "—"}
                  </span>
                  {c.tags.length > 0 && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map((t) => (
                        <Etiqueta key={t} t={t} />
                      ))}
                      {c.tags.length > 3 && <span className="text-[10px] text-[#a1a5b0]">+{c.tags.length - 3}</span>}
                    </span>
                  )}
                  <span className="mt-1.5 flex items-center gap-1.5">
                    <SeloGrande n={c.seguidores} />
                    <span className="text-[10px] uppercase tracking-wide text-[#a1a5b0]">@{c.conta}</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Chat */}
      <div
        className={`${selecionada ? "fixed inset-0 z-50 flex bg-white @3xl:static @3xl:z-auto" : "hidden @3xl:flex"} min-h-0 min-w-0 flex-col`}
        style={estiloTela}
        role={selecionada ? "region" : undefined}
        aria-label={selecionada ? "Conversa aberta" : undefined}
      >
        {!selecionada || !conversa ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
            {selecionada && (
              <button onClick={() => abrirConversa(null)} className="absolute left-2 top-2 flex min-h-[44px] items-center rounded-xl px-3 text-sm font-medium text-[#6366f1] @3xl:hidden">
                ← Voltar
              </button>
            )}
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#eef0f4] text-2xl">💬</span>
            <p className="text-sm font-medium text-[#1b1f2b]">
              {selecionada ? "Carregando conversa…" : "Escolha uma conversa"}
            </p>
            {!selecionada && <p className="text-xs text-[#8a8f9c]">As mensagens do Instagram aparecem aqui em tempo real.</p>}
          </div>
        ) : (
          <>
            <div className="border-b border-[#e3e5ea] px-3 py-2 @3xl:px-5 @3xl:py-3">
              <div className="flex items-center gap-2 @3xl:gap-3">
                <button
                  onClick={() => abrirConversa(null)}
                  aria-label="Voltar para a lista"
                  className="-ml-1 flex h-11 min-w-[44px] shrink-0 items-center justify-center rounded-xl text-lg text-[#6366f1] hover:bg-[#f4f5f8] @3xl:hidden"
                >
                  ←
                </button>
                <Avatar c={conversa} tamanho={40} />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1 truncate text-sm font-semibold text-[#1b1f2b]">
                    {nomeExibido(conversa)}
                    {conversa.verificado && <span className="text-[#3b82f6]">✔</span>}
                  </p>
                  <p className="truncate text-[11px] text-[#8a8f9c]">
                    {conversa.username ? `@${conversa.username} · ` : ""}
                    loja {conversa.loja}
                  </p>
                </div>
                {st && <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${st.cor}`}>{st.rotulo}</span>}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 @3xl:mt-2.5">
                {conversa.status !== "HUMAN" && (
                  <button onClick={() => mudarStatus("HUMAN")} className="min-h-[40px] @3xl:min-h-0 rounded-lg bg-[#1b1f2b] px-3 py-1.5 text-xs font-medium text-white hover:bg-black">
                    Assumir conversa
                  </button>
                )}
                {conversa.status !== "BOT" && (
                  <button
                    onClick={() => mudarStatus("BOT")}
                    className={`min-h-[40px] @3xl:inline-block @3xl:min-h-0 ${conversa.status === "HUMAN" || mais ? "" : "hidden"} rounded-lg bg-[#eef0f4] px-3 py-1.5 text-xs font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]`}
                  >
                    Devolver ao robô
                  </button>
                )}
                <button onClick={marcarNaoLida} className={`min-h-[40px] @3xl:inline-block @3xl:min-h-0 ${mais ? "" : "hidden"} rounded-lg bg-[#eef0f4] px-3 py-1.5 text-xs font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]`}>
                  Marcar como não lida
                </button>
                {conversa.status !== "CLOSED" && (
                  <button onClick={() => mudarStatus("CLOSED")} className={`min-h-[40px] @3xl:inline-block @3xl:min-h-0 ${mais ? "" : "hidden"} rounded-lg bg-[#eef0f4] px-3 py-1.5 text-xs font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]`}>
                    Encerrar
                  </button>
                )}
                <button
                  onClick={() => setMais((m) => !m)}
                  aria-expanded={mais}
                  className="min-h-[40px] rounded-lg border border-[#e3e5ea] px-3 py-1.5 text-xs font-medium text-[#5a5f6d] hover:bg-[#f4f5f8] @3xl:hidden"
                >
                  {mais ? "Menos ▴" : `Mais ▾${conversa.tags.length ? ` · ${conversa.tags.length} etiqueta${conversa.tags.length > 1 ? "s" : ""}` : ""}`}
                </button>
              </div>
              <div className={`${mais ? "flex" : "hidden"} mt-2.5 flex-wrap items-center gap-1.5 @3xl:flex`}>
                {conversa.tags.map((t) => (
                  <Etiqueta key={t} t={t} onRemover={() => mexerTag({ tagRemove: t })} />
                ))}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (novaTag.trim()) mexerTag({ tagAdd: novaTag.trim() });
                    setNovaTag("");
                  }}
                  className="flex items-center gap-1"
                >
                  <input
                    list="tags-sugeridas"
                    value={novaTag}
                    onChange={(e) => setNovaTag(e.target.value)}
                    placeholder="+ etiqueta"
                    className="w-28 rounded-full border border-dashed border-[#d5d8e0] bg-transparent px-2.5 py-0.5 text-[11px] outline-none focus:border-[#6366f1]"
                  />
                  <datalist id="tags-sugeridas">
                    {[...new Set([...TAGS_SUGERIDAS, ...todasTags])].map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </form>
              </div>
              {/* Faixa do perfil quando não cabe o painel lateral */}
              <div className={`${mais ? "flex" : "hidden"} mt-3 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-[#f7f8fa] px-3 py-2 text-[11px] text-[#5a5f6d] @3xl:flex @5xl:hidden`}>
                <span>
                  <b className="text-[#1b1f2b]">{seguidoresCurto(conversa.seguidores)}</b> seguidores
                </span>
                <span>
                  Segue a loja: <b className="text-[#1b1f2b]">{conversa.seguePagina === null ? "—" : conversa.seguePagina ? "Sim" : "Ainda não"}</b>
                </span>
                <span>
                  Cliente desde <b className="text-[#1b1f2b]">{dia(conversa.primeiroContato)}</b>
                </span>
                <SeloGrande n={conversa.seguidores} />
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain bg-[#f7f8fa] px-3 py-3 @3xl:px-5 @3xl:py-4">
              {blocos.map((b) => (
                <div key={b.dia} className="space-y-2">
                  <div className="my-3 text-center text-[11px] text-[#a1a5b0]">{b.dia}</div>
                  {b.msgs.map((m) => {
                    const cliente = m.de === "cliente";
                    const cor = cliente
                      ? "bg-white text-[#1b1f2b] border border-[#e3e5ea]"
                      : m.de === "equipe"
                        ? "bg-[#6366f1] text-white"
                        : "bg-emerald-100 text-emerald-950";
                    return (
                      <div key={m.id} className={`flex items-end gap-2 ${cliente ? "justify-start" : "justify-end"}`}>
                        {cliente && <Avatar c={conversa} tamanho={24} />}
                        <div className={`max-w-[85%] @3xl:max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${cor} ${cliente ? "rounded-bl-md" : "rounded-br-md"}`}>
                          <div className="whitespace-pre-wrap break-words">{m.texto}</div>
                          <div className={`mt-1 text-[10px] ${m.de === "equipe" ? "text-white/70" : "text-[#8a8f9c]"}`}>
                            {hora(m.em)}
                            {m.de === "robo" && ` · 🤖 robô${m.origem ? ` (${ORIGEM[m.origem] ?? m.origem})` : ""}`}
                            {m.de === "equipe" && " · equipe"}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={fim} />
            </div>

            <div className="border-t border-[#e3e5ea] bg-white p-2 pb-[max(8px,env(safe-area-inset-bottom))] @3xl:p-3">
              {!conversa.janelaAberta && (
                <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  Passaram mais de 24h desde a última mensagem do cliente: o Instagram não permite responder por aqui. Quando
                  ele escrever de novo, a janela reabre.
                </p>
              )}
              {aviso && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{aviso}</p>}
              {/^\/\S*$/.test(texto) && (
                <div className="mb-2 max-h-40 overflow-y-auto rounded-xl border border-[#e3e5ea] bg-white text-xs shadow-sm">
                  {salvas
                    .filter((s) => s.atalho.startsWith(texto.slice(1).toLowerCase()))
                    .map((s) => (
                      <button
                        key={s.id}
                        onClick={() => setTexto(s.texto.replaceAll("{nome}", (conversa.nome ?? "").split(" ")[0] || ""))}
                        className="block w-full border-b border-[#f1f2f5] px-3 py-2 text-left hover:bg-[#f7f7ff]"
                      >
                        <span className="font-semibold text-[#6366f1]">/{s.atalho}</span> <span className="text-[#1b1f2b]">{s.titulo}</span>
                        <span className="block truncate text-[#8a8f9c]">{s.texto}</span>
                      </button>
                    ))}
                  {salvas.length === 0 && <p className="px-3 py-2 text-[#8a8f9c]">Nenhuma resposta salva ainda. Crie em &ldquo;Respostas salvas&rdquo;.</p>}
                </div>
              )}
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
                  className="min-h-[46px] min-w-0 flex-1 resize-none rounded-xl border border-[#e3e5ea] px-3.5 py-2.5 text-base text-[#1b1f2b] @3xl:text-sm outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15 disabled:bg-[#f4f5f7]"
                />
                <button
                  onClick={enviar}
                  disabled={enviando || !texto.trim() || !conversa.janelaAberta}
                  className="min-h-[46px] shrink-0 rounded-xl bg-[#6366f1] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-40 @3xl:px-5"
                >
                  {enviando ? "Enviando…" : "Enviar"}
                </button>
              </div>
              <p className="mt-1.5 hidden text-[11px] text-[#a1a5b0] @3xl:block">
                Ao enviar, a conversa passa para &ldquo;Atendente na conversa&rdquo; e o robô fica quieto até você devolver.
              </p>
              <p className="mt-1 px-1 text-[11px] text-[#a1a5b0] @3xl:hidden">Ao enviar, o robô fica quieto até você devolver.</p>
            </div>
          </>
        )}
      </div>

      {/* Perfil do cliente */}
      <aside className="hidden min-h-0 overflow-y-auto border-l border-[#e3e5ea] bg-white @5xl:block">
        {conversa && selecionada ? (
          <div className="p-5 text-center">
            <div className="flex justify-center">
              <Avatar c={conversa} tamanho={96} />
            </div>
            <p className="mt-3 flex items-center justify-center gap-1 text-base font-semibold text-[#1b1f2b]">
              {nomeExibido(conversa)}
              {conversa.verificado && <span className="text-[#3b82f6]">✔</span>}
            </p>
            {conversa.username && (
              <a
                href={`https://instagram.com/${conversa.username}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-[#6366f1] hover:underline"
              >
                @{conversa.username} ↗
              </a>
            )}
            <div className="mt-2 flex justify-center">
              <SeloGrande n={conversa.seguidores} />
            </div>

            <div className="mt-5 rounded-xl bg-[#f7f8fa] p-4">
              <p className="text-2xl font-bold text-[#1b1f2b]">{seguidoresCurto(conversa.seguidores)}</p>
              <p className="text-[11px] uppercase tracking-wide text-[#8a8f9c]">seguidores</p>
            </div>

            <dl className="mt-5 space-y-3 text-left text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-[#8a8f9c]">Segue @{conversa.conta}</dt>
                <dd className="font-medium text-[#1b1f2b]">
                  {conversa.seguePagina === null ? "—" : conversa.seguePagina ? "Sim" : "Ainda não"}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#8a8f9c]">Loja</dt>
                <dd className="font-medium capitalize text-[#1b1f2b]">{conversa.loja}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#8a8f9c]">Primeiro contato</dt>
                <dd className="font-medium text-[#1b1f2b]">{dia(conversa.primeiroContato)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-[#8a8f9c]">Mensagens trocadas</dt>
                <dd className="font-medium text-[#1b1f2b]">{conversa.totalMensagens}</dd>
              </div>
            </dl>
            {conversa.seguidores !== null && conversa.seguidores >= GRANDE && (
              <p className="mt-5 rounded-lg bg-amber-50 p-3 text-left text-xs text-amber-900">
                Perfil com muitos seguidores: vale atenção especial no atendimento.
              </p>
            )}
          </div>
        ) : (
          <p className="p-5 text-center text-xs text-[#8a8f9c]">O perfil do cliente aparece aqui quando você abrir uma conversa.</p>
        )}
      </aside>
    </div>
    </div>
  );
}
