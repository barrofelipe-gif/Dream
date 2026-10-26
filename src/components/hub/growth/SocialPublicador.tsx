"use client";

import { upload } from "@vercel/blob/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
const campo =
  "w-full rounded-xl border border-[#e3e5ea] px-3 py-2.5 text-sm text-[#1b1f2b] outline-none focus:border-[#6366f1] focus:ring-2 focus:ring-[#6366f1]/15";

const fmt = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso)) : "—";

export default function SocialPublicador() {
  const [redes, setRedes] = useState<InfoRede[]>([]);
  const [contas, setContas] = useState<Conta[]>([]);
  const [escolhidas, setEscolhidas] = useState<Set<string>>(new Set());
  const [legenda, setLegenda] = useState("");
  const [midias, setMidias] = useState<Midia[]>([]);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [quando, setQuando] = useState("");
  const [trabalhando, setTrabalhando] = useState(false);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);
  const [posts, setPosts] = useState<Post[] | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const [opc, setOpc] = useState({ ytTitulo: "", ytPriv: "private", ttPriv: "SELF_ONLY", pinBoard: "", pinTitulo: "", pinLink: "" });
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
  const contaPinterest = [...escolhidas].map((id) => contas.find((c) => c.id === id)).find((c) => c?.rede === "pinterest")?.id;
  useEffect(() => {
    if (!contaPinterest) {
      setBoards([]);
      return;
    }
    fetch(`/api/social/pinterest/boards?contaId=${contaPinterest}`)
      .then((r) => (r.ok ? r.json() : { boards: [] }))
      .then((j) => setBoards(j.boards ?? []))
      .catch(() => setBoards([]));
  }, [contaPinterest]);

  const limiteLegenda = useMemo(() => {
    const lims = [...escolhidas].map((id) => contas.find((c) => c.id === id)?.rede).filter(Boolean) as Rede[];
    const menores = lims.map((r) => redes.find((x) => x.rede === r)?.limites.legendaMax ?? 2200);
    return menores.length ? Math.min(...menores) : 2200;
  }, [escolhidas, contas, redes]);

  function alternar(id: string) {
    setEscolhidas((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const todasDisponiveis = contas.filter((c) => redes.find((r) => r.rede === c.rede)?.disponivel).map((c) => c.id);

  async function subir(files: FileList | null) {
    if (!files?.length) return;
    setMsg(null);
    for (const f of Array.from(files)) {
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

  async function enviar(acao: "publicar" | "agendar" | "rascunho") {
    setMsg(null);
    if (acao === "agendar" && !quando) {
      setMsg({ tipo: "erro", texto: "Escolha a data e a hora do agendamento." });
      return;
    }
    setTrabalhando(true);
    const r = await fetch("/api/social/posts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        legenda,
        midias,
        contaIds: [...escolhidas],
        acao,
        agendadoPara: acao === "agendar" ? new Date(quando).toISOString() : null,
        porRede: {
          ...(redesEscolhidas.has("youtube") ? { youtube: { titulo: opc.ytTitulo, opcoes: { privacyStatus: opc.ytPriv } } } : {}),
          ...(redesEscolhidas.has("tiktok") ? { tiktok: { opcoes: { privacidade: opc.ttPriv } } } : {}),
          ...(redesEscolhidas.has("pinterest")
            ? { pinterest: { titulo: opc.pinTitulo, opcoes: { boardId: opc.pinBoard, titulo: opc.pinTitulo, link: opc.pinLink } } }
            : {}),
        },
      }),
    });
    setTrabalhando(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      setMsg({ tipo: "erro", texto: j.error ?? "Não foi possível enviar." });
      return;
    }
    setMsg({
      tipo: j.status === "ERRO" ? "erro" : "ok",
      texto:
        acao === "publicar"
          ? j.status === "PUBLICADO"
            ? "Publicado em todas as redes escolhidas."
            : j.status === "PARCIAL"
              ? "Publicado em parte das redes. Veja abaixo o que falhou."
              : "Não saiu em nenhuma rede. Veja abaixo o motivo."
          : acao === "agendar"
            ? "Agendado."
            : "Rascunho salvo.",
    });
    if (acao !== "rascunho" && j.status !== "ERRO") {
      setLegenda("");
      setMidias([]);
      setQuando("");
    }
    await carregar();
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

  const podeEnviar = escolhidas.size > 0 && (legenda.trim() || midias.length > 0) && !enviando && !trabalhando;

  return (
    <section className="rounded-2xl border border-[#e3e5ea] bg-white p-5 shadow-sm">
      <div className="mb-4">
        <p className="text-base font-semibold text-[#1b1f2b]">Publicador: postar em todas as redes</p>
        <p className="text-xs text-[#8a8f9c]">Escolha onde postar, suba a foto ou o vídeo uma vez e publique agora ou agende.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-5">
          {/* Redes e contas */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#1b1f2b]">Onde postar</p>
              <button onClick={() => setEscolhidas(new Set(escolhidas.size === todasDisponiveis.length ? [] : todasDisponiveis))} className="text-xs text-[#6366f1] hover:underline">
                {escolhidas.size === todasDisponiveis.length && todasDisponiveis.length > 0 ? "Limpar" : "Selecionar todas"}
              </button>
            </div>
            <div className="space-y-2">
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
                            disabled={!r.disponivel}
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
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                subir(e.dataTransfer.files);
              }}
              className="rounded-xl border-2 border-dashed border-[#d5d8e0] p-4 text-center"
            >
              <input ref={arquivo} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime" onChange={(e) => subir(e.target.files)} className="hidden" />
              <button onClick={() => arquivo.current?.click()} className="rounded-lg bg-[#eef0f4] px-4 py-2 text-sm font-medium text-[#1b1f2b] hover:bg-[#e3e5ea]">
                Escolher arquivos
              </button>
              <p className="mt-2 text-[11px] text-[#a1a5b0]">ou arraste aqui. Fotos JPG/PNG e vídeos MP4 ou MOV. Mais de um arquivo vira carrossel.</p>
              {enviando && <p className="mt-2 text-xs text-[#6366f1]">Enviando {enviando}…</p>}
            </div>
            {midias.length > 0 && (
              <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
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

          {/* Texto */}
          <div>
            <div className="mb-1 flex items-center justify-between">
              <p className="text-sm font-semibold text-[#1b1f2b]">Legenda</p>
              <span className={`text-[11px] ${legenda.length > limiteLegenda ? "text-red-600" : "text-[#a1a5b0]"}`}>
                {legenda.length}/{limiteLegenda}
              </span>
            </div>
            <textarea value={legenda} onChange={(e) => setLegenda(e.target.value)} rows={5} className={campo} placeholder="Escreva o texto da postagem (vale para todas as redes escolhidas)" />
          </div>

          {/* Ajustes por rede */}
          {(redesEscolhidas.has("youtube") || redesEscolhidas.has("tiktok") || redesEscolhidas.has("pinterest")) && (
            <div className="space-y-4 rounded-xl border border-[#e3e5ea] p-4">
              <p className="text-sm font-semibold text-[#1b1f2b]">Ajustes por rede</p>
              {redesEscolhidas.has("youtube") && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[#5a5f6d]">YouTube</p>
                  <input value={opc.ytTitulo} maxLength={100} onChange={(e) => setOpc({ ...opc, ytTitulo: e.target.value })} placeholder="Título do vídeo (até 100 caracteres)" className={campo} />
                  <select value={opc.ytPriv} onChange={(e) => setOpc({ ...opc, ytPriv: e.target.value })} className={campo}>
                    <option value="private">Privado (recomendado até a API ser auditada)</option>
                    <option value="unlisted">Não listado</option>
                    <option value="public">Público</option>
                  </select>
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
                  <input value={opc.pinTitulo} maxLength={100} onChange={(e) => setOpc({ ...opc, pinTitulo: e.target.value })} placeholder="Título do pin" className={campo} />
                  <input value={opc.pinLink} onChange={(e) => setOpc({ ...opc, pinLink: e.target.value })} placeholder="Link de destino (ex: o link do app)" className={campo} />
                </div>
              )}
            </div>
          )}

          {/* Quando */}
          <div className="rounded-xl border border-[#e3e5ea] p-4">
            <p className="mb-2 text-sm font-semibold text-[#1b1f2b]">Quando</p>
            <input type="datetime-local" value={quando} onChange={(e) => setQuando(e.target.value)} className={`${campo} max-w-xs`} />
            <p className="mt-1 text-[11px] text-[#a1a5b0]">Deixe vazio para publicar agora. O horário é o de Brasília.</p>
          </div>

          {msg && <p className={`rounded-lg px-3 py-2 text-xs ${msg.tipo === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>{msg.texto}</p>}
          <div className="flex flex-wrap gap-2">
            <button onClick={() => enviar("publicar")} disabled={!podeEnviar} className="rounded-xl bg-[#6366f1] px-6 py-2.5 text-sm font-semibold text-white hover:bg-[#4f52d9] disabled:opacity-40">
              {trabalhando ? "Publicando…" : "Publicar agora"}
            </button>
            <button onClick={() => enviar("agendar")} disabled={!podeEnviar || !quando} className="rounded-xl bg-[#1b1f2b] px-5 py-2.5 text-sm font-medium text-white hover:bg-black disabled:opacity-40">
              Agendar
            </button>
            <button onClick={() => enviar("rascunho")} disabled={!podeEnviar} className="rounded-xl bg-[#eef0f4] px-5 py-2.5 text-sm font-medium text-[#1b1f2b] hover:bg-[#e3e5ea] disabled:opacity-40">
              Salvar rascunho
            </button>
          </div>
        </div>

        {/* Prévia */}
        <div className="flex justify-center">
          <div className="w-[280px] self-start rounded-[2rem] border border-[#e3e5ea] bg-[#fafafa] p-3 shadow-sm">
            <div className="rounded-xl bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-7 w-7 rounded-full bg-[#e3e5ea]" />
                <span className="text-xs font-semibold text-[#1b1f2b]">sua_loja</span>
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
              <p className="whitespace-pre-wrap text-[12px] leading-snug text-[#1b1f2b]">{legenda || "A legenda aparece aqui."}</p>
              {midias.length > 1 && <p className="mt-2 text-[10px] text-[#8a8f9c]">Carrossel com {midias.length} itens</p>}
            </div>
            <p className="mt-2 text-center text-[10px] text-[#a1a5b0]">{escolhidas.size} conta{escolhidas.size === 1 ? "" : "s"} escolhida{escolhidas.size === 1 ? "" : "s"}</p>
          </div>
        </div>
      </div>

      {/* Histórico */}
      <div className="mt-8">
        <p className="mb-2 text-sm font-semibold text-[#1b1f2b]">Postagens recentes</p>
        {posts === null && <p className="text-xs text-[#8a8f9c]">Carregando…</p>}
        {posts && posts.length === 0 && <p className="rounded-xl border border-dashed border-[#d5d8e0] p-4 text-center text-xs text-[#8a8f9c]">Nenhuma postagem ainda.</p>}
        <div className="space-y-2">
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
