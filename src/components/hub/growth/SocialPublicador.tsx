"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DicasPublicacao, Icone } from "@/components/hub/growth/SocialMapa";
import SocialReaproveitar, { type Preparado } from "@/components/hub/growth/SocialReaproveitar";
import { MAPA, ORDEM, proximosHorarios } from "@/lib/social/mapaRedes";
import { montarPorRede, type TextoRede } from "@/lib/social/porRede";

type Rede = "instagram" | "facebook" | "tiktok" | "youtube" | "pinterest";
type InfoRede = {
  rede: Rede;
  rotulo: string;
  disponivel: boolean;
  limites: { legendaMax: number; tipos: string[]; observacao?: string };
  pendencias: string[];
  conectar: { bff: string; moranga: string };
};
type Conta = { id: string; rede: Rede; loja: string; nome: string | null; username: string | null; fotoUrl: string | null };
type Midia = { url: string; tipo: "imagem" | "video"; nome: string };
type Alvo = { id: string; rede: Rede; loja: string; conta: string | null; status: string; url: string | null; erro: string | null };
type Post = { id: string; legenda: string; tipo: string; midias: Midia[]; agendadoPara: string | null; status: string; createdAt: string; alvos: Alvo[] };

const COR: Record<Rede, string> = {
  instagram: "bg-gradient-to-br from-[#f58529] via-[#dd2a7b] to-[#8134af]",
  facebook: "bg-[#1877f2]",
  tiktok: "bg-black",
  youtube: "bg-[#ff0000]",
  pinterest: "bg-[#e60023]",
};
const INICIAL: Record<Rede, string> = { instagram: "IG", facebook: "f", tiktok: "TT", youtube: "YT", pinterest: "P" };
const STATUS_COR: Record<string, string> = {
  PUBLICADO: "bg-emerald-50 text-emerald-700",
  ERRO: "bg-red-50 text-red-700",
  PARCIAL: "bg-amber-50 text-amber-700",
  AGENDADO: "bg-sky-50 text-sky-700",
  PUBLICANDO: "bg-indigo-50 text-indigo-700",
  RASCUNHO: "bg-zinc-100 text-zinc-600",
  PENDENTE: "bg-zinc-100 text-zinc-600",
};
/** Redes em que o título é um campo próprio (no Instagram e no Facebook o texto é só a legenda). */
const COM_TITULO: Rede[] = ["youtube", "pinterest", "tiktok"];
const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";

