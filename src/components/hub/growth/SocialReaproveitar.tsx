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
type Opcoes = { ytPriv: string; ytShorts: boolean; ttPriv: string; pinBoard: string; pinLink: string };

const TIPO_PUBLICAR: Record<string, "video" | "imagem" | "carrossel"> = { reel: "video", foto: "imagem", carrossel: "carrossel" };
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

  // Automático (depois de confirmar): para cada um dos melhores, traz os arquivos, a IA escreve o texto de cada
  // rede e agenda cada rede no próximo horário livre dela. Pinterest fica de fora porque precisa escolher o quadro.
  async function automatico() {
    setConfirmar(false);
    setOcupado("auto");
    setErro(null);
    const linhas: string[] = [];
    const anota = (t: string) => {
      linhas.push(t);
      setLog([...linhas]);
    };
    // Horários ocupados lidos agora (não os da hora que a tela abriu), para não agendar em cima de outro post.
    const agenda: Partial<Record<Rede, Date[]>> = Object.fromEntries(ORDEM.map((r) => [r, [...(ocupados[r] ?? [])]]));
    try {
      const pr = await fetch("/api/social/posts", { cache: "no-store" });
      if (pr.ok)
        for (const p of (await pr.json()).posts as { status: string; agendadoPara: string | null; alvos: { rede: Rede }[] }[])
          if (p.status === "AGENDADO" && p.agendadoPara) for (const a of p.alvos) (agenda[a.rede] ??= []).push(new Date(p.agendadoPara));
    } catch {
      /* fica com os ocupados da tela */
    }
    for (const it of pendentes.slice(0, qtd)) {
      const alvo = faltam(it, true);
      const nome = (it.legenda.split("\n")[0] || "post sem legenda").slice(0, 50);
      try {
        anota(`⏳ ${nome}: trazendo do Instagram…`);
        const d = await importar(it);
        anota(`✍️ ${nome}: a IA está escrevendo para ${alvo.map((r) => MAPA[r].rotulo).join(", ")}…`);
        const s = await fetch("/api/social/sugerir", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ descricao: d.legenda.slice(0, 600), legenda: d.legenda, redes: alvo, tipo: d.tipo }),
        });
        const sj = await s.json();
        if (!s.ok) throw new Error(sj.error ?? "Falha na IA");
        const textos: Partial<Record<Rede, TextoRede>> = {};
        for (const t of sj.redes as (TextoRede & { rede: Rede })[]) textos[t.rede] = t;
        for (const r of alvo) {
          const slot = proximosHorarios(r, 1, agenda[r])[0];
          const conta = contaBff(r);
          if (!slot || !conta) continue;
          const p = await fetch("/api/social/posts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              legenda: textos[r]?.legenda || d.legenda,
              midias: d.midias,
              contaIds: [conta],
              acao: "agendar",
              agendadoPara: slot.quando.toISOString(),
              porRede: montarPorRede([r], textos, opcoes, it.externoId, d.legenda),
            }),
          });
          const pj = await p.json().catch(() => ({}));
          if (!p.ok) {
            anota(`⚠️ ${nome} · ${MAPA[r].rotulo}: ${pj.error ?? "não agendou"}`);
            continue;
          }
          (agenda[r] ??= []).push(slot.quando);
          anota(`✅ ${nome} · ${MAPA[r].rotulo}: agendado para ${dataCurta(slot.quando)}`);
        }
      } catch (e) {
        anota(`⚠️ ${nome}: ${(e as Error).message}`);
      }
    }
    setOcupado(null);
    onAgendado();
    carregar();
  }

  const planoAuto = pendentes.slice(0, qtd).reduce((s, it) => s + faltam(it, true).length, 0);

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
            disabled={!!ocupado || bloqueado || !pendentes.length}
            onClick={() => setConfirmar(true)}
            className="rounded-xl bg-[#c72a7a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#a01b5c] disabled:opacity-40"
          >
            {ocupado === "auto" ? "Trabalhando…" : "Preparar e agendar automático"}
          </button>
        </div>
      </div>

      {confirmar && (
        <div className="mt-3 rounded-xl border border-[#c72a7a] bg-white p-3 text-sm">
          <p>
            Vai trazer os {Math.min(qtd, pendentes.length)} melhores posts, a IA escreve o texto de cada rede e agenda <b>{planoAuto}</b> postagens, cada rede no próximo horário livre dela.
            TikTok sai como “{opcoes.ttPriv === "SELF_ONLY" ? "só eu" : "público escolhido"}” e YouTube como “{opcoes.ytPriv === "private" ? "privado" : opcoes.ytPriv === "unlisted" ? "não listado" : "público"}” (mude nos Ajustes por rede acima). Pinterest fica de fora. Tudo aparece em Postagens recentes e dá para excluir antes da hora.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={automatico} className="rounded-lg bg-[#c72a7a] px-4 py-1.5 text-sm font-semibold text-white">
              Confirmar
            </button>
            <button type="button" onClick={() => setConfirmar(false)} className="rounded-lg border border-[#e3e5ea] px-4 py-1.5 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}
      {log.length > 0 && (
        <ul className="mt-3 max-h-48 space-y-0.5 overflow-y-auto rounded-xl bg-white p-3 text-xs text-[#374151]">
          {log.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
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
