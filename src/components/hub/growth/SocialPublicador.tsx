"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DicasPublicacao, Icone } from "@/components/hub/growth/SocialMapa";
import SocialReaproveitar, { type Preparado } from "@/components/hub/growth/SocialReaproveitar";
import { MAPA, ORDEM, horariosDoDia, hojeEmBrasilia, proximosHorarios } from "@/lib/social/mapaRedes";
import { montarPorRede, type OpcoesTikTok, type TextoRede } from "@/lib/social/porRede";
import type { CriadorTikTok } from "@/lib/social/tiktok";

const TT_INICIAL: OpcoesTikTok = { comentarios: false, dueto: false, stitch: false, divulgar: false, marcaPropria: false, conteudoDeMarca: false, consentimento: false };
const TT_PRIVACIDADE: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Todos",
  FOLLOWER_OF_CREATOR: "Seguidores",
  MUTUAL_FOLLOW_FRIENDS: "Amigos (quem você segue e te segue)",
  SELF_ONLY: "Só eu",
};
const LINK_MUSICA = "https://www.tiktok.com/legal/page/global/music-usage-confirmation/en";
const LINK_MARCA = "https://www.tiktok.com/legal/page/global/bc-policy/en";
type EstadoCriador = { info?: CriadorTikTok; erro?: string };

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
  // Melhores horários: o dia escolhido (hoje ou outra data) e os horários marcados por rede (ISO).
  const [diaMelhores, setDiaMelhores] = useState(() => hojeEmBrasilia());
  const [marcados, setMarcados] = useState<Partial<Record<Rede, string[]>>>({});
  const [trabalhando, setTrabalhando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  // TikTok: privacidade começa sem escolha e tudo desmarcado (regra da auditoria da TikTok).
  const [opc, setOpc] = useState({ ytPriv: "private", ytShorts: true, ttPriv: "", pinBoard: "", pinLink: "" });
  const [tt, setTt] = useState<OpcoesTikTok>(TT_INICIAL);
  const [criadores, setCriadores] = useState<Record<string, EstadoCriador>>({});
  /** Qual leitura do TikTok está em `criadores`: enquanto não for a atual, o envio fica bloqueado. */
  const [leituraTikTok, setLeituraTikTok] = useState("");
  const [duracoes, setDuracoes] = useState<Record<string, number>>({});
  // O automático (Instagram → outras redes) não usa a escolha manual do TikTok: lá sai sempre como Só eu.
  const opcAuto = useMemo(() => ({ ...opc, ttPriv: "" }), [opc]);
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

  // TikTok: lê os dados do criador toda vez que uma conta do TikTok entra na postagem.
  const contasTikTok = useMemo(() => [...escolhidas].filter((id) => contas.find((c) => c.id === id)?.rede === "tiktok"), [escolhidas, contas]);
  const chaveTikTok = contasTikTok.join(",");
  useEffect(() => {
    if (!chaveTikTok) return;
    let vivo = true;
    const ids = chaveTikTok.split(",");
    Promise.all(
      ids.map(async (id): Promise<[string, EstadoCriador]> => {
        try {
          const r = await fetch(`/api/social/tiktok/criador?contaId=${encodeURIComponent(id)}`, { cache: "no-store" });
          const j = await r.json().catch(() => ({}));
          return [id, r.ok ? { info: j.criador } : { erro: j.error ?? "não consegui ler a conta" }];
        } catch (e) {
          return [id, { erro: (e as Error).message }];
        }
      }),
    ).then((lista) => {
      if (!vivo) return;
      setCriadores(Object.fromEntries(lista));
      setLeituraTikTok(`${chaveTikTok}|${versao}`);
    });
    return () => {
      vivo = false;
    };
  }, [chaveTikTok, versao]);

  // Duração de cada vídeo (o TikTok tem um limite por conta).
  const duracaoPedida = useRef(new Set<string>());
  useEffect(() => {
    for (const m of midias) {
      if (m.tipo !== "video" || duracaoPedida.current.has(m.url)) continue;
      duracaoPedida.current.add(m.url);
      const v = document.createElement("video");
      v.preload = "metadata";
      v.onloadedmetadata = () => setDuracoes((d) => ({ ...d, [m.url]: v.duration }));
      v.onerror = () => setDuracoes((d) => ({ ...d, [m.url]: NaN }));
      v.src = m.url;
    }
  }, [midias]);

  // Horários já ocupados por postagens agendadas, por rede: o "melhor horário" pula esses.
  const ocupados = useMemo(() => {
    const m: Partial<Record<Rede, Date[]>> = {};
    for (const p of posts ?? [])
      if (p.status === "AGENDADO" && p.agendadoPara) for (const a of p.alvos) (m[a.rede] ??= []).push(new Date(p.agendadoPara));
    return m;
  }, [posts]);

  // Os melhores horários de cada rede escolhida no dia selecionado (os já agendados vêm marcados como ocupados).
  const melhoresDoDia = useMemo(() => listaRedes.map((rede) => ({ rede, slots: horariosDoDia(rede, diaMelhores, ocupados[rede]) })), [listaRedes, diaMelhores, ocupados]);
  const totalMarcados = listaRedes.reduce((n, r) => n + (marcados[r]?.length ?? 0), 0);

  function alternarHorario(rede: Rede, iso: string) {
    setMarcados((m) => {
      const atual = m[rede] ?? [];
      return { ...m, [rede]: atual.includes(iso) ? atual.filter((x) => x !== iso) : [...atual, iso] };
    });
  }

  // Sorteia um dos melhores horários livres de cada rede nesse dia (quem não tem horário livre fica sem).
  function sortearHorarios() {
    const novo: Partial<Record<Rede, string[]>> = {};
    for (const { rede, slots } of melhoresDoDia) {
      const livres = slots.filter((x) => !x.ocupado);
      if (livres.length) novo[rede] = [livres[Math.floor(Math.random() * livres.length)].quando.toISOString()];
    }
    setMarcados(novo);
    setMsg(Object.keys(novo).length ? null : { tipo: "erro", texto: "Nenhum horário bom livre nesse dia. Escolha outra data." });
  }

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

  async function gerarComIa(redesAlvo: Rede[] = listaRedes, base?: { descricao: string; legenda: string; tipo: string; contaIds?: string[] }) {
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
        body: JSON.stringify({ descricao: d, legenda: l, redes: redesAlvo, tipo: base?.tipo ?? tipoAtual, contaIds: base?.contaIds ?? [...escolhidas] }),
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
    // TikTok: a próxima postagem começa de novo sem privacidade escolhida e sem consentimento.
    setOpc((o) => ({ ...o, ttPriv: "" }));
    setTt(TT_INICIAL);
  }

  async function criar(contaIds: string[], acao: "publicar" | "agendar" | "rascunho", agendadoPara: string | null, redesDoPost: Rede[]) {
    const legendaFinal = legenda.trim() ? legenda : (redesDoPost.map((r) => textos[r]?.legenda).find((x) => x?.trim()) ?? "");
    const r = await fetch("/api/social/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ legenda: legendaFinal, midias, contaIds, acao, agendadoPara, porRede: montarPorRede(redesDoPost, textos, { ...opc, tiktok: tt, loja: contas.find((c) => contaIds.includes(c.id))?.loja }, origem, legendaFinal) }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "Não foi possível enviar.");
    setVersao((v) => v + 1);
    return j as { status: string };
  }

  async function enviar(acao: "publicar" | "agendar" | "rascunho") {
    setMsg(null);
    if (acao !== "rascunho" && bloqueioTikTok) {
      setMsg({ tipo: "erro", texto: bloqueioTikTok });
      return;
    }
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

  // Uma postagem por horário marcado, em cada rede.
  async function agendarMarcados() {
    setMsg(null);
    if (bloqueioTikTok) {
      setMsg({ tipo: "erro", texto: bloqueioTikTok });
      return;
    }
    setTrabalhando(true);
    const feitos: string[] = [];
    const falhas: string[] = [];
    const agendadas = new Set<string>();
    const restantes: Partial<Record<Rede, string[]>> = {};
    for (const rede of listaRedes) {
      const ids = [...escolhidas].filter((id) => contas.find((c) => c.id === id)?.rede === rede);
      let deuCerto = false;
      // O tempo passou e a agenda pode ter mudado desde a marcação: só vale o que ainda é horário bom e livre.
      const validos = new Set(horariosDoDia(rede, diaMelhores, ocupados[rede]).filter((x) => !x.ocupado).map((x) => x.quando.toISOString()));
      for (const iso of marcados[rede] ?? []) {
        if (!validos.has(iso)) {
          falhas.push(`${MAPA[rede].rotulo} ${dataCurta(new Date(iso))}: esse horário não está mais disponível`);
          continue;
        }
        try {
          await criar(ids, "agendar", iso, [rede]);
          feitos.push(`${MAPA[rede].rotulo} ${dataCurta(new Date(iso))}`);
          deuCerto = true;
        } catch (e) {
          falhas.push(`${MAPA[rede].rotulo} ${dataCurta(new Date(iso))}: ${(e as Error).message}`);
          (restantes[rede] ??= []).push(iso);
        }
      }
      if (deuCerto && !restantes[rede]) ids.forEach((id) => agendadas.add(id));
    }
    setTrabalhando(false);
    setMsg({ tipo: falhas.length && !feitos.length ? "erro" : "ok", texto: `${feitos.length ? `Agendado: ${feitos.join(" · ")}.` : ""}${falhas.length ? ` Não agendou: ${falhas.join(" · ")}.` : ""}` });
    if (feitos.length && !falhas.length) {
      limpar();
      setMarcados({});
    } else if (feitos.length) {
      // Parte falhou: mantém o conteúdo e só os horários que faltam, para corrigir e repetir.
      setMarcados(restantes);
      setEscolhidas((s) => new Set([...s].filter((id) => !agendadas.has(id))));
    }
    await carregar();
  }

  // Uma postagem por rede, cada uma no próximo melhor horário dela (pula horário já ocupado).
  async function agendarNosMelhores() {
    setMsg(null);
    if (bloqueioTikTok) {
      setMsg({ tipo: "erro", texto: bloqueioTikTok });
      return;
    }
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
    gerarComIa(redesP, { descricao: p.legenda.slice(0, 600), legenda: p.legenda, tipo: p.tipo, contaIds: p.contaIds });
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

  // TikTok: o que a conta permite (com mais de uma conta, vale o que todas permitem).
  const temTikTok = redesEscolhidas.has("tiktok");
  const infosTikTok = contasTikTok.map((id) => criadores[id]?.info).filter(Boolean) as CriadorTikTok[];
  const errosTikTok = contasTikTok.flatMap((id) => (criadores[id]?.erro ? [`@${contas.find((c) => c.id === id)?.username ?? "conta"}: ${criadores[id]!.erro}`] : []));
  const ttCarregando = temTikTok && (leituraTikTok !== `${chaveTikTok}|${versao}` || contasTikTok.some((id) => !criadores[id]));
  const ttPrivacidades = infosTikTok.length ? Object.keys(TT_PRIVACIDADE).filter((p) => infosTikTok.every((i) => i.privacidades.includes(p as never))) : [];
  const ttSemComentario = infosTikTok.some((i) => i.comentarioDesligado);
  const ttSemDueto = infosTikTok.some((i) => i.duetoDesligado);
  const ttSemStitch = infosTikTok.some((i) => i.stitchDesligado);
  const ttMaxSeg = Math.min(...infosTikTok.map((i) => i.maxSegundos ?? Infinity));
  const ttAuditado = infosTikTok.length > 0 && infosTikTok.every((i) => i.auditado);
  const ttFotos = tipoAtual === "imagem" || tipoAtual === "carrossel";
  const duracaoVideo = tipoAtual === "video" && midias[0] ? duracoes[midias[0].url] : undefined;
  const bloqueioTikTok = !temTikTok
    ? null
    : ttCarregando
      ? "TikTok: lendo os dados da conta…"
      : errosTikTok.length
        ? `O TikTok não deixa postar agora (${errosTikTok.join(" · ")}). Tente mais tarde.`
        : !opc.ttPriv
          ? "TikTok: escolha quem pode ver o post."
          : !ttPrivacidades.includes(opc.ttPriv)
            ? "TikTok: esta privacidade não está liberada para a conta. Escolha outra."
            : tt.divulgar && !tt.marcaPropria && !tt.conteudoDeMarca
              ? "TikTok: marque Sua marca, Conteúdo de marca ou os dois (ou desligue a divulgação)."
              : tt.divulgar && tt.conteudoDeMarca && opc.ttPriv === "SELF_ONLY"
                ? "TikTok: conteúdo de marca não pode ser Só eu."
                : tipoAtual === "video" && !(duracaoVideo !== undefined && Number.isFinite(duracaoVideo))
                  ? duracaoVideo === undefined
                    ? "TikTok: lendo a duração do vídeo…"
                    : "TikTok: não consegui ler a duração do vídeo. Envie o arquivo de novo."
                : duracaoVideo !== undefined && Number.isFinite(ttMaxSeg) && duracaoVideo > ttMaxSeg
                  ? `TikTok: o vídeo tem ${Math.ceil(duracaoVideo)} s e esta conta aceita até ${ttMaxSeg} s.`
                  : !tt.consentimento
                    ? "TikTok: confirme que concorda e autoriza o envio."
                    : null;

  const temTexto = legenda.trim() || listaRedes.some((r) => textos[r]?.legenda?.trim());
  const podeSalvar = escolhidas.size > 0 && (temTexto || midias.length > 0) && !enviando && !trabalhando && !gerando;
  // Publicar e agendar no TikTok só com tudo escolhido; rascunho pode ser salvo antes.
  const podeEnviar = podeSalvar && !bloqueioTikTok;
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
              {temTikTok && (
                <div className="space-y-3 rounded-xl border border-[#e3e5ea] bg-[#fafafa] p-3 lg:col-span-3" data-bloco="tiktok">
                  <p className="text-xs font-semibold text-[#1b1f2b]">TikTok</p>

                  {/* Conta que vai receber o post (lida agora do TikTok) */}
                  <div className="flex flex-wrap gap-2">
                    {contasTikTok.map((id) => {
                      const st = criadores[id];
                      const c = contas.find((x) => x.id === id);
                      return (
                        <div key={id} className="flex items-center gap-2 rounded-full border border-[#e3e5ea] bg-white py-1 pl-1 pr-3">
                          {st?.info?.fotoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={st.info.fotoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                          ) : (
                            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-[10px] font-bold text-white">TT</span>
                          )}
                          <span className="text-xs text-[#1b1f2b]">
                            Vai postar em <b>{st?.info?.apelido ?? c?.nome ?? c?.username}</b>
                            {(st?.info?.usuario ?? c?.username) && <span className="text-[#8a8f9c]"> @{st?.info?.usuario ?? c?.username}</span>}
                          </span>
                          {ttCarregando && <span className="text-[11px] text-[#8a8f9c]">lendo…</span>}
                        </div>
                      );
                    })}
                  </div>
                  {errosTikTok.length > 0 && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">O TikTok não deixa postar agora: {errosTikTok.join(" · ")}. Tente mais tarde.</p>
                  )}

                  <div className="grid gap-3 lg:grid-cols-2">
                    {/* Privacidade: só as opções da conta, sem nenhuma pré-escolhida */}
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-[#5a5f6d]">Quem pode ver</p>
                      <select value={opc.ttPriv} onChange={(e) => setOpc({ ...opc, ttPriv: e.target.value })} className={campo} disabled={!infosTikTok.length}>
                        <option value="" disabled>
                          Escolha…
                        </option>
                        {ttPrivacidades.map((p) => {
                          const travada = p === "SELF_ONLY" && tt.divulgar && tt.conteudoDeMarca;
                          return (
                            <option key={p} value={p} disabled={travada} title={travada ? "Conteúdo de marca não pode ser privado." : undefined}>
                              {TT_PRIVACIDADE[p]}
                              {travada ? " (não vale para conteúdo de marca)" : ""}
                            </option>
                          );
                        })}
                      </select>
                      {infosTikTok.length > 0 && !ttAuditado && (
                        <p className="text-[11px] text-[#a1a5b0]">Até a TikTok aprovar o app, só “Só eu” funciona.</p>
                      )}
                      {Number.isFinite(ttMaxSeg) && tipoAtual === "video" && (
                        <p className={`text-[11px] ${duracaoVideo !== undefined && duracaoVideo > ttMaxSeg ? "text-red-600" : "text-[#a1a5b0]"}`}>
                          Vídeo de até {ttMaxSeg} s nesta conta{duracaoVideo !== undefined ? ` (o seu tem ${Math.ceil(duracaoVideo)} s)` : ""}.
                        </p>
                      )}
                    </div>

                    {/* Interações: desmarcadas; o que a conta desligou fica cinza */}
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-[#5a5f6d]">Permitir</p>
                      {(
                        [
                          ["comentarios", "Comentários", ttSemComentario],
                          ...(ttFotos ? [] : [["dueto", "Dueto", ttSemDueto], ["stitch", "Stitch", ttSemStitch]]),
                        ] as [keyof OpcoesTikTok, string, boolean][]
                      ).map(([k, rotulo, desligado]) => (
                        <label key={k} className={`flex items-center gap-2 text-xs ${desligado ? "text-[#c5c8d4]" : "text-[#1b1f2b]"}`} title={desligado ? "Desligado nas configurações do app do TikTok" : undefined}>
                          <input type="checkbox" disabled={desligado} checked={!desligado && tt[k]} onChange={(e) => setTt({ ...tt, [k]: e.target.checked })} />
                          {rotulo}
                          {desligado && <span className="text-[10px]">(desligado no app do TikTok)</span>}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Divulgação de conteúdo comercial */}
                  <div className="space-y-2 rounded-lg border border-[#e3e5ea] bg-white p-3" title="Diga se o conteúdo promove você, um terceiro ou os dois.">
                    <label className="flex items-center justify-between gap-2 text-xs font-medium text-[#1b1f2b]">
                      <span>
                        Divulgar conteúdo comercial
                        <span className="block text-[11px] font-normal text-[#8a8f9c]">Diga se o conteúdo promove você, um terceiro ou os dois.</span>
                      </span>
                      <input
                        type="checkbox"
                        role="switch"
                        checked={tt.divulgar}
                        onChange={(e) => setTt({ ...tt, divulgar: e.target.checked, consentimento: false, ...(e.target.checked ? {} : { marcaPropria: false, conteudoDeMarca: false }) })}
                      />
                    </label>
                    {tt.divulgar && (
                      <div className="space-y-2">
                        <label className="flex items-start gap-2 text-xs text-[#1b1f2b]">
                          <input type="checkbox" checked={tt.marcaPropria} onChange={(e) => setTt({ ...tt, marcaPropria: e.target.checked })} />
                          <span>
                            <b>Sua marca</b>
                            <span className="block text-[11px] text-[#8a8f9c]">Você está promovendo você mesmo ou o seu negócio.</span>
                          </span>
                        </label>
                        <label
                          className={`flex items-start gap-2 text-xs ${opc.ttPriv === "SELF_ONLY" ? "text-[#c5c8d4]" : "text-[#1b1f2b]"}`}
                          title={opc.ttPriv === "SELF_ONLY" ? "Conteúdo de marca não pode ser privado. Mude quem pode ver." : undefined}
                        >
                          <input
                            type="checkbox"
                            disabled={opc.ttPriv === "SELF_ONLY"}
                            checked={tt.conteudoDeMarca}
                            onChange={(e) => setTt({ ...tt, conteudoDeMarca: e.target.checked, consentimento: false })}
                          />
                          <span>
                            <b>Conteúdo de marca</b>
                            <span className="block text-[11px] text-[#8a8f9c]">
                              {opc.ttPriv === "SELF_ONLY" ? "Não vale para “Só eu”: conteúdo de marca não pode ser privado." : "Você está promovendo outra marca ou um terceiro."}
                            </span>
                          </span>
                        </label>
                        {(tt.marcaPropria || tt.conteudoDeMarca) && (
                          <p className="rounded-md bg-[#f4f5f8] px-2 py-1.5 text-[11px] text-[#1b1f2b]">
                            Seu {ttFotos ? "post de fotos" : "vídeo"} será identificado como “{tt.conteudoDeMarca ? "Parceria paga" : "Conteúdo promocional"}”.
                          </p>
                        )}
                        {!tt.marcaPropria && !tt.conteudoDeMarca && <p className="text-[11px] text-red-600">Marque pelo menos uma opção.</p>}
                      </div>
                    )}
                  </div>

                  {/* Declaração e consentimento antes de postar */}
                  <div className="space-y-2 text-xs text-[#1b1f2b]">
                    <p>
                      Ao postar, você concorda com{" "}
                      {tt.divulgar && tt.conteudoDeMarca ? (
                        <>
                          a{" "}
                          <a href={LINK_MARCA} target="_blank" rel="noreferrer" className="text-[#6366f1] underline">
                            Política de Conteúdo de Marca
                          </a>{" "}
                          e a{" "}
                        </>
                      ) : (
                        "a "
                      )}
                      <a href={LINK_MUSICA} target="_blank" rel="noreferrer" className="text-[#6366f1] underline">
                        Confirmação de Uso de Música
                      </a>{" "}
                      do TikTok.
                    </p>
                    <label className="flex items-start gap-2">
                      <input type="checkbox" checked={tt.consentimento} onChange={(e) => setTt({ ...tt, consentimento: e.target.checked })} />
                      <span>Concordo e autorizo enviar este conteúdo ao TikTok.</span>
                    </label>
                    <p className="text-[11px] text-[#8a8f9c]">Depois de postar, o TikTok pode levar alguns minutos para mostrar o post no perfil. Acompanhe em Postagens recentes.</p>
                  </div>
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
            {listaRedes.length > 0 && (
              <div className="mt-4 border-t border-[#eef0f4] pt-3">
                <p className="text-sm font-semibold text-[#1b1f2b]">Melhores horários</p>
                <p className="mb-2 text-[11px] text-[#a1a5b0]">Os horários de maior alcance e engajamento de cada rede. Toque nos que quiser, ou sorteie um por rede.</p>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <input type="date" value={diaMelhores} onChange={(e) => { setDiaMelhores(e.target.value); setMarcados({}); }} className={`${campo} max-w-[10rem]`} />
                  <button type="button" onClick={() => { setDiaMelhores(hojeEmBrasilia()); setMarcados({}); }} className="rounded-full bg-[#eef0f4] px-3 py-1.5 text-xs font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]">Hoje</button>
                  <button type="button" onClick={sortearHorarios} className="rounded-full bg-[#eef0f4] px-3 py-1.5 text-xs font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]">🎲 Sortear um por rede</button>
                  {totalMarcados > 0 && <button type="button" onClick={() => setMarcados({})} className="text-xs text-[#8a8f9c] hover:text-[#1b1f2b]">Limpar</button>}
                </div>
                <div className="space-y-2">
                  {melhoresDoDia.map(({ rede, slots }) => (
                    <div key={rede} className="flex flex-wrap items-center gap-2">
                      <span className="w-24 shrink-0 text-xs font-medium text-[#1b1f2b]">{MAPA[rede].rotulo}</span>
                      {slots.length === 0 && <span className="text-xs text-[#a1a5b0]">Sem horário bom livre nesse dia</span>}
                      {slots.map((x) => {
                        const iso = x.quando.toISOString();
                        const on = marcados[rede]?.includes(iso) ?? false;
                        return (
                          <button
                            key={iso}
                            type="button"
                            disabled={x.ocupado}
                            onClick={() => alternarHorario(rede, iso)}
                            title={x.ocupado ? "Já tem postagem agendada perto desse horário" : x.formato}
                            className={`rounded-full border px-3 py-1 text-xs ${x.ocupado ? "cursor-not-allowed border-[#eef0f4] text-[#c4c7cf] line-through" : on ? "border-[#0f8f74] bg-[#0f8f74] text-white" : "border-[#d5d8e0] text-[#1b1f2b] hover:border-[#0f8f74]"}`}
                          >
                            {x.hora} <span className="opacity-70">· {x.formato}</span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <p className="mt-1 text-[11px] text-[#a1a5b0]">
              Deixe vazio para publicar agora. O horário é o de Brasília. Ou use <b>Cada rede no melhor horário</b>: o painel cria uma postagem por rede, cada uma no próximo horário bom dela.
            </p>
          </div>

          {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
          {bloqueioTikTok && escolhidas.size > 0 && <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{bloqueioTikTok}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => enviar("publicar")} disabled={!podeEnviar} className="rounded-xl bg-[#6366f1] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-40">
              {trabalhando ? "Enviando…" : "Publicar agora em todas"}
            </button>
            <button onClick={agendarMarcados} disabled={!podeEnviar || totalMarcados === 0} className="rounded-xl bg-[#0f8f74] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0b7360] disabled:opacity-40">
              {totalMarcados > 0 ? `Agendar nos ${totalMarcados} horário${totalMarcados > 1 ? "s" : ""} marcado${totalMarcados > 1 ? "s" : ""}` : "Agendar nos horários marcados"}
            </button>
            <button onClick={agendarNosMelhores} disabled={!podeEnviar} className="rounded-xl bg-[#0f8f74] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#0b7360] disabled:opacity-40">
              Cada rede no melhor horário
            </button>
            <button onClick={() => enviar("agendar")} disabled={!podeEnviar || !quando} className="rounded-xl bg-[#1b1f2b] px-5 py-2.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40">
              Agendar no horário escolhido
            </button>
            <button onClick={() => enviar("rascunho")} disabled={!podeSalvar}className="rounded-xl bg-[#eef0f4] px-5 py-2.5 text-sm font-medium text-[#1b1f2b] hover:bg-[#e3e5ea] disabled:opacity-40">
              Salvar rascunho
            </button>
          </div>
        </div>

        {/* Prévia e, embaixo, o mapa de publicação das redes escolhidas */}
        <div className="flex flex-col items-center gap-4">
          <div className="w-[280px] self-center rounded-[2rem] border border-[#e3e5ea] bg-[#fafafa] p-3 shadow-sm">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                {abaAtual === "tiktok" && infosTikTok[0]?.fotoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={infosTikTok[0].fotoUrl} alt="" className="h-7 w-7 rounded-full object-cover" />
                ) : (
                  <span className="h-7 w-7 rounded-full bg-[#e3e5ea]" />
                )}
                <span className="text-xs font-semibold text-[#1b1f2b]">
                  {abaAtual === "tiktok" && infosTikTok[0] ? `TikTok · ${infosTikTok[0].apelido ?? infosTikTok[0].usuario}` : abaAtual ? `${MAPA[abaAtual].rotulo} · bff` : "sua_loja"}
                </span>
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
        <SocialReaproveitar contas={contas} redes={redes} ocupados={ocupados} opcoes={opcAuto} versao={versao} bloqueado={gerando || trabalhando} onPreparar={preparar} onAgendado={carregar} />
      </div>

      {/* Histórico */}
      <div className="mt-8">
        <p className="mb-2 text-sm font-semibold text-[#1b1f2b]">Postagens recentes</p>
        {posts === null && <p className="text-xs text-[#8a8f9c]">Carregando…</p>}
        {posts && posts.length === 0 && <p className="rounded-xl border border-dashed border-[#d5d8e0] p-4 text-center text-xs text-[#8a8f9c]">Nenhuma postagem ainda.</p>}
        <div className="grid gap-2 xl:grid-cols-2">
          {(posts ?? []).map((p) => (
            <div key={p.id} className="min-w-0 rounded-xl border border-[#e3e5ea] p-3">
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
