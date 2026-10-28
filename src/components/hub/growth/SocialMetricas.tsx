"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Conta = { id: string; rede: string; loja: string; nome: string | null; username: string | null; coletaDisponivel: boolean };
type Balde = { n: number; alcanceMedio: number; interacoesMedia: number; cliquesBioMedio: number; salvamentosMedio: number };
type Demo = { chave: string; valor: number; pct: number }[];
type GrupoPublico = { idade: Demo; genero: Demo; cidades: Demo; paises: Demo };
type Resumo = {
  contas: Conta[];
  conta?: Conta;
  dias: number;
  semDados?: boolean;
  coletadoEm: string | null;
  totais: { alcance: number; visualizacoes: number; toquesLink: number; visitasPerfil: number; interacoes: number; seguidores: number | null; diasComDados: number };
  evolucao: { data: string; alcance: number; toquesLink: number; visualizacoes: number }[];
  horario: {
    totalPostagens: number;
    amostraPequena: boolean;
    mapa: Balde[][];
    melhorHora: (Balde & { hora: number }) | null;
    piorHora: (Balde & { hora: number }) | null;
    melhorDia: (Balde & { diaSemana: number }) | null;
    piorDia: (Balde & { diaSemana: number }) | null;
    melhorHoraLinkBio: (Balde & { hora: number }) | null;
    frase: string;
    avisos: string[];
  };
  formatos: {
    ranking: { tipo: string; rotulo: string; n: number; alcanceMedio: number; taxaEngajamento: number; salvamentosMedio: number; compartilhamentosMedio: number; cliquesBioMedio: number }[];
    frase: string;
    amostraPequena: boolean;
  };
  top: { externoId: string; tipo: string; legenda: string; permalink: string | null; miniatura: string | null; publicadoEm: string; alcance: number; visualizacoes: number; curtidas: number; comentarios: number; compartilhamentos: number; salvamentos: number; interacoes: number; taxaEngajamento: number }[];
  totalPostagensPeriodo: number;
  publico: { coletadoEm: string; seguidores: GrupoPublico; engajados: GrupoPublico; alcancados: GrupoPublico; avisos: string[] } | null;
};
type ResultadoColeta = { contaId: string; erro?: string; precisaReconectar?: boolean; avisos: string[]; diasGravados: number; postsGravados: number; publicoGravado: boolean };

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGO = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
const n0 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const hh = (h: number) => `${String(h).padStart(2, "0")}h`;
const dataCurta = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC", day: "2-digit", month: "2-digit" }).format(new Date(iso));
const dataHora = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";

const card = "rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm";
const titulo = "text-sm font-semibold text-[#1b1f2b]";
const sub = "text-xs text-[#6b7280]";
const select = "min-w-0 max-w-full rounded-xl border border-[#e3e5ea] bg-white px-3 py-2 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";

function Cartao({ rotulo, valor, dica }: { rotulo: string; valor: string; dica?: string }) {
  return (
    <div className={card}>
      <div className={sub}>{rotulo}</div>
      <div className="mt-1 text-2xl font-semibold text-[#1b1f2b]">{valor}</div>
      {dica && <div className="mt-1 text-[11px] text-[#9ca3af]">{dica}</div>}
    </div>
  );
}