const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";
const dataCurta = (d: Date) => `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()]} ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

export default function SocialPublicador({ abrirMapa }: { abrirMapa?: () => void }) {
  const [redes, setRedes] = useState<InfoRede[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [legenda, setLegenda] = useState("");
  const [descricao, setDescricao] = useState("");
  const [textos, setTextos] = useState<Partial<Record<Rede, TextoRede>>>({});
  const [abaTexto, setAbaTexto] = useState<Rede | null>(null);
  const [gerando, setGerando] = useState(false);
  const [dicaGeral, setDicaGeral] = useState("");
  const [origem, setOrigem] = useState<string | null>(null);
  const [midias, setMidias] = useState<Midia[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const arrastos = useRef(0);
  const pedidoIa = useRef(0);
  /** Muda a cada postagem criada: a lista "do Instagram para as outras redes" se recarrega. */
  const [versao, setVersao] = useState(0);
  const [quando, setQuando] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const [opc, setOpc] = useState({ ytPriv: "private", ytShorts: true, ttPriv: "SELF_ONLY", pinBoard: "", pinLink: "" });
  const [boards, setBoards] = useState<{ id: string; name: string }[]>([]);

  const carregar = useCallback(async () => {
    const [a, b] = await Promise.all([fetch("/api/social/contas", { cache: "no-store" }), fetch("/api/social/posts", { cache: "no-store" })]);
    if (a.ok) {
      const j = await a.json();
      setRedes(j.redes);
      setContas(j.contas);
    }
    if (b.ok) setPosts((await b.json()).posts);
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  // Com a tela aberta, publica o que estava agendado e já passou da hora (confere a cada minuto).
  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/social/agendados", { method: "POST" })
        .then((r) => r.json())
        .then((j) => {
          if (j?.processados > 0) carregar();
        })
        .catch(() => {});
    }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const contasPorRede = useMemo(() => {
    const m = new Map<Rede, Conta[]>();
    for (const c of contas) m.set(c.rede, [...(m.get(c.rede) ?? []), c]);
    return m;
  }, [contas]);

  const redesEscolhidas = useMemo(() => new Set([...escolhidas].map((id) => contas.find((c) => c.id === id)?.rede).filter(Boolean) as Rede[]), [escolhidas, contas]);
  const listaRedes = useMemo(() => ORDEM.filter((r) => redesEscolhidas.has(r)), [redesEscolhidas]);
  const abaAtual = abaTexto && redesEscolhidas.has(abaTexto) ? abaTexto : (listaRedes[0] ?? null);
  const contaPinterest = [...escolhidas].map((id) => contas.find((c) => c.id === id)).find((c) => c?.rede === "pinterest")?.id;
  useEffect(() => {
    if (!contaPinterest) return;
    fetch(`/api/social/pinterest/boards?contaId=${contaPinterest}`)
      .then((r) => (r.ok ? r.json() : { boards: [] }))
      .then((j) => setBoards(j.boards ?? []))
      .catch(() => setBoards([]));
  }, [contaPinterest]);

  // Horários já ocupados por postagens agendadas, por rede: o "melhor horário" pula esses.
  const ocupados = useMemo(() => {
    const m: Partial<Record<Rede, Date[]>> = {};
    for (const p of posts ?? [])
      if (p.status === "AGENDADO" && p.agendadoPara) for (const a of p.alvos) (m[a.rede] ??= []).push(new Date(p.agendadoPara));
    return m;
  }, [posts]);

  const limiteDe = (r: Rede) => redes.find((x) => x.rede === r)?.limites.legendaMax ?? 2200;
  const limiteLegenda = listaRedes.length ? Math.min(...listaRedes.filter((r) => !textos[r]?.legenda?.trim()).map(limiteDe), 63206) : 2200;

  function alternar(id: string) {
    setEscolhidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  // Conteúdo trazido do Instagram da BFF só vai para contas da BFF.
  const bloqueada = (c: Conta) => !!origem && c.loja !== "bff";
  const todasDisponiveis = contas.filter((c) => redes.find((r) => r.rede === c.rede)?.disponivel && !bloqueada(c)).map((c) => c.id);

  async function subir(files: FileList | null) {
    if (!files?.length) return;
    setMsg(null);
    for (const f of Array.from(files)) {
      if (!/^(image\/(jpeg|png|webp)|video\/(mp4|quicktime))$/.test(f.type)) {
        setMsg({ tipo: "erro", texto: `${f.name}: use foto JPG, PNG ou WEBP, ou vídeo MP4 ou MOV.` });
        continue;
      }
      setEnviando(f.name);
      try {
        const b = await upload(`publicador/${Date.now()}-${f.name.replace(/[^\w.-]/g, "_")}`, f, {
          access: "public",
          handleUploadUrl: "/api/webhooks/social-upload",
        });
        setMidias((m) => [...m, { url: b.url, tipo: f.type.startsWith("video") ? "video" : "imagem", nome: f.name }]);
      } catch (e) {
        setMsg({ tipo: "erro", texto: `Não consegui enviar ${f.name}: ${(e as Error).message}` });
      }
    }
    setEnviando(null);
    if (arquivo.current) arquivo.current.value = "";
  }

  const tipoAtual = midias.length > 1 ? "carrossel" : midias[0]?.tipo === "video" ? "video" : midias.length ? "imagem" : "texto";

  async function gerarComIa(redesAlvo: Rede[] = listaRedes, base?: { descricao: string; legenda: string; tipo: string }) {
    if (!redesAlvo.length) {
      setMsg({ tipo: "erro", texto: "Escolha onde postar para a IA escrever o texto de cada rede." });
      return;
    }
    const d = base?.descricao ?? descricao;
    const l = base?.legenda ?? legenda;
    if (!d.trim() && !l.trim()) {
      setMsg({ tipo: "erro", texto: "Escreva a legenda principal ou uma observação para a IA ter de onde partir." });
      return;
    }
    // Cada pedido tem um número: se outro conteúdo for carregado antes da resposta chegar, a resposta antiga é descartada.
    const pedido = ++pedidoIa.current;
    setGerando(true);
    setMsg(null);
    try {
      const r = await fetch("/api/social/sugerir", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ descricao: d, legenda: l, redes: redesAlvo, tipo: base?.tipo ?? tipoAtual }),
      });
      const j = await r.json();
      if (pedido !== pedidoIa.current) return;
      if (!r.ok) throw new Error(j.error ?? "Falha na IA");
      const novo: Partial<Record<Rede, TextoRede>> = {};
      for (const t of j.redes as (TextoRede & { rede: Rede })[]) novo[t.rede] = t;
      setTextos((x) => ({ ...x, ...novo }));
      setDicaGeral(j.dicaGeral ?? "");
      setAbaTexto(redesAlvo[0]);
    } catch (e) {
      if (pedido === pedidoIa.current) setMsg({ tipo: "erro", texto: (e as Error).message });
    } finally {
      if (pedido === pedidoIa.current) setGerando(false);
    }
  }

  function limpar() {
    pedidoIa.current++;
    setGerando(false);
    setLegenda("");
    setDescricao("");
    setTextos({});
    setDicaGeral("");
    setOrigem(null);
    setMidias([]);
    setQuando("");
  }

  async function criar(contaIds: string[], acao: "publicar" | "agendar" | "rascunho", agendadoPara: string | null, redesDoPost: Rede[]) {
    const legendaFinal = legenda.trim() ? legenda : (redesDoPost.map((r) => textos[r]?.legenda).find((x) => x?.trim()) ?? "");
    const r = await fetch("/api/social/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ legenda: legendaFinal, midias, contaIds, acao, agendadoPara, porRede: montarPorRede(redesDoPost, textos, opc, origem, legendaFinal) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "Não foi possível enviar.");
    setVersao((v) => v + 1);
    return j as { status: string };
  }

  async function enviar(acao: "publicar" | "agendar" | "rascunho") {
    setMsg(null);
    if (acao === "agendar" && !quando) {
      setMsg({ tipo: "erro", texto: "Escolha a data e a hora do agendamento." });
      return;
    }
    setTrabalhando(true);
    try {
      const j = await criar([...escolhidas], acao, acao === "agendar" ? new Date(quando).toISOString() : null, listaRedes);
      setMsg({
        tipo: j.status === "ERRO" ? "erro" : "ok",
        texto:
          acao === "publicar"
            ? j.status === "PUBLICADO"
              ? "Publicado em todas as redes escolhidas."
              : j.status === "PUBLICANDO"
                ? "Enviado. A rede ainda está processando o vídeo: ele sai sozinho em alguns minutos (acompanhe em Postagens recentes)."
                : j.status === "PARCIAL"
                ? "Publicado em parte das redes. Veja abaixo o que falhou."
                : "Não saiu em nenhuma rede. Veja abaixo o motivo."
            : acao === "agendar"
              ? "Agendado."
              : "Rascunho salvo.",
      });
      if (acao !== "rascunho" && j.status !== "ERRO") limpar();
    } catch (e) {
      setMsg({ tipo: "erro", texto: (e as Error).message });
    } finally {
      setTrabalhando(false);
      await carregar();
    }
  }

  // Uma postagem por rede, cada uma no próximo melhor horário dela (pula horário já ocupado).
  async function agendarNosMelhores() {
    setMsg(null);
    setTrabalhando(true);
    const feitos: string[] = [];
    const falhas: string[] = [];
    const agendadas = new Set<string>();
    for (const rede of listaRedes) {
      const ids = [...escolhidas].filter((id) => contas.find((c) => c.id === id)?.rede === rede);
      const slot = proximosHorarios(rede, 1, ocupados[rede])[0];
      if (!slot) {
        falhas.push(`${MAPA[rede].rotulo}: sem horário na agenda`);
        continue;
      }
      try {
        await criar(ids, "agendar", slot.quando.toISOString(), [rede]);
        ids.forEach((id) => agendadas.add(id));
        feitos.push(`${MAPA[rede].rotulo} ${dataCurta(slot.quando)}`);
      } catch (e) {
        falhas.push(`${MAPA[rede].rotulo}: ${(e as Error).message}`);
      }
    }
    setTrabalhando(false);
    setMsg({ tipo: falhas.length && !feitos.length ? "erro" : "ok", texto: `${feitos.length ? `Agendado: ${feitos.join(" · ")}.` : ""}${falhas.length ? ` Não agendou: ${falhas.join(" · ")}.` : ""}` });
    // Tudo agendado: limpa. Parte falhou: mantém o conteúdo e deixa marcadas só as contas que faltam, para corrigir e repetir.
    if (feitos.length && !falhas.length) limpar();
    else if (feitos.length) setEscolhidas((s) => new Set([...s].filter((id) => !agendadas.has(id))));
    await carregar();
  }

  function preparar(p: Preparado) {
    setMidias(p.midias);
    setLegenda(p.legenda);
    setDescricao(p.legenda.split("\n")[0].slice(0, 200));
    setOrigem(p.externoId);
    setTextos({});
    setEscolhidas(new Set(p.contaIds));
    setMsg({ tipo: "ok", texto: "Post do Instagram carregado. A IA está escrevendo o texto de cada rede…" });
    const redesP = ORDEM.filter((r) => p.contaIds.some((id) => contas.find((c) => c.id === id)?.rede === r));
    gerarComIa(redesP, { descricao: p.legenda.slice(0, 600), legenda: p.legenda, tipo: p.tipo });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function tentarDeNovo(id: string) {
    await fetch(`/api/social/posts/${id}`, { method: "POST" });
    await carregar();
  }
  async function excluir(id: string) {
    if (!confirm("Excluir esta postagem do painel? O que já foi publicado nas redes não é apagado.")) return;
    await fetch(`/api/social/posts/${id}`, { method: "DELETE" });
    await carregar();
  }

  const temTexto = legenda.trim() || listaRedes.some((r) => textos[r]?.legenda?.trim());
  const podeEnviar = escolhidas.size > 0 && (temTexto || midias.length > 0) && !enviando && !trabalhando && !gerando;
  const textoAtual = abaAtual ? textos[abaAtual] : undefined;
  const legendaPrevia = (abaAtual && textos[abaAtual]?.legenda) || legenda;

  return (
    <section
      className="relative rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        arrastos.current++;
        setArrastando(true);
      }}
      onDragLeave={() => {
        arrastos.current = Math.max(0, arrastos.current - 1);
        if (!arrastos.current) setArrastando(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        arrastos.current = 0;
        setArrastando(false);
        subir(e.dataTransfer.files);
      }}
    >
      {arrastando && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-2xl border-4 border-dashed border-[#6366f1] bg-[#eef0ff]/90">
          <p className="text-lg font-semibold text-[#4f46e5]">Solte aqui as fotos e os vídeos</p>
        </div>
      )}
      <div className="mb-4">
        <p className="text-base font-semibold text-[#1b1f2b]">Publicador: postar em todas as redes</p>
        <p className="text-xs text-[#8a8f9c]">Arraste a foto ou o vídeo para qualquer lugar desta tela, escolha as redes, deixe a IA escrever o texto de cada uma e publique agora ou cada rede no seu melhor horário.</p>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          {/* Redes e contas */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#1b1f2b]">Onde postar</p>
              <button onClick={() => setEscolhidas(new Set(escolhidas.size === todasDisponiveis.length ? [] : todasDisponiveis))} className="text-xs text-[#6366f1] hover:underline">
                {escolhidas.size === todasDisponiveis.length && todasDisponiveis.length > 0 ? "Limpar" : "Selecionar todas"}
              </button>
            </div>
            <div className="grid gap-2 lg:grid-cols-2">
              {redes.map((r) => {
                const lista = contasPorRede.get(r.rede) ?? [];
                return (
                  <div key={r.rede} className="rounded-xl border border-[#e3e5ea] p-3">
                    <div className="flex items-center gap-2">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold text-white ${COR[r.rede]}`}>{INICIAL[r.rede]}</span>
                      <span className="text-sm font-medium text-[#1b1f2b]">{r.rotulo}</span>
                      {!r.disponivel && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] text-zinc-600">em breve</span>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {lista.map((c) => {
                        const on = escolhidas.has(c.id);
                        return (
                          <button
                            key={c.id}
                            disabled={!r.disponivel || bloqueada(c)}
                            title={bloqueada(c) ? "Conteúdo do Instagram da BFF só vai para contas da BFF" : undefined}
                            onClick={() => alternar(c.id)}
                            className={`rounded-full border px-3 py-1 text-xs transition ${on ? "border-[#6366f1] bg-[#eef0ff] font-semibold text-[#3d40c9]" : "border-[#e3e5ea] text-[#5a5f6d] hover:border-[#c5c8d4]"} disabled:opacity-40`}
                          >
                            {on ? "✓ " : ""}@{c.username ?? c.nome} <span className="text-[#a1a5b0]">· {c.loja}</span>
                          </button>
                        );
                      })}
                      {(["bff", "moranga"] as const)
                        .filter((l) => !lista.some((c) => c.loja === l))
                        .map((l) => (
                          <a key={l} href={r.conectar[l]} className="rounded-full border border-dashed border-[#d5d8e0] px-3 py-1 text-xs text-[#8a8f9c] hover:border-[#6366f1] hover:text-[#6366f1]">
                            + Conectar {l === "bff" ? "BFF" : "Moranga"}
                          </a>
                        ))}
                    </div>
                    {r.pendencias.length > 0 && lista.length === 0 && (
                      <ul className="mt-2 list-disc pl-5 text-[11px] text-[#a1a5b0]">{r.pendencias.slice(0, 3).map((p) => <li key={p}>{p}</li>)}</ul>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Mídia */}
          <div>
            <p className="mb-2 text-sm font-semibold text-[#1b1f2b]">Foto ou vídeo</p>
            <div className="rounded-xl border-2 border-dashed border-[#d5d8e0] p-4 text-center">
              <input ref={arquivo} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={(e) => subir(e.target.files)} className="hidden" />
              <button onClick={() => arquivo.current?.click()} className="rounded-lg bg-[#eef0f4] px-4 py-2 text-sm font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]">
                Escolher arquivos
              </button>
              <p className="mt-2 text-[11px] text-[#a1a5b0]">ou arraste para qualquer lugar desta tela. Fotos JPG/PNG e vídeos MP4 ou MOV. Mais de um arquivo vira carrossel.</p>
              {enviando && <p className="mt-2 text-xs text-[#6366f1]">Enviando {enviando}…</p>}
              {origem && <p className="mt-2 text-xs text-[#a01b5c]">Arquivos trazidos de um post do Instagram.</p>}
            </div>
            {midias.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-5 2xl:grid-cols-8">
                {midias.map((m, i) => (
                  <div key={m.url} className="group relative overflow-hidden rounded-lg border border-[#e3e5ea]">
                    {m.tipo === "video" ? (
                      <video src={m.url} className="aspect-square w-full object-cover" muted />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.url} alt="" className="aspect-square w-full object-cover" />
                    )}
                    <span className="absolute left-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[9px] text-white">{i + 1}</span>
                    <button onClick={() => setMidias((l) => l.filter((x) => x.url !== m.url))} className="absolute right-1 top-1 rounded bg-black/60 px-1.5 text-xs text-white opacity-0 group-hover:opacity-100">✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* IA + texto */}
          <div className="space-y-3 rounded-xl border border-[#e0e1fb] bg-[#f8f8ff] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-[#1b1f2b]">Texto de cada rede, com SEO e busca por IA</p>
              <button
                type="button"
                onClick={() => gerarComIa()}
                disabled={gerando || !listaRedes.length}
                className="rounded-xl bg-[#6366f1] px-4 py-2 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-40"
              >
                {gerando ? "Escrevendo…" : "✨ Escrever com IA para cada rede"}
              </button>
            </div>
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className={campo}
              placeholder="Observação para a IA (opcional). Ex.: lançamento; manter “Pesquise no APP: Mayla”"
            />
            <p className="text-[11px] text-[#8a8f9c]">A IA escreve a chamada de atacado de cada rede (sem descrever a peça), a partir da legenda principal e desta observação. Leia e corrija antes de publicar: ela pode errar.</p>
            {dicaGeral && <p className="rounded-lg bg-white px-3 py-2 text-xs text-[#4338ca]">💡 {dicaGeral}</p>}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs font-semibold text-[#5a5f6d]">Legenda principal (vale para as redes sem texto próprio)</p>
                <span className={`text-[11px] ${legenda.length > limiteLegenda ? "text-red-600" : "text-[#a1a5b0]"}`}>
                  {legenda.length}/{limiteLegenda}
                </span>
              </div>
              <textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} rows={4} className={`${campo} bg-white`} placeholder="Escreva o texto da postagem" />
            </div>

            {listaRedes.length > 0 && (
              <div className="rounded-xl border border-[#e3e5ea] bg-white">
                <div className="flex gap-1 overflow-x-auto border-b border-[#e3e5ea] p-1.5">
                  {listaRedes.map((r) => {
                    const ativa = r === abaAtual;
                    const m = MAPA[r];
                    return (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setAbaTexto(r)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold"
                        style={ativa ? (m.contornado ? { background: "#fff", color: m.cor, border: `1.5px solid ${m.cor}` } : { background: m.gradiente, color: "#fff" }) : { color: "#5a5f6d" }}
                      >
                        <Icone rede={r} />
                        {m.rotulo}
                        {textos[r]?.legenda?.trim() ? " ✓" : ""}
                      </button>
                    );
                  })}
                </div>
                {abaAtual && (
                  <div className="space-y-2 p-3">
                    {COM_TITULO.includes(abaAtual) && (
                      <div>
                        <div className="mb-1 flex justify-between text-[11px] text-[#8a8f9c]">
                          <span>Título {abaAtual === "tiktok" ? "(só para fotos)" : "(a busca exata no começo)"}</span>
                          <span>{(textoAtual?.titulo ?? "").length}/{abaAtual === "tiktok" ? 90 : 100}</span>
                        </div>
                        <input
                          value={textoAtual?.titulo ?? ""}
                          maxLength={abaAtual === "tiktok" ? 90 : 100}
                          onChange={(e) => setTextos((x) => ({ ...x, [abaAtual]: { ...(x[abaAtual] ?? { legenda: "" }), titulo: e.target.value } }))}
                          className={campo}
                          placeholder={abaAtual === "youtube" ? "Ex.: Conjunto canelado fitness atacado: provando P, M e G" : "Título"}
                        />
                      </div>
                    )}
                    <div>
                      <div className="mb-1 flex justify-between text-[11px] text-[#8a8f9c]">
                        <span>{abaAtual === "youtube" || abaAtual === "pinterest" ? "Descrição" : "Legenda"} do {MAPA[abaAtual].rotulo} (vazio = usa a principal)</span>
                        <span className={(textoAtual?.legenda ?? "").length > limiteDe(abaAtual) ? "text-red-600" : ""}>
                          {(textoAtual?.legenda ?? "").length}/{limiteDe(abaAtual)}
                        </span>
                      </div>
                      <textarea
                        value={textoAtual?.legenda ?? ""}
                        onChange={(e) => setTextos((x) => ({ ...x, [abaAtual]: { ...(x[abaAtual] ?? { titulo: "" }), legenda: e.target.value } }))}
                        rows={6}
                        className={campo}
                        placeholder="Texto próprio desta rede"
                      />
                    </div>
                    {textoAtual && (textoAtual.palavrasChave?.length || textoAtual.textoNaTela || textoAtual.perguntaIa) && (
                      <div className="grid gap-2 text-xs sm:grid-cols-2">
                        {!!textoAtual.palavrasChave?.length && (
                          <div className="rounded-lg bg-[#f4f5f8] p-2">
                            <p className="mb-1 font-semibold text-[#5a5f6d]">Palavras-chave (Google e busca da rede)</p>
                            <div className="flex flex-wrap gap-1">
                              {textoAtual.palavrasChave.map((k) => (
                                <span key={k} className="rounded-full bg-white px-2 py-0.5 text-[#1b1f2b]">{k}</span>
                              ))}
                            </div>
                          </div>
                        )}
                        {textoAtual.textoNaTela && (
                          <div className="rounded-lg bg-[#f4f5f8] p-2">
                            <p className="mb-1 font-semibold text-[#5a5f6d]">Escrever no vídeo (3 primeiros segundos)</p>
                            <p className="text-[#1b1f2b]">{textoAtual.textoNaTela}</p>
                          </div>
                        )}
                        {textoAtual.perguntaIa && (
                          <div className="rounded-lg bg-[#f4f5f8] p-2">
                            <p className="mb-1 font-semibold text-[#5a5f6d]">Pergunta que este post responde no ChatGPT e no Google</p>
                            <p className="text-[#1b1f2b]">{textoAtual.perguntaIa}</p>
                          </div>
                        )}
                        {textoAtual.textoAlternativo && (
                          <div className="rounded-lg bg-[#f4f5f8] p-2">
                            <p className="mb-1 font-semibold text-[#5a5f6d]">Texto alternativo (colar em Configurações avançadas)</p>
                            <p className="text-[#1b1f2b]">{textoAtual.textoAlternativo}</p>
                          </div>
                        )}
                        {textoAtual.porQue && <p className="text-[11px] text-[#8a8f9c] sm:col-span-2">Por que: {textoAtual.porQue}</p>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Ajustes por rede */}
          {(redesEscolhidas.has("youtube") || redesEscolhidas.has("tiktok") || redesEscolhidas.has("pinterest")) && (
            <div className="grid gap-4 rounded-xl border border-[#e3e5ea] p-4 lg:grid-cols-3">
              <p className="text-sm font-semibold text-[#1b1f2b] lg:col-span-3">Ajustes por rede</p>
              {redesEscolhidas.has("youtube") && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[#5a5f6d]">YouTube</p>
                  <select value={opc.ytPriv} onChange={(e) => setOpc({ ...opc, ytPriv: e.target.value })} className={campo}>
                    <option value="private">Privado (recomendado até a API ser auditada)</option>
                    <option value="unlisted">Não listado</option>
                    <option value="public">Público</option>
                  </select>
                  <label className="flex items-center gap-2 text-xs text-[#5a5f6d]">
                    <input type="checkbox" checked={opc.ytShorts} onChange={(e) => setOpc({ ...opc, ytShorts: e.target.checked })} /> É um Short (vertical, até 3 min)
                  </label>
                </div>
              )}
              {redesEscolhidas.has("tiktok") && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[#5a5f6d]">TikTok</p>
                  <select value={opc.ttPriv} onChange={(e) => setOpc({ ...opc, ttPriv: e.target.value })} className={campo}>
                    <option value="SELF_ONLY">Só eu (obrigatório até o app ser auditado)</option>
                    <option value="FOLLOWER_OF_CREATOR">Seguidores</option>
                    <option value="MUTUAL_FOLLOW_FRIENDS">Amigos</option>
                    <option value="PUBLIC_TO_EVERYONE">Todos</option>
                  </select>
                </div>
              )}
              {redesEscolhidas.has("pinterest") && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[#5a5f6d]">Pinterest</p>
                  <select value={opc.pinBoard} onChange={(e) => setOpc({ ...opc, pinBoard: e.target.value })} className={campo}>
                    <option value="">Escolha o quadro…</option>
                    {boards.map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                  <input value={opc.pinLink} onChange={(e) => setOpc({ ...opc, pinLink: e.target.value })} placeholder="Link de destino (vazio = link do app)" className={campo} />
                </div>
              )}
            </div>
          )}

          {/* Quando */}
          <div className="rounded-xl border border-[#e3e5ea] p-4">
            <p className="mb-2 text-sm font-semibold text-[#1b1f2b]">Quando</p>
            <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} className={`${campo} max-w-xs`} />
            <p className="mt-1 text-[11px] text-[#a1a5b0]">
              Deixe vazio para publicar agora. O horário é o de Brasília. Ou use <b>Cada rede no melhor horário</b>: o painel cria uma postagem por rede, cada uma no próximo horário bom dela.
            </p>
          </div>

          {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => enviar("publicar")} disabled={!podeEnviar} className="rounded-xl bg-[#6366f1] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-40">
              {trabalhando ? "Enviando…" : "Publicar agora em todas"}
            </button>
            <button onClick={agendarNosMelhores} disabled={!podeEnviar} className="rounded-xl bg-[#0f8f74] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0b7360] disabled:opacity-40">
              Cada rede no melhor horário
            </button>
            <button onClick={() => enviar("agendar")} disabled={!podeEnviar || !quando} className="rounded-xl bg-[#1b1f2b] px-5 py-2.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40">
              Agendar no horário escolhido
            </button>
            <button onClick={() => enviar("rascunho")} disabled={!podeEnviar} className="rounded-xl bg-[#eef0f4] px-5 py-2.5 text-sm font-medium text-[#1b1f2b] hover:bg-[#e3e5ea] disabled:opacity-40">
              Salvar rascunho
            </button>
          </div>
        </div>

        {/* Prévia e, embaixo, o mapa de publicação das redes escolhidas */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-[280px] self-center rounded-[2rem] border border-[#e3e5ea] bg-[#fafafa] p-3 shadow-sm">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-7 w-7 rounded-full bg-[#e3e5ea]" />
                <span className="text-xs font-semibold text-[#1b1f2b]">{abaAtual ? `${MAPA[abaAtual].rotulo} · bff` : "sua_loja"}</span>
              </div>
              <div className="mb-2 aspect-square overflow-hidden rounded-lg bg-[#eef0f4]">
                {midias[0] ? (
                  midias[0].tipo === "video" ? (
                    <video src={midias[0].url} className="h-full w-full object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={midias[0].url} alt="" className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-[#a1a5b0]">sem mídia</div>
                )}
              </div>
              {abaAtual && textos[abaAtual]?.titulo && <p className="mb-1 text-[12px] font-semibold text-[#1b1f2b]">{textos[abaAtual]?.titulo}</p>}
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-[12px] leading-snug text-[#1b1f2b]">{legendaPrevia || "A legenda aparece aqui."}</p>
              {midias.length > 1 && <p className="mt-2 text-[10px] text-[#8a8f9c]">Carrossel com {midias.length} itens</p>}
            </div>
            <p className="mt-2 text-center text-[10px] text-[#a1a5b0]">{escolhidas.size} conta{escolhidas.size === 1 ? "" : "s"} escolhida{escolhidas.size === 1 ? "" : "s"}</p>
          </div>
          <DicasPublicacao redes={listaRedes} ocupados={ocupados} onUsar={setQuando} abrirMapa={() => abrirMapa?.()} />
        </div>
      </div>

      {/* Instagram → outras redes */}
      <div className="mt-8">
        <SocialReaproveitar contas={contas} redes={redes} ocupados={ocupados} opcoes={opc} versao={versao} bloqueado={gerando || trabalhando} onPreparar={preparar} onAgendado={carregar} />
      </div>

      {/* Histórico */}
      <div className="mt-8">
        <p className="mb-2 text-sm font-semibold text-[#1b1f2b]">Postagens recentes</p>
        {posts === null && <p className="text-xs text-[#8a8f9c]">Carregando…</p>}
        {posts && posts.length === 0 && <p className="rounded-xl border border-dashed border-[#d5d8e0] p-4 text-center text-xs text-[#8a8f9c]">Nenhuma postagem ainda.</p>}
        <div className="grid gap-2 xl:grid-cols-2">
          {(posts ?? []).map((p) => (
            <div key={p.id} className="rounded-xl border border-[#e3e5ea] p-3">
              <div className="flex items-start gap-3">
                {p.midias[0] &&
                  (p.midias[0].tipo === "video" ? (
                    <video src={p.midias[0].url} className="h-14 w-14 rounded-lg object-cover" muted />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.midias[0].url} alt="" className="h-14 w-14 rounded-lg object-cover" />
                  ))}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[#1b1f2b]">{p.legenda || "(sem texto)"}</p>
                  <p className="text-[11px] text-[#8a8f9c]">
                    {p.agendadoPara ? `Agendada para ${fmt(p.agendadoPara)}` : fmt(p.createdAt)}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_COR[p.status] ?? ""}`}>{p.status.toLowerCase()}</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.alvos.map((a) => (
                  <span key={a.id} title={a.erro ?? ""} className={`rounded-full px-2 py-0.5 text-[11px] ${STATUS_COR[a.status] ?? ""}`}>
                    {a.rede} @{a.conta}: {a.status.toLowerCase()}
                    {a.url && (
                      <>
                        {" "}
                        <a href={a.url} target="_blank" rel="noreferrer" className="underline">ver</a>
                      </>
                    )}
                  </span>
                ))}
              </div>
              {p.alvos.some((a) => a.erro) && <p className="mt-2 text-[11px] text-red-700">{p.alvos.filter((a) => a.erro).map((a) => `${a.rede}: ${a.erro}`).join(" · ")}</p>}
              <div className="mt-2 flex gap-3 text-[11px]">
                {(p.status === "ERRO" || p.status === "PARCIAL" || p.status === "RASCUNHO" || p.status === "AGENDADO") && (
                  <button onClick={() => tentarDeNovo(p.id)} className="text-[#6366f1] hover:underline">
                    {p.status === "RASCUNHO" || p.status === "AGENDADO" ? "Publicar agora" : "Tentar de novo"}
                  </button>
                )}
                <button onClick={() => excluir(p.id)} className="text-red-600 hover:underline">Excluir</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
