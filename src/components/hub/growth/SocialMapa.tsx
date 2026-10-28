"use client";

import { useEffect, useMemo, useState } from "react";
import { MAPA, ORDEM, LEVANTADO_EM, proximosHorarios, type Item, type RedeMapa, type Confianca } from "@/lib/social/mapaRedes";
import type { Rede } from "@/lib/social/types";

type AbaId = "geral" | Rede;
type Formato = { tipo: string; rotulo: string; n: number; alcanceMedio: number; taxaEngajamento: number; salvamentosMedio: number; compartilhamentosMedio: number };
type Post = { externoId: string; tipo: string; legenda: string; permalink: string | null; miniatura: string | null; publicadoEm: string; alcance: number; compartilhamentos: number; salvamentos: number; taxaEngajamento: number };
type ResumoIg = { coletadoEm: string | null; totalPostagensPeriodo: number; formatos: { ranking: Formato[]; frase: string }; top: Post[]; horario: { frase: string } };

const DIAS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
const CURTO = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const PERIODOS = [
  [1, "Hoje"],
  [7, "7 dias"],
  [14, "14 dias"],
  [30, "30 dias"],
] as const;
const CONF: Record<Confianca, { rotulo: string; cls: string }> = {
  oficial: { rotulo: "oficial", cls: "bg-emerald-50 text-emerald-700" },
  estudo: { rotulo: "estudo grande", cls: "bg-sky-50 text-sky-700" },
  secundaria: { rotulo: "secundária", cls: "bg-amber-50 text-amber-700" },
  sinal: { rotulo: "sinal", cls: "bg-zinc-100 text-zinc-600" },
  bff: { rotulo: "dado da BFF", cls: "bg-[#eef0ff] text-[#4f46e5]" },
};
const CHAVE = "mapa-redes-painel";

const n0 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const pad = (n: number) => String(n).padStart(2, "0");
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

/** Fundo e texto da marca: Pinterest é contornado para não se confundir com o vermelho do YouTube. */
function estiloMarca(r: RedeMapa): React.CSSProperties {
  return r.contornado
    ? { background: "#fff", color: r.cor, border: `1.5px solid ${r.cor}` }
    : { background: r.gradiente, color: "#fff", border: "1.5px solid transparent" };
}

const ICONES: Record<Rede, string> = {
  instagram:
    "M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9a5.5 5.5 0 0 1-5.5 5.5h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9zM12 7a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6zm5.3-3.6a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6z",
  tiktok: "M16.6 2h-3.3v13.2a2.9 2.9 0 1 1-2.1-2.8V9a6.2 6.2 0 1 0 5.4 6.2V8.6a7.6 7.6 0 0 0 4.4 1.4V6.7a4.4 4.4 0 0 1-4.4-4.7z",
  facebook: "M13.6 22v-8.1h2.7l.4-3.2h-3.1V8.7c0-.9.3-1.6 1.6-1.6h1.7V4.3c-.3 0-1.3-.1-2.5-.1-2.5 0-4.2 1.5-4.2 4.3v2.2H7.5v3.2h2.7V22z",
  youtube:
    "M21.6 7.2a2.7 2.7 0 0 0-1.9-1.9C18 4.8 12 4.8 12 4.8s-6 0-7.7.5A2.7 2.7 0 0 0 2.4 7.2 28 28 0 0 0 2 12a28 28 0 0 0 .4 4.8 2.7 2.7 0 0 0 1.9 1.9c1.7.5 7.7.5 7.7.5s6 0 7.7-.5a2.7 2.7 0 0 0 1.9-1.9A28 28 0 0 0 22 12a28 28 0 0 0-.4-4.8zM10 15V9l5.2 3z",
  pinterest:
    "M12 2a10 10 0 0 0-3.6 19.3c-.1-.8-.2-2 0-2.9l1.2-5s-.3-.6-.3-1.5c0-1.4.8-2.4 1.8-2.4.9 0 1.3.6 1.3 1.4 0 .9-.5 2.1-.8 3.3-.2 1 .5 1.8 1.5 1.8 1.8 0 3.1-1.9 3.1-4.6 0-2.4-1.7-4.1-4.2-4.1-2.9 0-4.5 2.1-4.5 4.4 0 .9.3 1.8.8 2.3.1.1.1.2.1.3l-.3 1.2c0 .2-.2.2-.4.1-1.3-.6-2.1-2.5-2.1-4 0-3.3 2.4-6.3 6.9-6.3 3.6 0 6.4 2.6 6.4 6 0 3.6-2.3 6.5-5.4 6.5-1.1 0-2.1-.6-2.4-1.2l-.7 2.5c-.2.9-.9 2.1-1.3 2.8A10 10 0 1 0 12 2z",
};

