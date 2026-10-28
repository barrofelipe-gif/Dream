"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useEstreito, useTelaCheiaCelular } from "@/components/hub/growth/useTelaCheiaCelular";

type StatusPagina = {
  contaId: string;
  loja: string;
  nome: string | null;
  paginaId: string;
  escopos: string[] | null;
  faltam: string[];
  assinada: boolean | null;
  leConversas: boolean;
  erroConversas: string | null;
  roboAtivo: boolean;
  passos: string[];
};
type Resumo = {
  id: string;
  status: string;
  naoLida: boolean;
  nome: string | null;
  fotoUrl: string | null;
  cliente: string;
  loja: string;
  pagina: string;
  ultimaEm: string;
  ultima: { de: string; texto: string } | null;
};
type Conversa = {
  id: string;
  status: string;
  nome: string | null;
  fotoUrl: string | null;
  cliente: string;
  loja: string;
  janela: "livre" | "atendente" | "fechada";
  mensagens: { id: string; de: string; texto: string; em: string }[];
};

const STATUS: Record<string, { rotulo: string; cor: string }> = {
  BOT: { rotulo: "Robô", cor: "bg-emerald-50 text-emerald-700" },
  NEEDS_HUMAN: { rotulo: "Aguardando atendente", cor: "bg-amber-50 text-amber-700" },
  HUMAN: { rotulo: "Atendente", cor: "bg-sky-50 text-sky-700" },
  CLOSED: { rotulo: "Encerrada", cor: "bg-zinc-100 text-zinc-600" },
};
const LOJAS = [
  { id: "bff", rotulo: "BFF" },
  { id: "moranga", rotulo: "Moranga" },
];

const hora = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const j = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
  return j;
}