function Aviso({ tipo, children }: { tipo: "info" | "alerta"; children: React.ReactNode }) {
  const cor = tipo === "alerta" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-[#e0e1fb] bg-[#f5f5ff] text-[#4338ca]";
  return <div className={`rounded-xl border px-3 py-2 text-xs ${cor}`}>{children}</div>;
}

/** Mapa de calor dia da semana x hora. A cor vai do branco ao roxo conforme o alcance médio. */
function MapaCalor({ mapa }: { mapa: Balde[][] }) {
  const max = Math.max(1, ...mapa.flat().map((b) => b.alcanceMedio));
  const [hover, setHover] = useState<{ d: number; h: number } | null>(null);
  const b = hover ? mapa[hover.d][hover.h] : null;
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="ml-10 grid grid-cols-24 gap-[2px] text-[9px] text-[#9ca3af]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="text-center">
                {h % 3 === 0 ? h : ""}
              </div>
            ))}
          </div>
          {mapa.map((linha, d) => (
            <div key={d} className="mt-[2px] flex items-center">
              <div className="w-10 text-[11px] text-[#6b7280]">{DIAS[d]}</div>
              <div className="grid flex-1 gap-[2px]" style={{ gridTemplateColumns: "repeat(24, minmax(0, 1fr))" }}>
                {linha.map((c, h) => (
                  <div
                    key={h}
                    onMouseEnter={() => setHover({ d, h })}
                    onMouseLeave={() => setHover(null)}
                    className="h-6 rounded-[3px]"
                    style={{ background: c.n ? `rgba(99,102,241,${0.12 + 0.88 * (c.alcanceMedio / max)})` : "#f3f4f6" }}
                    title={c.n ? `${DIAS_LONGO[d]} ${hh(h)}: ${c.n} postagem(ns), alcance médio ${n0(c.alcanceMedio)}` : `${DIAS_LONGO[d]} ${hh(h)}: sem postagens`}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="ml-10 mt-1 text-[10px] text-[#9ca3af]">Horas do dia (horário de Brasília). Cinza = nunca postou nesse horário.</div>
        </div>
      </div>
      <div className="mt-2 h-5 text-xs text-[#6b7280]">
        {b && hover ? (b.n ? `${DIAS_LONGO[hover.d]} às ${hh(hover.h)}: ${b.n} postagem(ns) · alcance médio ${n0(b.alcanceMedio)} · interações médias ${b.interacoesMedia.toLocaleString("pt-BR")}` : `${DIAS_LONGO[hover.d]} às ${hh(hover.h)}: sem postagens`) : ""}
      </div>
    </div>
  );
}

function Barras({ itens, formato = (v: number) => `${v.toLocaleString("pt-BR")}%`, cor = "#6366f1" }: { itens: { chave: string; pct: number; valor?: number }[]; formato?: (v: number) => string; cor?: string }) {
  if (!itens.length) return <div className="text-xs text-[#9ca3af]">Sem dados.</div>;
  const max = Math.max(...itens.map((i) => i.pct), 1);
  return (
    <div className="space-y-1.5">
      {itens.map((i) => (
        <div key={i.chave} className="flex items-center gap-2 text-xs">
          <div className="w-28 shrink-0 truncate text-[#4b5563]" title={i.chave}>
            {i.chave}
          </div>
          <div className="h-3 flex-1 rounded-full bg-[#f3f4f6]">
            <div className="h-3 rounded-full" style={{ width: `${(i.pct / max) * 100}%`, background: cor }} />
          </div>
          <div className="w-12 shrink-0 text-right text-[#1b1f2b]">{formato(i.pct)}</div>
        </div>
      ))}
    </div>
  );
}

/** Linha do tempo em SVG: linha roxa = alcance; barras verdes = toques no link da bio. */
function LinhaTempo({ dados }: { dados: Resumo["evolucao"] }) {
  const W = 720;
  const H = 200;
  const P = { l: 40, r: 40, t: 10, b: 24 };
  if (dados.length < 2) return <div className="text-xs text-[#9ca3af]">Poucos dias coletados para desenhar a linha do tempo.</div>;
  const maxA = Math.max(1, ...dados.map((d) => d.alcance));
  const maxT = Math.max(1, ...dados.map((d) => d.toquesLink));
  const x = (i: number) => P.l + (i / (dados.length - 1)) * (W - P.l - P.r);
  const yA = (v: number) => P.t + (1 - v / maxA) * (H - P.t - P.b);
  const yT = (v: number) => P.t + (1 - v / maxT) * (H - P.t - P.b);
  const largura = Math.max(2, ((W - P.l - P.r) / dados.length) * 0.6);
  const caminho = dados.map((d, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${yA(d.alcance).toFixed(1)}`).join(" ");
  const marcas = [0, Math.floor(dados.length / 2), dados.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Alcance da conta e toques no link da bio por dia">
      {[0, 0.5, 1].map((f) => (
        <g key={f}>
          <line x1={P.l} x2={W - P.r} y1={P.t + f * (H - P.t - P.b)} y2={P.t + f * (H - P.t - P.b)} stroke="#eef0f4" />
          <text x={P.l - 6} y={P.t + f * (H - P.t - P.b) + 3} textAnchor="end" fontSize="10" fill="#6366f1">
            {n0(maxA * (1 - f))}
          </text>
          <text x={W - P.r + 6} y={P.t + f * (H - P.t - P.b) + 3} fontSize="10" fill="#10b981">
            {n0(maxT * (1 - f))}
          </text>
        </g>
      ))}
      {dados.map((d, i) => (
        <rect key={d.data} x={x(i) - largura / 2} y={yT(d.toquesLink)} width={largura} height={Math.max(0, H - P.b - yT(d.toquesLink))} fill="#10b981" opacity="0.35">
          <title>{`${dataCurta(d.data)}: ${n0(d.toquesLink)} toques no link da bio`}</title>
        </rect>
      ))}
      <path d={caminho} fill="none" stroke="#6366f1" strokeWidth="2" />
      {dados.map((d, i) => (
        <circle key={d.data} cx={x(i)} cy={yA(d.alcance)} r="2.5" fill="#6366f1">
          <title>{`${dataCurta(d.data)}: alcance ${n0(d.alcance)}`}</title>
        </circle>
      ))}
      {marcas.map((i) => (
        <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="#6b7280">
          {dataCurta(dados[i].data)}
        </text>
      ))}
    </svg>
  );
}

export default function SocialMetricas() {
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [contaId, setContaId] = useState("");
  const [dias, setDias] = useState(30);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [coletando, setColetando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [coleta, setColeta] = useState<ResultadoColeta | null>(null);
  const [aba, setAba] = useState<"seguidores" | "engajados" | "alcancados">("seguidores");

  const carregarContas = useCallback(async () => {
    const r = await fetch("/api/social/metricas", { cache: "no-store" });
    if (!r.ok) {
      setErro(r.status === 403 ? "Só administradores veem as métricas." : "Não consegui carregar as contas.");
      setContas([]);
      return;
    }
    const j = (await r.json()) as { contas: Conta[] };
    setContas(j.contas);
    setContaId((atual) => atual || j.contas.find((c) => c.coletaDisponivel)?.id || "");
  }, []);
  useEffect(() => {
    carregarContas();
  }, [carregarContas]);

  const carregar = useCallback(async () => {
    if (!contaId) return;
    setCarregando(true);
    try {
      const r = await fetch(`/api/social/metricas?contaId=${contaId}&dias=${dias}`, { cache: "no-store" });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Falha ao carregar");
      setResumo(await r.json());
      setErro(null);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao carregar as métricas.");
    } finally {
      setCarregando(false);
    }
  }, [contaId, dias]);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function atualizar() {
    if (!contaId) return;
    setColetando(true);
    setColeta(null);
    try {
      const r = await fetch("/api/social/metricas/coletar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contaId, dias: Math.max(dias, 30) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falha ao coletar");
      setColeta(j.resultados?.[0] ?? null);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao coletar as métricas.");
    } finally {
      setColetando(false);
    }
  }

  const conta = useMemo(() => contas?.find((c) => c.id === contaId), [contas, contaId]);
  const pub = resumo?.publico?.[aba];

  return (
    <div className="space-y-5 text-[#1b1f2b]">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <h2 className="text-lg font-semibold">Métricas das redes</h2>
          <p className={sub}>Desempenho, melhor horário, formatos e público. Hoje: Instagram. As outras redes entram uma de cada vez.</p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
          <select className={`${select} flex-1 sm:flex-none`} value={contaId} onChange={(e) => setContaId(e.target.value)} aria-label="Conta">
            {(contas ?? []).map((c) => (
              <option key={c.id} value={c.id} disabled={!c.coletaDisponivel}>
                {c.rede === "instagram" ? "Instagram" : c.rede} · {c.username ? `@${c.username}` : (c.nome ?? c.loja)} ({c.loja.toUpperCase()}){c.coletaDisponivel ? "" : " — em breve"}
              </option>
            ))}
          </select>
          <select className={select} value={dias} onChange={(e) => setDias(Number(e.target.value))} aria-label="Período">
            <option value={7}>Últimos 7 dias</option>
            <option value={30}>Últimos 30 dias</option>
            <option value={90}>Últimos 90 dias</option>
          </select>
          <button onClick={atualizar} disabled={coletando || !contaId} className="rounded-xl bg-[#6366f1] px-4 py-2 text-sm font-medium text-white hover:bg-[#4f46e5] disabled:opacity-50">
            {coletando ? "Coletando…" : "Atualizar dados"}
          </button>
        </div>
      </div>

      {contas && contas.length === 0 && !erro && <Aviso tipo="info">Nenhuma conta conectada. Conecte uma conta do Instagram no publicador para ver as métricas.</Aviso>}
      {erro && <Aviso tipo="alerta">{erro}</Aviso>}
      {coleta?.erro && (
        <Aviso tipo="alerta">
          {coleta.erro}
          {coleta.precisaReconectar && conta && (
            <>
              {" "}
              <a className="font-semibold underline" href={`/api/instagram/connect?loja=${conta.loja}`}>
                Reconectar a conta
              </a>
            </>
          )}
        </Aviso>
      )}
      {coleta && !coleta.erro && (
        <Aviso tipo="info">
          Coleta concluída: {coleta.diasGravados} dia(s) da conta, {coleta.postsGravados} mídia(s){coleta.publicoGravado ? " e público" : ""}.
          {coleta.avisos.length > 0 && <ul className="mt-1 list-disc pl-4 text-[#6b7280]">{coleta.avisos.slice(0, 6).map((a, i) => <li key={i}>{a}</li>)}</ul>}
        </Aviso>
      )}

      {carregando && !resumo && <div className={sub}>Carregando…</div>}

      {resumo?.semDados && (
        <div className={`${card} text-center`}>
          <div className="text-base font-semibold">Ainda não há dados coletados para esta conta</div>
          <p className={`${sub} mt-1`}>Clique em “Atualizar dados” para buscar as métricas dos últimos dias no Instagram. A primeira coleta leva cerca de um minuto.</p>
          <p className={`${sub} mt-1`}>Se aparecer erro de permissão, reconecte a conta do Instagram para liberar a permissão de métricas.</p>
        </div>
      )}

      {resumo && !resumo.semDados && (
        <>
          <div className={sub}>Última coleta: {dataHora(resumo.coletadoEm)}. Alguns números da Meta demoram até 48h para fechar.</div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Cartao rotulo="Alcance (soma dos dias)" valor={n0(resumo.totais.alcance)} dica="Pode repetir a mesma pessoa em dias diferentes" />
            <Cartao rotulo="Visualizações" valor={n0(resumo.totais.visualizacoes)} />
            <Cartao rotulo="Toques no link da bio" valor={n0(resumo.totais.toquesLink)} />
            <Cartao rotulo="Visitas ao perfil" valor={n0(resumo.totais.visitasPerfil)} />
            <Cartao rotulo="Interações" valor={n0(resumo.totais.interacoes)} />
            <Cartao rotulo="Seguidores" valor={resumo.totais.seguidores != null ? n0(resumo.totais.seguidores) : "—"} />
          </div>

          <div className={card}>
            <div className={titulo}>Melhor horário para postar</div>
            <p className={`${sub} mb-3`}>Calculado com o desempenho real das suas postagens (últimos 90 dias, feed e reels). A Meta não informa mais quando seus seguidores estão online.</p>
            <p className="mb-3 rounded-xl bg-[#f5f5ff] px-3 py-2 text-sm text-[#312e81]">{resumo.horario.frase}</p>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              {resumo.horario.melhorHora && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Melhor hora: <b>{hh(resumo.horario.melhorHora.hora)}</b> · {resumo.horario.melhorHora.n} postagens · alcance médio {n0(resumo.horario.melhorHora.alcanceMedio)}</div>}
              {resumo.horario.piorHora && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">Pior hora: <b>{hh(resumo.horario.piorHora.hora)}</b> · {resumo.horario.piorHora.n} postagens · alcance médio {n0(resumo.horario.piorHora.alcanceMedio)}</div>}
              {resumo.horario.melhorDia && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">Melhor dia: <b>{DIAS_LONGO[resumo.horario.melhorDia.diaSemana]}</b> · {resumo.horario.melhorDia.n} postagens · alcance médio {n0(resumo.horario.melhorDia.alcanceMedio)}</div>}
              {resumo.horario.piorDia && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">Pior dia: <b>{DIAS_LONGO[resumo.horario.piorDia.diaSemana]}</b> · {resumo.horario.piorDia.n} postagens · alcance médio {n0(resumo.horario.piorDia.alcanceMedio)}</div>}
              {resumo.horario.melhorHoraLinkBio && <div className="rounded-xl border border-[#e0e1fb] bg-[#f5f5ff] px-3 py-2 text-xs text-[#4338ca] sm:col-span-2">Hora que mais gera cliques no link da bio: <b>{hh(resumo.horario.melhorHoraLinkBio.hora)}</b> ({resumo.horario.melhorHoraLinkBio.cliquesBioMedio.toLocaleString("pt-BR")} cliques por postagem, {resumo.horario.melhorHoraLinkBio.n} postagens)</div>}
            </div>
            <MapaCalor mapa={resumo.horario.mapa} />
            {resumo.horario.avisos.filter((a) => a.startsWith("Amostra") || a.startsWith("Ainda")).map((a) => (
              <div key={a} className="mt-2"><Aviso tipo="alerta">{a}</Aviso></div>
            ))}
          </div>

          <div className={card}>
            <div className={titulo}>Qual formato funciona mais</div>
            <p className={`${sub} mb-3`}>Média por postagem no período ({resumo.totalPostagensPeriodo} postagens). Taxa de engajamento = interações ÷ alcance.</p>
            {resumo.formatos.ranking.length === 0 ? (
              <div className="text-xs text-[#9ca3af]">Nenhuma postagem no período.</div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-[#312e81]">{resumo.formatos.frase}</p>
                {resumo.formatos.ranking.map((f) => {
                  const max = Math.max(...resumo.formatos.ranking.map((x) => x.alcanceMedio), 1);
                  return (
                    <div key={f.tipo}>
                      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-xs">
                        <span className="font-medium text-[#1b1f2b]">
                          {f.rotulo} <span className="font-normal text-[#9ca3af]">({f.n} {f.n === 1 ? "postagem" : "postagens"})</span>
                        </span>
                        <span className="text-[#6b7280]">
                          alcance médio <b className="text-[#1b1f2b]">{n0(f.alcanceMedio)}</b> · engajamento <b className="text-[#1b1f2b]">{f.taxaEngajamento.toLocaleString("pt-BR")}%</b> · salvam. {f.salvamentosMedio.toLocaleString("pt-BR")} · compart. {f.compartilhamentosMedio.toLocaleString("pt-BR")}
                        </span>
                      </div>
                      <div className="h-3 rounded-full bg-[#f3f4f6]">
                        <div className="h-3 rounded-full bg-[#6366f1]" style={{ width: `${(f.alcanceMedio / max) * 100}%` }} />
                      </div>
                    </div>
                  );
                })}
                {resumo.formatos.amostraPequena && <Aviso tipo="alerta">Poucas postagens no histórico: a comparação ainda é só um palpite.</Aviso>}
              </div>
            )}
          </div>

          <div className={card}>
            <div className={titulo}>Postagens campeãs</div>
            <p className={`${sub} mb-3`}>As 10 com maior alcance no período.</p>
            {resumo.top.length === 0 ? (
              <div className="text-xs text-[#9ca3af]">Nenhuma postagem no período.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {resumo.top.map((p, i) => (
                  <a key={p.externoId} href={p.permalink ?? undefined} target="_blank" rel="noreferrer" className="flex min-w-0 gap-3 rounded-xl border border-[#e3e5ea] p-2 hover:border-[#6366f1]">
                    {p.miniatura ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={p.miniatura} alt="" className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <div className="h-20 w-20 shrink-0 rounded-lg bg-[#f3f4f6]" />
                    )}
                    <div className="min-w-0 flex-1 text-xs">
                      <div className="font-semibold text-[#1b1f2b]">
                        {i + 1}º · {p.tipo} · {dataCurta(p.publicadoEm)}
                      </div>
                      <div className="truncate text-[#6b7280]">{p.legenda || "(sem legenda)"}</div>
                      <div className="mt-1 text-[#4b5563]">
                        Alcance {n0(p.alcance)} · views {n0(p.visualizacoes)}
                      </div>
                      <div className="text-[#4b5563]">
                        ♥ {n0(p.curtidas)} · 💬 {n0(p.comentarios)} · ↗ {n0(p.compartilhamentos)} · ⚑ {n0(p.salvamentos)}
                      </div>
                      <div className="text-[#9ca3af]">Engajamento {p.taxaEngajamento.toLocaleString("pt-BR")}%</div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </div>

          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className={titulo}>Público</div>
              <div className="flex gap-1 text-xs">
                {(
                  [
                    ["seguidores", "Seguidores"],
                    ["engajados", "Quem engaja"],
                    ["alcancados", "Quem é alcançado"],
                  ] as const
                ).map(([k, r]) => (
                  <button key={k} onClick={() => setAba(k)} className={`rounded-full px-3 py-1 ${aba === k ? "bg-[#6366f1] text-white" : "border border-[#e3e5ea] text-[#4b5563]"}`}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {!resumo.publico ? (
              <p className={`${sub} mt-3`}>Sem dados de público ainda. A Meta só libera idade, gênero e cidade para contas com 100 ou mais seguidores.</p>
            ) : (
              <>
                <p className={`${sub} mt-1`}>Coletado em {dataHora(resumo.publico.coletadoEm)}.</p>
                {resumo.publico.avisos.length > 0 && <div className="mt-2"><Aviso tipo="alerta">{resumo.publico.avisos.join(" · ")}</Aviso></div>}
                {pub && (
                  <div className="mt-4 grid gap-6 md:grid-cols-2">
                    <div><div className="mb-2 text-xs font-medium text-[#4b5563]">Idade</div><Barras itens={pub.idade} /></div>
                    <div><div className="mb-2 text-xs font-medium text-[#4b5563]">Gênero</div><Barras itens={pub.genero} cor="#ec4899" /></div>
                    <div><div className="mb-2 text-xs font-medium text-[#4b5563]">Cidades</div><Barras itens={pub.cidades} cor="#0ea5e9" /></div>
                    <div><div className="mb-2 text-xs font-medium text-[#4b5563]">Países</div><Barras itens={pub.paises} cor="#10b981" /></div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={card}>
            <div className={titulo}>Alcance e toques no link da bio ao longo do tempo</div>
            <p className={`${sub} mb-2`}><span className="text-[#6366f1]">Linha roxa: alcance por dia</span> · <span className="text-emerald-600">barras verdes: toques no link da bio por dia</span> (a Meta não separa toques por hora).</p>
            <LinhaTempo dados={resumo.evolucao} />
          </div>
        </>
      )}
    </div>
  );
}