export function Icone({ rede, tamanho = 14 }: { rede: Rede; tamanho?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill="currentColor" aria-hidden className="shrink-0">
      <path fillRule="evenodd" d={ICONES[rede]} />
    </svg>
  );
}

export function Selo({ rede, curto }: { rede: Rede; curto?: boolean }) {
  const r = MAPA[rede];
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold" style={estiloMarca(r)}>
      <Icone rede={rede} />
      {curto ? null : r.rotulo}
    </span>
  );
}

function Tag({ c }: { c: Confianca }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 font-mono text-[10.5px] ${CONF[c].cls}`}>{CONF[c].rotulo}</span>;
}

function ListaItens({ itens }: { itens: Item[] }) {
  return (
    <ul className="space-y-2">
      {itens.map((it, i) => (
        <li key={i} className="text-sm leading-relaxed text-[#374151]">
          {it.texto} <Tag c={it.confianca} />
          {it.fonte && (
            <span className="ml-1 text-[11px] text-[#9ca3af]">
              {it.url ? (
                <a href={it.url} target="_blank" rel="noreferrer" className="underline hover:text-[#6366f1]">
                  {it.fonte}
                </a>
              ) : (
                it.fonte
              )}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function Bloco({ titulo, sub, cor, children }: { titulo: string; sub?: string; cor?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm" style={cor ? { borderTop: `4px solid ${cor}` } : undefined}>
      <h3 className="text-sm font-semibold text-[#1b1f2b]">{titulo}</h3>
      {sub && <p className="mt-0.5 text-xs text-[#6b7280]">{sub}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Copiar({ texto }: { texto: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          ?.writeText(texto)
          .then(() => {
            setOk(true);
            setTimeout(() => setOk(false), 1500);
          })
          .catch(() => {});
      }}
      className="rounded-md border border-[#e3e5ea] px-2 py-0.5 text-[11px] font-medium text-[#4b5563] hover:border-[#6366f1] hover:text-[#4f46e5]"
    >
      {ok ? "Copiado" : "Copiar"}
    </button>
  );
}

// ── Visão geral: calendário de hoje, 7, 14 ou 30 dias com todas as redes ──
/** Período e redes escolhidos da última vez. A aba só monta no navegador (InstagramAbas), então dá para ler na criação. */
function lerSalvo(): { per?: number; on?: Partial<Record<Rede, boolean>> } {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(CHAVE) ?? "null") ?? {};
  } catch {
    return {};
  }
}

function Calendario({ abrir }: { abrir: (r: Rede) => void }) {
  const [per, setPer] = useState<number>(() => {
    const p = lerSalvo().per;
    return p && [1, 7, 14, 30].includes(p) ? p : 7;
  });
  const [on, setOn] = useState<Record<Rede, boolean>>(() => ({ instagram: true, tiktok: true, facebook: true, youtube: true, pinterest: true, ...lerSalvo().on }));
  useEffect(() => {
    try {
      window.localStorage.setItem(CHAVE, JSON.stringify({ per, on }));
    } catch {
      /* ignora */
    }
  }, [per, on]);

  const hoje = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }, []);
  const dia = (off: number) => {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + off);
    return { d, w: (d.getDay() + 6) % 7, off };
  };
  const posts = (w: number, todas = false) =>
    ORDEM.flatMap((r) => MAPA[r].agenda.filter((s) => s.dia === w && (todas || on[r])).map((s) => ({ ...s, rede: r })))
      .sort((a, b) => minutos(a.hora) - minutos(b.hora));
  const dias = Array.from({ length: per }, (_, i) => dia(i));
  const dt = (d: Date) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const total = dias.reduce((s, x) => s + posts(x.w).length, 0);

  // Grade do calendário: de segunda da semana de hoje até o domingo do último dia; fora do período fica riscado.
  const ini = -dia(0).w;
  const fim = per - 1 + (6 - dia(per - 1).w);
  const celulas = Array.from({ length: fim - ini + 1 }, (_, i) => dia(ini + i));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-[#e3e5ea] bg-white p-1">
          {PERIODOS.map(([v, r]) => (
            <button key={v} type="button" onClick={() => setPer(v)} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${per === v ? "bg-[#1b1f2b] text-white" : "text-[#6b7280] hover:text-[#1b1f2b]"}`}>
              {r}
            </button>
          ))}
        </div>
        {ORDEM.map((r) => {
          const n = dias.reduce((s, x) => s + MAPA[r].agenda.filter((a) => a.dia === x.w).length, 0);
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on[r]}
              onClick={() => setOn((o) => ({ ...o, [r]: !o[r] }))}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-semibold transition-opacity"
              style={on[r] ? estiloMarca(MAPA[r]) : { background: "#fff", color: "#9ca3af", border: "1.5px solid #e3e5ea" }}
            >
              <Icone rede={r} />
              <span className={on[r] ? "" : "line-through"}>{MAPA[r].rotulo}</span>
              <span className="rounded-full bg-black/10 px-1.5 font-mono text-[11px]">{n}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[#6b7280]">
        <b className="text-[#1b1f2b]">{total}</b> publicações {per === 1 ? `hoje, ${dt(dias[0].d)}` : `de ${dt(dias[0].d)} a ${dt(dias[per - 1].d)}`}. Os horários são a semana-modelo repetida; mudam quando cada rede tiver os próprios números.
      </p>

      {/* computador: calendário */}
      <div className="hidden overflow-hidden rounded-2xl border border-[#e3e5ea] bg-white md:grid" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
        {CURTO.map((c, i) => (
          <div key={c} className={`border-l border-[#e3e5ea] px-3 py-2 text-sm font-semibold first:border-l-0 ${i > 4 ? "bg-[#fafafb]" : ""}`}>
            {c}
          </div>
        ))}
        {celulas.map((x, i) => {
          const fora = x.off < 0 || x.off >= per;
          const lista = fora ? [] : posts(x.w);
          return (
            <div
              key={x.off}
              className={`min-h-[110px] min-w-0 border-l border-t border-[#e3e5ea] p-1.5 ${i % 7 === 0 ? "border-l-0" : ""} ${x.w > 4 ? "bg-[#fafafb]" : ""} ${x.off === 0 ? "bg-[#f5f5ff] ring-2 ring-inset ring-[#6366f1]" : ""}`}
              style={fora ? { background: "repeating-linear-gradient(135deg, transparent 0 7px, #f1f2f5 7px 8px)" } : undefined}
            >
              <div className={`mb-1 flex items-center justify-between font-mono text-[11px] ${x.off === 0 ? "font-semibold text-[#4f46e5]" : "text-[#9ca3af]"} ${fora ? "opacity-50" : ""}`}>
                <span>
                  {x.d.getDate()}
                  {x.d.getDate() === 1 || i === 0 ? ` ${MESES[x.d.getMonth()]}` : ""}
                </span>
                {x.off === 0 && <span className="rounded-full bg-[#6366f1] px-1.5 text-[10px] text-white">hoje</span>}
              </div>
              <div className="space-y-1">
                {lista.map((s, k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => abrir(s.rede)}
                    title={`${DIAS[x.w]} ${dt(x.d)} ${s.hora} · ${MAPA[s.rede].rotulo} · ${s.formato}`}
                    className="flex w-full min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap rounded-md px-1.5 py-0.5 text-left text-[11.5px]"
                    style={estiloMarca(MAPA[s.rede])}
                  >
                    <Icone rede={s.rede} />
                    <b className="font-mono font-semibold">{s.hora}</b>
                    <span className="truncate opacity-90">{s.formato}</span>
                  </button>
                ))}
                {!fora && !lista.length && <div className="text-[11px] text-[#9ca3af]">Nada marcado</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* celular: lista por dia */}
      <div className="space-y-3 md:hidden">
        {dias.map((x) => {
          const lista = posts(x.w);
          return (
            <div key={x.off} className={`overflow-hidden rounded-2xl border bg-white ${x.off === 0 ? "border-[#6366f1]" : "border-[#e3e5ea]"}`}>
              <div className="flex items-baseline justify-between bg-[#fafafb] px-3 py-2">
                <span className={`text-sm font-semibold ${x.off === 0 ? "text-[#4f46e5]" : ""}`}>
                  {DIAS[x.w]}
                  {x.off === 0 ? " · hoje" : ""}
                </span>
                <span className="font-mono text-[11px] text-[#9ca3af]">
                  {dt(x.d)} · {lista.length} {lista.length === 1 ? "post" : "posts"}
                </span>
              </div>
              {lista.map((s, k) => (
                <div key={k} className="grid grid-cols-[46px_1fr] items-center gap-2 border-t border-[#e3e5ea] px-3 py-1.5">
                  <span className="font-mono text-xs font-semibold">{s.hora}</span>
                  <button type="button" onClick={() => abrir(s.rede)} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm" style={estiloMarca(MAPA[s.rede])}>
                    <Icone rede={s.rede} />
                    <b>{MAPA[s.rede].rotulo}</b>
                    <span className="truncate opacity-90">{s.formato}</span>
                  </button>
                </div>
              ))}
              {!lista.length && <div className="border-t border-[#e3e5ea] px-3 py-2 text-xs text-[#9ca3af]">Nada marcado</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Números reais do Instagram da BFF (últimos 90 dias, do coletor de métricas) ──
function NumerosInstagram() {
  const [dados, setDados] = useState<ResumoIg | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const c = await fetch("/api/social/metricas", { cache: "no-store" });
        if (!c.ok) throw new Error(c.status === 403 ? "Só administradores veem os números." : "Não consegui carregar as contas.");
        const { contas } = (await c.json()) as { contas: { id: string; rede: string; loja: string }[] };
        const ig = contas.find((x) => x.rede === "instagram" && x.loja === "bff");
        if (!ig) throw new Error("O Instagram da BFF não está conectado.");
        const r = await fetch(`/api/social/metricas?contaId=${ig.id}&dias=90`, { cache: "no-store" });
        if (!r.ok) throw new Error("Não consegui carregar as métricas.");
        if (vivo) setDados(await r.json());
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "Falha ao carregar.");
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);
  if (erro) return <p className="text-xs text-amber-700">{erro}</p>;
  if (!dados) return <p className="text-xs text-[#9ca3af]">Carregando os números do Instagram…</p>;
  const max = Math.max(1, ...dados.formatos.ranking.map((f) => f.alcanceMedio));
  return (
    <div className="space-y-4">
      <p className="text-xs text-[#6b7280]">
        {dados.totalPostagensPeriodo} postagens nos últimos 90 dias. Atualizado com a última coleta de métricas
        {dados.coletadoEm ? ` (${new Date(dados.coletadoEm).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })})` : ""}.
      </p>
      <div className="space-y-2.5">
        {dados.formatos.ranking.map((f) => (
          <div key={f.tipo}>
            <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
              <span className="font-semibold text-[#1b1f2b]">
                {f.rotulo} <span className="font-normal text-[#9ca3af]">({f.n})</span>
              </span>
              <span className="text-[#6b7280]">
                alcance médio <b className="text-[#1b1f2b]">{n0(f.alcanceMedio)}</b> · engajamento <b className="text-[#1b1f2b]">{f.taxaEngajamento.toLocaleString("pt-BR")}%</b> · salv. {n0(f.salvamentosMedio)} · compart. {n0(f.compartilhamentosMedio)}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-[#f3f4f6]">
              <div className="h-2.5 rounded-full" style={{ width: `${(f.alcanceMedio / max) * 100}%`, background: MAPA.instagram.gradiente }} />
            </div>
          </div>
        ))}
      </div>
      <p className="rounded-xl bg-[#fbe7f1] px-3 py-2 text-xs text-[#a01b5c]">{dados.formatos.frase} {dados.horario.frase}</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {dados.top.slice(0, 6).map((p, i) => (
          <a key={p.externoId} href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className="flex gap-2 rounded-xl border border-[#e3e5ea] p-2 hover:border-[#d02a78]">
            {p.miniatura ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.miniatura} alt="" className="h-16 w-16 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded-lg bg-[#f3f4f6]" />
            )}
            <div className="min-w-0 text-xs">
              <div className="font-semibold">
                {i + 1}º · {p.tipo} · alcance {n0(p.alcance)}
              </div>
              <div className="truncate text-[#6b7280]">{p.legenda || "(sem legenda)"}</div>
              <div className="text-[#9ca3af]">
                ↗ {n0(p.compartilhamentos)} · ⚑ {n0(p.salvamentos)} · {p.taxaEngajamento.toLocaleString("pt-BR")}%
              </div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

// ── Aba de uma rede: só o que é dela ──
function PaginaRede({ rede }: { rede: Rede }) {
  const r = MAPA[rede];
  const agenda = [...r.agenda].sort((a, b) => a.dia - b.dia || minutos(a.hora) - minutos(b.hora));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-4 rounded-2xl p-5" style={r.contornado ? { background: r.corSuave, border: `1.5px solid ${r.cor}` } : { background: r.gradiente, color: "#fff" }}>
        <div className="grid h-12 w-12 place-items-center rounded-xl text-2xl" style={r.contornado ? { background: "#fff", color: r.cor, border: `1.5px solid ${r.cor}` } : { background: "rgba(255,255,255,.18)" }}>
          <Icone rede={rede} tamanho={24} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-lg font-semibold" style={r.contornado ? { color: r.cor } : undefined}>
            {r.rotulo} da BFF
          </div>
          <p className={`text-sm ${r.contornado ? "text-[#4b5563]" : "text-white/90"}`}>{r.resumo}</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold" style={{ color: r.cor }}>
          {r.status}
        </span>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="O que já deu certo na BFF" sub="Tirado das nossas contas" cor={r.cor}>
          {rede === "instagram" ? (
            <div className="space-y-4">
              <NumerosInstagram />
              <ListaItens itens={r.nosso} />
            </div>
          ) : (
            <ListaItens itens={r.nosso} />
          )}
        </Bloco>
        <div className="space-y-4">
          <Bloco titulo="Repetir" cor="#10b981">
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-[#374151]">
              {r.repetir.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Bloco>
          <Bloco titulo="Evitar" cor="#ef4444">
            <ul className="list-disc space-y-1.5 pl-4 text-sm text-[#374151]">
              {r.evitar.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </Bloco>
        </div>
      </div>

      <Bloco titulo="Qual formato funciona no mercado" sub="Estudos grandes de 2025 e 2026. Cada estudo mede de um jeito: compare dentro da mesma fonte." cor={r.cor}>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {r.formatos.map((f) => (
            <div key={f.formato} className="rounded-xl border border-[#e3e5ea] p-3" style={{ background: `linear-gradient(90deg, ${r.corSuave}, #fff 70%)` }}>
              <div className="flex items-center justify-between gap-2">
                <b className="text-sm">{f.formato}</b>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={estiloMarca(r)}>
                  {f.veredito}
                </span>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-[#4b5563]">{f.texto}</p>
            </div>
          ))}
        </div>
      </Bloco>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="O que está em alta" sub="Moda, fitness e o que mudou no algoritmo" cor={r.cor}>
          <ListaItens itens={r.alta} />
        </Bloco>
        <Bloco titulo="Atacado e revenda" sub="O que as contas de atacado fazem nessa rede" cor={r.cor}>
          <ListaItens itens={r.atacado} />
        </Bloco>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="Agenda da semana" sub="Horários desta rede no quadro geral" cor={r.cor}>
          {agenda.length ? (
            <div className="space-y-1.5">
              {agenda.map((s, i) => (
                <div key={i} className="grid grid-cols-[72px_52px_1fr] items-center gap-2 text-sm">
                  <span className="text-[#6b7280]">{DIAS[s.dia]}</span>
                  <b className="font-mono">{s.hora}</b>
                  <span className="truncate rounded-lg px-2 py-1 text-xs" style={estiloMarca(r)}>
                    {s.formato}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-[#9ca3af]">Sem horário marcado ainda.</p>
          )}
        </Bloco>
        <Bloco titulo="Medidas" cor={r.cor}>
          <dl className="divide-y divide-[#f1f2f5] text-sm">
            {r.medidas.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[120px_1fr] gap-2 py-1.5">
                <dt className="text-[#6b7280]">{k}</dt>
                <dd className="text-[#1b1f2b]">{v}</dd>
              </div>
            ))}
          </dl>
        </Bloco>
      </div>

      <Bloco titulo="Ideias para gravar" sub="Já no jeito da BFF" cor={r.cor}>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {r.ideias.map((d) => (
            <div key={d.titulo} className="rounded-xl border border-[#e3e5ea] p-3" style={{ borderLeft: `4px solid ${r.cor}` }}>
              <b className="text-sm">{d.titulo}</b>
              <p className="mt-1 text-xs leading-relaxed text-[#4b5563]">{d.como}</p>
            </div>
          ))}
        </div>
      </Bloco>

      {r.modelos.length > 0 && (
        <Bloco titulo="Modelos de texto" sub="Ponto de partida para editar" cor={r.cor}>
          <div className="space-y-2">
            {r.modelos.map((m) => (
              <div key={m.rotulo} className="rounded-xl border border-[#e3e5ea] p-3" style={{ borderLeft: `4px solid ${r.cor}` }}>
                <div className="mb-1 flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wide text-[#9ca3af]">
                  {m.rotulo} <Copiar texto={m.texto} />
                </div>
                <pre className="whitespace-pre-wrap break-words font-sans text-sm text-[#1b1f2b]">{m.texto}</pre>
              </div>
            ))}
          </div>
        </Bloco>
      )}
    </div>
  );
}

/** Próximo horário da agenda-modelo de uma rede, a partir de agora (com 10 min de folga para dar tempo de agendar). */
function proximoHorario(rede: Rede, ocupados: Date[] = []) {
  const p = proximosHorarios(rede, 1, ocupados)[0];
  return p ? { quando: p.quando, slot: { hora: p.hora, formato: p.formato } } : null;
}

/**
 * Coluna ao lado do publicador: para cada rede escolhida, o próximo horário bom do mapa (botão que preenche
 * o "Quando"), a dica principal e a medida do formato. O link abre o mapa completo.
 */
export function DicasPublicacao({ redes, onUsar, abrirMapa, ocupados = {} }: { redes: Rede[]; onUsar: (valorDatetimeLocal: string) => void; abrirMapa: () => void; ocupados?: Partial<Record<Rede, Date[]>> }) {
  const lista = ORDEM.filter((r) => redes.includes(r));
  const local = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return (
    <div className="w-full space-y-2 rounded-2xl border border-[#e3e5ea] bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-[#1b1f2b]">Mapa de publicação</p>
        <button type="button" onClick={abrirMapa} className="text-[11px] font-medium text-[#6366f1] hover:underline">
          Abrir o mapa completo
        </button>
      </div>
      {!lista.length && <p className="text-xs text-[#8a8f9c]">Escolha onde postar para ver o melhor horário e as dicas de cada rede.</p>}
      {lista.map((rede) => {
        const r = MAPA[rede];
        const p = proximoHorario(rede, ocupados[rede]);
        return (
          <div key={rede} className="rounded-xl border border-[#e3e5ea] p-2.5" style={{ borderLeft: `4px solid ${r.cor}` }}>
            <div className="flex items-center justify-between gap-2">
              <Selo rede={rede} />
              {p && (
                <button
                  type="button"
                  onClick={() => onUsar(local(p.quando))}
                  className="rounded-lg border border-[#e3e5ea] px-2 py-0.5 text-[11px] font-semibold text-[#4b5563] hover:border-[#6366f1] hover:text-[#4f46e5]"
                >
                  Usar horário
                </button>
              )}
            </div>
            {p ? (
              <p className="mt-1.5 text-xs text-[#1b1f2b]">
                Próximo: <b>{CURTO[(p.quando.getDay() + 6) % 7]} {pad(p.quando.getDate())}/{pad(p.quando.getMonth() + 1)} às {p.slot.hora}</b> · {p.slot.formato}
              </p>
            ) : (
              <p className="mt-1.5 text-xs text-[#8a8f9c]">Sem horário na agenda desta rede.</p>
            )}
            <p className="mt-1 text-[11px] leading-snug text-[#6b7280]">{r.repetir[0]}</p>
            {r.medidas[0] && (
              <p className="mt-0.5 text-[11px] text-[#9ca3af]">
                {r.medidas[0][0]}: {r.medidas[0][1]}
              </p>
            )}
          </div>
        );
      })}
      {lista.length > 1 && <p className="text-[10.5px] leading-snug text-[#9ca3af]">Uma postagem tem um horário só para todas as redes escolhidas. Para cada rede sair no seu horário, faça uma postagem por rede.</p>}
    </div>
  );
}

type PerfilGoogle = { url: string; nome: string | null; totalSeguidores: string | null; redes: { rede: string; conta: string; seguidores: string }[]; postsRecentes: number; avisos: string[]; lidoEm: string };

/** Perfil de pesquisa do Google (Google for Creators), lido na hora da página pública: seguidores por rede e o que falta. */
function PerfilNoGoogle() {
  const [p, setP] = useState<PerfilGoogle | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/social/google-perfil", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? "Falha ao ler o perfil do Google.");
        if (vivo) setP(j);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Falha ao ler o perfil do Google."));
    return () => {
      vivo = false;
    };
  }, []);
  return (
    <section className="rounded-2xl border border-[#e3e5ea] bg-white p-4 shadow-sm" style={{ borderTop: "4px solid #4285f4" }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[#1b1f2b]">Perfil no Google</h3>
          <p className="text-xs text-[#6b7280]">A página da BFF na busca do Google (Google for Creators), lida agora.</p>
        </div>
        {p && (
          <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-[#4f46e5] hover:underline">
            Abrir o perfil
          </a>
        )}
      </div>
      {erro && <p className="mt-2 text-xs text-amber-700">{erro}</p>}
      {!p && !erro && <p className="mt-2 text-xs text-[#9ca3af]">Lendo o perfil do Google…</p>}
      {p && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
            <span className="text-lg font-semibold">{p.nome ?? "—"}</span>
            {p.totalSeguidores && <span className="text-sm text-[#4b5563]"><b>{p.totalSeguidores}</b> seguidores no total</span>}
            <span className="text-xs text-[#9ca3af]">{p.postsRecentes} posts recentes aparecendo</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {p.redes.map((r) => {
              const id = r.rede.toLowerCase() as Rede;
              const m = MAPA[id];
              return (
                <span key={r.rede} className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold" style={m ? estiloMarca(m) : { background: "#f3f4f6" }}>
                  {m && <Icone rede={id} />}
                  {r.rede} · {r.seguidores}
                </span>
              );
            })}
          </div>
          {p.avisos.length > 0 && (
            <ul className="list-disc space-y-1 pl-4 text-xs text-amber-800">
              {p.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default function SocialMapa() {
  const [aba, setAba] = useState<AbaId>("geral");
  const abas: { id: AbaId; rotulo: string }[] = [{ id: "geral", rotulo: "Visão geral" }, ...ORDEM.map((r) => ({ id: r, rotulo: MAPA[r].rotulo }))];
  return (
    <div className="space-y-5 text-[#1b1f2b]">
      <div>
        <h2 className="text-lg font-semibold">Mapa das redes</h2>
        <p className="text-xs text-[#6b7280]">Quando postar, o que já deu certo, o que repetir e o que está funcionando no mercado, rede por rede. Pesquisa de {LEVANTADO_EM}.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Redes">
        {abas.map((a) => {
          const ativa = aba === a.id;
          const r = a.id === "geral" ? null : MAPA[a.id];
          return (
            <button
              key={a.id}
              type="button"
              role="tab"
              aria-selected={ativa}
              onClick={() => setAba(a.id)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold"
              style={ativa ? (r ? estiloMarca(r) : { background: "#1b1f2b", color: "#fff" }) : { background: "#fff", color: "#4b5563", border: "1px solid #e3e5ea" }}
            >
              {a.id !== "geral" && <Icone rede={a.id} />}
              {a.rotulo}
            </button>
          );
        })}
      </div>

      {aba === "geral" ? (
        <div className="space-y-4">
          <PerfilNoGoogle />
          <Calendario abrir={setAba} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {ORDEM.map((r) => (
              <button key={r} type="button" onClick={() => setAba(r)} className="rounded-2xl border border-[#e3e5ea] bg-white p-4 text-left shadow-sm hover:shadow" style={{ borderTop: `4px solid ${MAPA[r].cor}` }}>
                <Selo rede={r} />
                <p className="mt-2 text-xs font-semibold text-[#1b1f2b]">{MAPA[r].manchete}</p>
                <p className="mt-1 text-[11px] text-[#6b7280]">{MAPA[r].status}</p>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <PaginaRede rede={aba} />
      )}
    </div>
  );
}
