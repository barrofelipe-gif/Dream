"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Icone, Selo } from "@/components/hub/growth/SocialMapa";
import { montarPorRede, type TextoRede } from "@/lib/social/porRede";
import { MAPA, ORDEM, proximosHorarios } from "@/lib/social/mapaRedes";
import type { Rede } from "@/lib/social/types";

type Conta = { id: string; rede: Rede; loja: string };
type InfoRede = { rede: Rede; disponivel: boolean; limites: { tipos: string[] } };
type Midia = { url: string; tipo: "imagem" | "video"; nome: string };
type Item = {
  externoId: string;
  tipo: string;
  legenda: string;
  permalink: string | null;
  miniatura: string | null;
  publicadoEm: string;
  alcance: number;
  compartilhamentos: number;
  salvamentos: number;
  taxaEngajamento: number;
  jaFoi: Record<string, string>;
};
export type Preparado = { externoId: string; midias: Midia[]; legenda: string; tipo: "video" | "imagem" | "carrossel"; contaIds: string[] };
/** Post preparado pelo automático esperando o Felipe aprovar: nada sai sem aprovação no sistema. */
type Revisao = {
  chave: string;
  item: Item;
  midias: Midia[];
  legendaBase: string;
  textos: Partial<Record<Rede, TextoRede>>;
  horarios: Partial<Record<Rede, Date>>;
  estado: "revisar" | "agendando" | "feito";
  msg?: string;
};
type Opcoes = { ytPriv: string; ytShorts: boolean; ttPriv: string; pinBoard: string; pinLink: string };