/** Messenger (Página do Facebook) da BFF ou da Moranga: diagnóstico, conversas, resposta da equipe e robô opcional. */
export default function MessengerInbox() {
  const [loja, setLoja] = useState("bff");
  const [paginas, setPaginas] = useState<StatusPagina[] | null>(null);
  const [conversas, setConversas] = useState<Resumo[]>([]);
  const [aberta, setAberta] = useState<Conversa | null>(null);
  const [texto, setTexto] = useState("");
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  // Loja e conversa selecionadas "agora": resposta que chega atrasada de outra seleção é descartada.
  const lojaAtual = useRef(loja);
  const abertaAtual = useRef<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([
        chamar<{ paginas: StatusPagina[] }>(`/api/messenger/status?loja=${loja}`),
        chamar<{ conversas: Resumo[] }>(`/api/messenger/conversas?loja=${loja}`),
      ]);
      setPaginas(s.paginas);
      setConversas(c.conversas);
    } catch (e) {
      setAviso((e as Error).message);
    }
  }, [loja]);

  // Ao abrir (e ao trocar de loja) confere a Página; a lista de conversas se atualiza a cada 15 s (mensagens do webhook).
  useEffect(() => {
    const inicio = setTimeout(() => void carregar(), 0);
    const lista = setInterval(() => {
      chamar<{ conversas: Resumo[] }>(`/api/messenger/conversas?loja=${loja}`)
        .then((c) => lojaAtual.current === loja && setConversas(c.conversas))
        .catch(() => {});
      // A conversa aberta também se atualiza (mensagem nova do cliente, status, janela).
      const id = abertaAtual.current;
      if (id)
        chamar<Conversa>(`/api/messenger/conversas/${id}`)
          .then((c) => abertaAtual.current === id && lojaAtual.current === loja && c.loja === loja && setAberta(c))
          .catch(() => {});
    }, 15_000);
    return () => {
      clearTimeout(inicio);
      clearInterval(lista);
    };
  }, [carregar, loja]);

  // Celular: a conversa aberta cobre a tela inteira; Voltar fecha e a lista continua onde estava.
  const fechar = useCallback(() => {
    abertaAtual.current = null;
    setAberta(null);
  }, []);
  const estreita = useEstreito(768); // abaixo do md
  const estiloTela = useTelaCheiaCelular(!!aberta && estreita, fechar);

  async function abrir(id: string) {
    if (abertaAtual.current !== id) setTexto("");
    abertaAtual.current = id;
    const pedidaNa = lojaAtual.current;
    try {
      const c = await chamar<Conversa>(`/api/messenger/conversas/${id}`);
      if (abertaAtual.current !== id || lojaAtual.current !== pedidaNa || c.loja !== pedidaNa) return;
      setAberta(c);
      setConversas((cs) => cs.map((c) => (c.id === id ? { ...c, naoLida: false } : c)));
    } catch (e) {
      setAviso((e as Error).message);
    }
  }

  async function acao(nome: string, fn: () => Promise<unknown>, ok?: string) {
    setOcupado(nome);
    setAviso(null);
    try {
      await fn();
      if (ok) setAviso(ok);
      await carregar();
    } catch (e) {
      setAviso((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const sincronizar = () =>
    acao("sinc", async () => {
      const r = await chamar<{ resultado: { pagina: string | null; conversas?: number; novas?: number; erro?: string }[] }>("/api/messenger/sincronizar", {
        method: "POST",
        body: JSON.stringify({ loja }),
      });
      setAviso(r.resultado.map((x) => (x.erro ? `${x.pagina}: ${x.erro}` : `${x.pagina}: ${x.conversas} conversas, ${x.novas} mensagens novas`)).join(" · ") || "Nenhuma Página desta loja.");
    });

  async function enviar() {
    if (!aberta || !texto.trim()) return;
    const id = aberta.id;
    await acao("enviar", async () => {
      await chamar(`/api/messenger/conversas/${id}/responder`, { method: "POST", body: JSON.stringify({ texto }) });
      setTexto("");
      await abrir(id);
    });
  }

  const mudarStatus = (status: string) =>
    aberta &&
    acao("status", async () => {
      await chamar(`/api/messenger/conversas/${aberta.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      await abrir(aberta.id);
    });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {LOJAS.map((l) => (
          <button
            key={l.id}
            onClick={() => {
              if (l.id === loja) return;
              lojaAtual.current = l.id;
              abertaAtual.current = null;
              setPaginas(null);
              setAberta(null);
              setConversas([]);
              setTexto("");
              setLoja(l.id);
            }}
            className={`rounded-full px-3 py-1 text-sm ${loja === l.id ? "bg-[#1b1f2b] text-white" : "border border-[#e3e5ea] text-[#5a5f6d]"}`}
          >
            {l.rotulo}
          </button>
        ))}
        <button onClick={sincronizar} disabled={!!ocupado} className="ml-auto rounded-lg border border-[#e3e5ea] px-3 py-1 text-sm text-[#5a5f6d] hover:border-[#6366f1] disabled:opacity-50">
          {ocupado === "sinc" ? "Puxando…" : "Puxar mensagens do Facebook"}
        </button>
      </div>

      {aviso && <div className="rounded-xl border border-[#e3e5ea] bg-[#f9fafb] p-3 text-xs text-[#5a5f6d]">{aviso}</div>}

      {/* Situação de cada Página: o que já funciona e o que falta fazer. */}
      <section className="space-y-2">
        {paginas === null && <div className="text-xs text-[#8a8f9c]">Conferindo a Página…</div>}
        {paginas?.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#d5d8e0] p-3 text-sm text-[#5a5f6d]">
            Nenhuma Página do Facebook desta loja conectada.{" "}
            <a href={`/api/social/facebook/conectar?loja=${loja}`} className="text-[#6366f1] hover:underline">
              Conectar o Facebook
            </a>
          </div>
        )}
        {paginas?.map((p) => {
          const pronta = p.faltam.length === 0 && p.assinada && p.leConversas;
          return (
            <div key={p.contaId} className="rounded-xl border border-[#e3e5ea] p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-[#1b1f2b]">{p.nome ?? "Página"}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${pronta ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  {pronta ? "recebendo mensagens" : "falta configurar"}
                </span>
                <label className="ml-auto flex items-center gap-1 text-xs text-[#5a5f6d]">
                  <input
                    type="checkbox"
                    checked={p.roboAtivo}
                    disabled={!!ocupado}
                    onChange={(e) => {
                      const ativo = e.target.checked;
                      void acao("robo", () => chamar("/api/messenger/status", { method: "POST", body: JSON.stringify({ acao: "robo", contaId: p.contaId, ativo }) }));
                    }}
                  />
                  Robô responde no Messenger
                </label>
              </div>
              <ul className="mt-2 space-y-0.5 text-xs text-[#5a5f6d]">
                <li>
                  Permissões do Messenger:{" "}
                  {p.escopos === null ? "não deu para conferir" : p.faltam.length ? `faltam ${p.faltam.join(", ")}` : "ok"}
                </li>
                <li>Webhook da Página: {p.assinada === null ? "não deu para conferir" : p.assinada ? "ativo" : "desligado"}</li>
                <li>Leitura das conversas: {p.leConversas ? "ok" : p.erroConversas ?? "—"}</li>
              </ul>
              {!pronta && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {p.faltam.length > 0 && (
                    <a href={`/api/social/facebook/conectar?loja=${p.loja}`} className="rounded-lg bg-[#6366f1] px-3 py-1 text-xs text-white">
                      Reconectar o Facebook (dar permissão de mensagens)
                    </a>
                  )}
                  {!p.assinada && p.faltam.length === 0 && (
                    <button
                      disabled={!!ocupado}
                      onClick={() => acao("assinar", () => chamar("/api/messenger/status", { method: "POST", body: JSON.stringify({ acao: "assinar", contaId: p.contaId }) }), "Recebimento ativado.")}
                      className="rounded-lg bg-[#6366f1] px-3 py-1 text-xs text-white disabled:opacity-50"
                    >
                      Ativar recebimento
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
        <details className="rounded-xl border border-[#e3e5ea] p-3 text-xs text-[#5a5f6d]">
          <summary className="cursor-pointer font-medium text-[#1b1f2b]">Regras do Messenger e das outras redes</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Resposta livre (robô ou equipe) até 24h depois da última mensagem do cliente. De 24h a 7 dias só a equipe, e só com a permissão Human Agent aprovada pela Meta. Depois de 7 dias, não dá para responder.</li>
            <li>Mensagens de clientes (quem não é administrador do app) só chegam depois que a Meta aprovar o Acesso Avançado de pages_messaging (App Review, com o portfólio verificado). Até lá, só mensagens de quem tem papel no app.</li>
            <li>A Meta mostra no máximo as 20 mensagens mais recentes de cada conversa antiga; daqui para frente o webhook guarda tudo.</li>
            <li>TikTok: a API de mensagens diretas (Business Messaging API) é separada do app atual e só libera com pedido aprovado pelo TikTok; sem ela não dá para ler nem responder DMs nem criar automação.</li>
            <li>YouTube não tem mensagens diretas na API (só comentários).</li>
          </ul>
        </details>
      </section>

      <div className="grid gap-3 md:grid-cols-[18rem_1fr]">
        <div className="space-y-1 md:max-h-[32rem] md:overflow-y-auto">
          {conversas.length === 0 && <div className="rounded-xl border border-[#e3e5ea] p-3 text-sm text-[#8a8f9c]">Nenhuma conversa do Messenger ainda.</div>}
          {conversas.map((c) => (
            <button
              key={c.id}
              onClick={() => abrir(c.id)}
              className={`block min-h-[44px] w-full rounded-xl border p-2 text-left text-sm ${aberta?.id === c.id ? "border-[#6366f1]" : "border-[#e3e5ea]"}`}
            >
              <div className="flex items-center gap-2">
                {c.naoLida && <span className="h-2 w-2 rounded-full bg-[#6366f1]" />}
                <span className="truncate font-medium text-[#1b1f2b]">{c.nome || `Cliente …${c.cliente}`}</span>
                <span className={`ml-auto shrink-0 rounded-full px-1.5 text-[10px] ${STATUS[c.status]?.cor ?? ""}`}>{STATUS[c.status]?.rotulo ?? c.status}</span>
              </div>
              <div className="mt-0.5 truncate text-xs text-[#8a8f9c]">{c.ultima ? `${c.ultima.de === "cliente" ? "" : "Você: "}${c.ultima.texto}` : "—"}</div>
            </button>
          ))}
        </div>

        <div
          className={`rounded-xl border border-[#e3e5ea] p-3 ${
            aberta
              ? "fixed inset-0 z-50 flex flex-col rounded-none border-0 bg-white pb-[max(12px,env(safe-area-inset-bottom))] md:static md:z-auto md:block md:rounded-xl md:border"
              : "hidden md:block"
          }`}
          style={estiloTela}
        >
          {!aberta ? (
            <div className="text-sm text-[#8a8f9c]">Escolha uma conversa.</div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2 md:h-full">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  onClick={fechar}
                  aria-label="Voltar para a lista"
                  className="-ml-1 flex h-11 min-w-[44px] items-center justify-center rounded-xl text-lg text-[#6366f1] hover:bg-[#f4f5f8] md:hidden"
                >
                  ←
                </button>
                <span className="font-medium text-[#1b1f2b]">{aberta.nome || `Cliente …${aberta.cliente}`}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS[aberta.status]?.cor ?? ""}`}>{STATUS[aberta.status]?.rotulo ?? aberta.status}</span>
                <div className="ml-auto flex gap-1">
                  {aberta.status !== "BOT" && (
                    <button onClick={() => mudarStatus("BOT")} className="min-h-[40px] rounded border border-[#e3e5ea] px-2 py-0.5 text-xs md:min-h-0">Devolver ao robô</button>
                  )}
                  {aberta.status !== "HUMAN" && (
                    <button onClick={() => mudarStatus("HUMAN")} className="min-h-[40px] rounded border border-[#e3e5ea] px-2 py-0.5 text-xs md:min-h-0">Assumir</button>
                  )}
                  {aberta.status !== "CLOSED" && (
                    <button onClick={() => mudarStatus("CLOSED")} className="min-h-[40px] rounded border border-[#e3e5ea] px-2 py-0.5 text-xs md:min-h-0">Encerrar</button>
                  )}
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain md:max-h-[24rem]">
                {aberta.mensagens.map((m) => (
                  <div key={m.id} className={`flex ${m.de === "cliente" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[80%] whitespace-pre-wrap rounded-2xl px-3 py-1.5 text-sm ${m.de === "cliente" ? "bg-[#f1f2f5] text-[#1b1f2b]" : m.de === "robo" ? "bg-emerald-50 text-emerald-900" : "bg-[#6366f1] text-white"}`}>
                      {m.texto}
                      <div className="mt-0.5 text-[10px] opacity-60">
                        {m.de === "robo" ? "robô · " : m.de === "equipe" ? "equipe · " : ""}
                        {hora(m.em)}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {aberta.janela === "fechada" ? (
                <div className="rounded-lg bg-[#f9fafb] p-2 text-xs text-[#8a8f9c]">Passaram mais de 7 dias da última mensagem do cliente: o Messenger não deixa responder.</div>
              ) : (
                <div className="space-y-1">
                  {aberta.janela === "atendente" && (
                    <div className="text-xs text-amber-700">Mais de 24h: o envio usa a etiqueta Human Agent, que só funciona se a Meta tiver aprovado essa permissão.</div>
                  )}
                  <div className="flex gap-2">
                    <textarea
                      value={texto}
                      onChange={(e) => setTexto(e.target.value)}
                      rows={2}
                      maxLength={2000}
                      placeholder="Responder no Messenger…"
                      className="min-w-0 flex-1 rounded-lg border border-[#e3e5ea] p-2 text-base md:text-sm"
                    />
                    <button onClick={enviar} disabled={!!ocupado || !texto.trim()} className="min-h-[44px] shrink-0 rounded-lg bg-[#1b1f2b] px-3 text-sm text-white disabled:opacity-50">
                      {ocupado === "enviar" ? "Enviando…" : "Enviar"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