const TIPO_PUBLICAR: Record<string, "video" | "imagem" | "carrossel"> = { reel: "video", foto: "imagem", carrossel: "carrossel" };
/** Relógio fora do componente (a regra do React reclama de Date.now dentro dele). */
const agoraMs = () => Date.now();
const n0 = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const dataCurta = (d: Date) => `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

/**
 * "Do Instagram para as outras redes": os posts da BFF que mais cresceram no Instagram e ainda não foram para as
 * outras redes pelo painel, com o próximo horário bom de cada rede. "Preparar" leva o post para o publicador (a IA
 * escreve o texto de cada rede); "Preparar e agendar" faz tudo sozinho para os melhores, depois de confirmar.
 */
export default function SocialReaproveitar({
  contas,
  redes,
  ocupados,
  opcoes,
  versao,
  bloqueado,
  onPreparar,
  onAgendado,
}: {
  contas: Conta[];
  redes: InfoRede[];
  ocupados: Partial<Record<Rede, Date[]>>;
  opcoes: Opcoes;
  /** Muda quando o publicador cria uma postagem: recarrega a lista (o "já foi" muda). */
  versao: number;
  /** O publicador está escrevendo com a IA ou enviando: não dá para preparar outro post agora. */
  bloqueado: boolean;
  onPreparar: (p: Preparado) => void;
  onAgendado: () => void;
}) {
  const [itens, setItens] = useState<Item[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [qtd, setQtd] = useState(3);
  const [confirmar, setConfirmar] = useState(false);
  const [log, setLog] = useState<string[]>([]);
  const [revisao, setRevisao] = useState<Revisao[]>([]);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/social/reaproveitar", { cache: "no-store" });
    if (!r.ok) {
      setErro("Não consegui ler os posts do Instagram.");
      setItens([]);
      return;
    }
    setItens((await r.json()).itens);
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar, versao]);

  /** Redes da BFF (nunca da Moranga) que aceitam o formato e onde o post ainda não foi (ou deu erro). */
  const faltam = useCallback(
    (it: Item, semPinterest = false) =>
      ORDEM.filter((r) => {
        if (r === "instagram" || (semPinterest && r === "pinterest")) return false;
        const info = redes.find((x) => x.rede === r);
        if (!info?.disponivel || !info.limites.tipos.includes(TIPO_PUBLICAR[it.tipo] ?? "imagem")) return false;
        if (!contas.some((c) => c.rede === r && c.loja === "bff")) return false;
        const st = it.jaFoi[r];
        return !st || st === "ERRO" || st === "RASCUNHO";
      }),
    [redes, contas],
  );
  const contaBff = (r: Rede) => contas.find((c) => c.rede === r && c.loja === "bff")?.id;
  const pendentes = useMemo(() => (itens ?? []).filter((it) => faltam(it, true).length > 0), [itens, faltam]);

  async function importar(it: Item): Promise<{ midias: Midia[]; legenda: string; tipo: "video" | "imagem" | "carrossel" }> {
    const r = await fetch("/api/social/reaproveitar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ externoId: it.externoId }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "Falha ao trazer do Instagram");
    return j;
  }

  async function preparar(it: Item) {
    setOcupado(it.externoId);
    setErro(null);
    try {
      const d = await importar(it);
      const contaIds = faltam(it).map(contaBff).filter(Boolean) as string[];
      onPreparar({ externoId: it.externoId, ...d, contaIds });
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  // Automático (depois de confirmar): para cada um dos melhores, traz os arquivos e a IA escreve o texto de cada
  // rede, com o próximo horário livre de cada uma. NADA é agendado aqui: vai para a fila de revisão, e só sai
  // o que o Felipe aprovar (a IA erra; a copy é validada no sistema). Pinterest fica de fora (precisa do quadro).
  async function automatico() {
    setConfirmar(false);
    setOcupado("auto");
    setErro(null);
    const linhas: string[] = [];
    const anota = (t: string) => {
      linhas.push(t);
      setLog([...linhas]);
    };
    // Horários ocupados lidos agora (não os da hora que a tela abriu), mais os já reservados na fila de revisão.
    const agenda: Partial<Record<Rede, Date[]>> = Object.fromEntries(ORDEM.map((r) => [r, [...(ocupados[r] ?? [])]]));
    for (const rv of revisao) for (const [r, q] of Object.entries(rv.horarios)) if (q && rv.estado !== "feito") (agenda[r as Rede] ??= []).push(q);
    try {
      const pr = await fetch("/api/social/posts", { cache: "no-store" });
      if (pr.ok)
        for (const p of (await pr.json()).posts as { status: string; agendadoPara: string | null; alvos: { rede: Rede }[] }[])
          if (p.status === "AGENDADO" && p.agendadoPara) for (const a of p.alvos) (agenda[a.rede] ??= []).push(new Date(p.agendadoPara));
    } catch {
      /* fica com os ocupados da tela */
    }
    const naFila = new Set(revisao.filter((r) => r.estado !== "feito").map((r) => r.item.externoId));
    for (const it of pendentes.filter((p) => !naFila.has(p.externoId)).slice(0, qtd)) {
      const alvo = faltam(it, true);
      const nome = (it.legenda.split("\n")[0] || "post sem legenda").slice(0, 50);
      try {
        anota(`⏳ ${nome}: trazendo do Instagram…`);
        const d = await importar(it);
        anota(`✍️ ${nome}: a IA está escrevendo para ${alvo.map((r) => MAPA[r].rotulo).join(", ")}…`);
        const s = await fetch("/api/social/sugerir", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ descricao: "", legenda: d.legenda, redes: alvo, tipo: d.tipo }),
        });
        const sj = await s.json();
        if (!s.ok) throw new Error(sj.error ?? "Falha na IA");
        const textos: Partial<Record<Rede, TextoRede>> = {};
        for (const t of sj.redes as (TextoRede & { rede: Rede })[]) textos[t.rede] = t;
        const horarios: Partial<Record<Rede, Date>> = {};
        for (const r of alvo) {
          const slot = proximosHorarios(r, 1, agenda[r])[0];
          if (!slot || !contaBff(r)) continue;
          horarios[r] = slot.quando;
          (agenda[r] ??= []).push(slot.quando);
        }
        setRevisao((l) => [...l, { chave: `${it.externoId}-${Date.now()}`, item: it, midias: d.midias, legendaBase: d.legenda, textos, horarios, estado: "revisar" }]);
        anota(`👀 ${nome}: pronto para você revisar abaixo.`);
      } catch (e) {
        anota(`⚠️ ${nome}: ${(e as Error).message}`);
      }
    }
    setOcupado(null);
  }

  function editar(chave: string, rede: Rede, campo: "titulo" | "legenda", valor: string) {
    setRevisao((l) => l.map((r) => (r.chave === chave ? { ...r, textos: { ...r.textos, [rede]: { ...(r.textos[rede] ?? { titulo: "", legenda: "" }), [campo]: valor } } } : r)));
  }

  // Aprovado pelo Felipe: agenda cada rede no horário da fila (ou no próximo livre, se ele já passou).
  // A rede que agendou sai da fila do item (aprovar de novo após falha parcial não duplica).
  async function aprovar(rv: Revisao) {
    setRevisao((l) => l.map((r) => (r.chave === rv.chave ? { ...r, estado: "agendando", msg: undefined } : r)));
    const feitos: string[] = [];
    const falhas: string[] = [];
    const restantes: Partial<Record<Rede, Date>> = { ...rv.horarios };
    // Horários já tomados: agendados, outros itens da fila e o que esta aprovação acabou de usar.
    const tomados = (r: Rede) => [...(ocupados[r] ?? []), ...revisao.filter((x) => x.chave !== rv.chave && x.estado !== "feito").flatMap((x) => (x.horarios[r] ? [x.horarios[r]!] : []))];
    for (const [r, q] of Object.entries(rv.horarios) as [Rede, Date][]) {
      const conta = contaBff(r);
      const texto = rv.textos[r]?.legenda ?? "";
      if (!conta) continue;
      if (!texto.trim()) {
        falhas.push(`${MAPA[r].rotulo}: o texto está vazio`);
        continue;
      }
      const quando = q.getTime() > agoraMs() + 5 * 60_000 ? q : (proximosHorarios(r, 1, tomados(r))[0]?.quando ?? null);
      if (!quando) {
        falhas.push(`${MAPA[r].rotulo}: sem horário`);
        continue;
      }
      try {
        const p = await fetch("/api/social/posts", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            legenda: texto,
            midias: rv.midias,
            contaIds: [conta],
            acao: "agendar",
            agendadoPara: quando.toISOString(),
            porRede: montarPorRede([r], rv.textos, opcoes, rv.item.externoId, texto),
          }),
        });
        const pj = await p.json().catch(() => ({}));
        if (p.ok) {
          feitos.push(`${MAPA[r].rotulo} ${dataCurta(quando)}`);
          delete restantes[r];
        } else falhas.push(`${MAPA[r].rotulo}: ${pj.error ?? "não agendou"}`);
      } catch (e) {
        falhas.push(`${MAPA[r].rotulo}: ${(e as Error).message}`);
      }
    }
    const msg = `${feitos.length ? `Agendado: ${feitos.join(" · ")}.` : ""}${falhas.length ? ` Não agendou: ${falhas.join(" · ")}.` : ""}`;
    setRevisao((l) => l.map((r) => (r.chave === rv.chave ? { ...r, horarios: restantes, estado: Object.keys(restantes).length ? "revisar" : "feito", msg } : r)));
    onAgendado();
    carregar();
  }

  const pendentesFila = pendentes.filter((p) => !revisao.some((r) => r.estado !== "feito" && r.item.externoId === p.externoId));
  const planoAuto = pendentesFila.slice(0, qtd).reduce((s, it) => s + faltam(it, true).length, 0);

  return (
    <div className="rounded-2xl border border-[#f3c6dc] bg-[#fff7fb] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-[#1b1f2b]">Do Instagram para as outras redes</p>
          <p className="text-xs text-[#8a8f9c]">Os posts da BFF que mais cresceram no Instagram (alcance, envios e salvamentos) e onde ainda não foram. Cada rede mostra o próximo horário bom.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select value={qtd} onChange={(e) => setQtd(Number(e.target.value))} className="rounded-lg border border-[#e3e5ea] bg-white px-2 py-1.5 text-xs" aria-label="Quantos posts">
            {[1, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "post" : "posts"}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!!ocupado || bloqueado || !pendentesFila.length}
            onClick={() => setConfirmar(true)}
            className="rounded-xl bg-[#c72a7a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a01b5c] disabled:opacity-40"
          >
            {ocupado === "auto" ? "Preparando…" : "Preparar para revisar"}
          </button>
        </div>
      </div>

      {confirmar && (
        <div className="mt-3 rounded-xl border border-[#c72a7a] bg-white p-3 text-sm">
          <p>
            Vai trazer os {Math.min(qtd, pendentesFila.length)} melhores posts e a IA escreve o texto de {planoAuto} postagens, cada rede com o próximo horário livre dela. <b>Nada é agendado agora</b>: tudo aparece abaixo para você ler, corrigir e aprovar.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={automatico} className="rounded-lg bg-[#c72a7a] px-4 py-1.5 text-sm font-semibold text-white">
              Preparar
            </button>
            <button type="button" onClick={() => setConfirmar(false)} className="rounded-lg border border-[#e3e5ea] px-4 py-1.5 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {log.length > 0 && (
        <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto rounded-xl bg-white p-3 text-xs text-[#374151]">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}

      {revisao.length > 0 && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold text-[#1b1f2b]">Para revisar e aprovar ({revisao.filter((r) => r.estado !== "feito").length})</p>
          {revisao.map((rv) => (
            <div key={rv.chave} className={`rounded-xl border bg-white p-3 ${rv.estado === "feito" ? "border-emerald-300 opacity-70" : "border-[#c72a7a]"}`}>
              <div className="flex flex-wrap items-center gap-3">
                {rv.item.miniatura && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={rv.item.miniatura} alt="" className="h-16 w-12 rounded-lg object-cover" />
                )}
                <p className="min-w-0 flex-1 truncate text-xs text-[#4b5563]">{rv.legendaBase.split("\n")[0] || "(sem legenda)"}</p>
                {rv.estado !== "feito" && (
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={rv.estado === "agendando"}
                      onClick={() => aprovar(rv)}
                      className="rounded-lg bg-[#0f8f74] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                    >
                      {rv.estado === "agendando" ? "Agendando…" : "Aprovar e agendar"}
                    </button>
                    <button type="button" disabled={rv.estado === "agendando"} onClick={() => setRevisao((l) => l.filter((r) => r.chave !== rv.chave))} className="rounded-lg border border-[#e3e5ea] px-3 py-1.5 text-xs disabled:opacity-40">
                      Descartar
                    </button>
                  </div>
                )}
              </div>
              {rv.msg && <p className={`mt-2 text-xs ${rv.estado === "feito" ? "text-emerald-700" : "text-red-700"}`}>{rv.msg}</p>}
              <div className="mt-2 grid gap-2 lg:grid-cols-3">
                {(Object.keys(rv.horarios) as Rede[]).map((r) => (
                  <div key={r} className="space-y-1 rounded-lg border border-[#e3e5ea] p-2" style={{ borderTop: `3px solid ${MAPA[r].cor}` }}>
                    <div className="flex items-center justify-between text-xs">
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <Icone rede={r} tamanho={12} />
                        {MAPA[r].rotulo}
                      </span>
                      <span className="text-[#6b7280]">{rv.horarios[r] ? dataCurta(rv.horarios[r]!) : ""}</span>
                    </div>
                    {(r === "youtube" || r === "tiktok") && (
                      <input
                        value={rv.textos[r]?.titulo ?? ""}
                        disabled={rv.estado !== "revisar"}
                        maxLength={r === "tiktok" ? 90 : 100}
                        onChange={(e) => editar(rv.chave, r, "titulo", e.target.value)}
                        placeholder="Título"
                        className="w-full rounded-lg border border-[#e3e5ea] px-2 py-1 text-xs"
                      />
                    )}
                    <textarea
                      value={rv.textos[r]?.legenda ?? ""}
                      disabled={rv.estado !== "revisar"}
                      onChange={(e) => editar(rv.chave, r, "legenda", e.target.value)}
                      rows={7}
                      className="w-full rounded-lg border border-[#e3e5ea] px-2 py-1 text-xs"
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {erro && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{erro}</p>}
      {itens === null && <p className="mt-3 text-xs text-[#8a8f9c]">Carregando os posts do Instagram…</p>}
      {itens && !itens.length && !erro && <p className="mt-3 text-xs text-[#8a8f9c]">Sem posts coletados. Atualize as métricas do Instagram na aba Métricas.</p>}

      <div className="mt-3 grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {(itens ?? []).map((it) => {
          const falta = faltam(it);
          const foi = Object.entries(it.jaFoi);
          return (
            <div key={it.externoId} className="flex gap-3 rounded-xl border border-[#e3e5ea] bg-white p-3">
              <a href={it.permalink ?? undefined} target="_blank" rel="noreferrer" className="shrink-0">
                {it.miniatura ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={it.miniatura} alt="" className="h-24 w-20 rounded-lg object-cover" />
                ) : (
                  <div className="h-24 w-20 rounded-lg bg-[#f3f4f6]" />
                )}
              </a>
              <div className="min-w-0 flex-1 space-y-1.5 text-xs">
                <div className="flex items-center gap-1.5">
                  <Selo rede="instagram" curto />
                  <b className="capitalize">{it.tipo}</b>
                  <span className="text-[#9ca3af]">{new Date(it.publicadoEm).toLocaleDateString("pt-BR")}</span>
                </div>
                <p className="truncate text-[#4b5563]">{it.legenda || "(sem legenda)"}</p>
                <p className="text-[#6b7280]">
                  alcance <b className="text-[#1b1f2b]">{n0(it.alcance)}</b> · ↗ {n0(it.compartilhamentos)} · ⚑ {n0(it.salvamentos)} · {it.taxaEngajamento.toLocaleString("pt-BR")}%
                </p>
                {foi.length > 0 && (
                  <p className="text-[#6b7280]">
                    Já foi:{" "}
                    {foi.map(([r, st]) => (
                      <span key={r} className="mr-1 inline-flex items-center gap-1">
                        <Icone rede={r as Rede} tamanho={11} />
                        {st.toLowerCase()}
                      </span>
                    ))}
                  </p>
                )}
                {falta.length ? (
                  <div className="space-y-0.5">
                    <p className="font-semibold text-[#a01b5c]">Falta em:</p>
                    {falta.map((r) => {
                      const s = proximosHorarios(r, 1, ocupados[r])[0];
                      return (
                        <p key={r} className="flex items-center gap-1.5 text-[#374151]">
                          <span style={{ color: MAPA[r].cor }}>
                            <Icone rede={r} tamanho={12} />
                          </span>
                          {MAPA[r].rotulo}
                          {s && <span className="text-[#9ca3af]">· {dataCurta(s.quando)}</span>}
                        </p>
                      );
                    })}
                  </div>
                ) : (
                  <p className="font-semibold text-emerald-700">Já está em todas as redes conectadas.</p>
                )}
                {falta.length > 0 && (
                  <button
                    type="button"
                    disabled={!!ocupado || bloqueado}
                    onClick={() => preparar(it)}
                    className="rounded-lg border border-[#c72a7a] px-3 py-1 font-semibold text-[#a01b5c] hover:bg-[#fbe7f1] disabled:opacity-40"
                  >
                    {ocupado === it.externoId ? "Trazendo…" : "Preparar no publicador"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
