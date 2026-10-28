"use client";

import { useState } from "react";

export type DadosInicio = {
  nomeLoja: string;
  contas: { id: string; username: string | null; loja: string; active: boolean }[];
  faltaConectar: ("bff" | "moranga")[];
  totalContatos: number;
  aguardando: number;
  naoLidas: number;
  /** Últimos 7 dias. */
  recebidas: number;
  doRobo: number;
  novosContatos: number;
  chamaramAtendente: number;
  top: { id: string; nome: string | null; username: string | null; fotoUrl: string | null; mensagens: number }[];
  passos: { id: string; titulo: string; feito: boolean; secao: string }[];
  atualizadoEm: string;
};

/** Abre a seção de Fluxos já com a janela de modelos (ou um modelo escolhido). */
export function abrirModelos(modelo = "todos") {
  try {
    window.sessionStorage.setItem("ig-abrir-modelos", modelo);
  } catch {
    /* sem armazenamento: só abre a seção */
  }
  window.location.hash = "fluxos";
}

const MODELOS_INICIO: { titulo: string; secao?: string; modelo?: string; selo?: [string, string] }[] = [
  { titulo: "Diga “Oi” para quem escreve pela primeira vez", secao: "boasvindas", selo: ["NOVO", "bg-[#6d5dfc] text-white"] },
  { titulo: "Enviar links automaticamente por DM a partir dos comentários", secao: "comentarios", selo: ["POPULAR", "bg-[#d9480f] text-white"] },
  { titulo: "Responder quem responde os seus stories", modelo: "story" },
];

function Foto({ p, tamanho }: { p: DadosInicio["top"][number]; tamanho: number }) {
  const [falhou, setFalhou] = useState(false);
  const inicial = (p.nome || p.username || "?").replace("@", "").slice(0, 1).toUpperCase();
  return p.fotoUrl && !falhou ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={p.fotoUrl}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFalhou(true)}
      title={p.nome || (p.username ? `@${p.username}` : "")}
      className="rounded-full object-cover ring-2 ring-white"
      style={{ width: tamanho, height: tamanho }}
    />
  ) : (
    <span
      title={p.nome || (p.username ? `@${p.username}` : "")}
      className="flex items-center justify-center rounded-full bg-gradient-to-br from-[#c7d2fe] to-[#fbcfe8] text-xs font-semibold text-[#4b4f63] ring-2 ring-white"
      style={{ width: tamanho, height: tamanho }}
    >
      {inicial}
    </span>
  );
}

function Raio() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden>
      <path d="M9 1 3 9h4l-1 6 6-8H8l1-6Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>
  );
}

const cartao = "rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(16,24,40,0.06)] ring-1 ring-[#eceef2]";

/** Página inicial do Instagram, no jeito da "Inicial" do ManyChat: saudação, modelos, próximos passos e os últimos 7 dias. */
export default function InstagramInicio({ d }: { d: DadosInicio }) {
  const feitos = d.passos.filter((p) => p.feito).length;
  const minutos = d.doRobo; // ~1 minuto de atendente poupado por resposta do robô
  const tempo = minutos >= 120 ? `${Math.round(minutos / 60)} horas` : `${minutos} minuto${minutos === 1 ? "" : "s"}`;
  const canais = d.contas.filter((c) => c.active).length;

  return (
    <div className="-mx-1 rounded-2xl bg-[#f6f7f9] px-4 py-6 sm:px-8 sm:py-8">
      <div className="mx-auto flex max-w-[940px] flex-col gap-8">
        {(d.aguardando > 0 || d.naoLidas > 0) && (
          <a href="#conversas" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-[#1b1f2b] px-4 py-3 text-white hover:bg-black">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-lg" aria-hidden>
              💬
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {d.aguardando > 0 ? `${d.aguardando} conversa${d.aguardando === 1 ? "" : "s"} aguardando atendente` : `${d.naoLidas} conversa${d.naoLidas === 1 ? "" : "s"} não lida${d.naoLidas === 1 ? "" : "s"}`}
              </span>
              <span className="block text-xs text-white/70">
                {d.aguardando > 0 && d.naoLidas > 0 ? `e ${d.naoLidas} não lida${d.naoLidas === 1 ? "" : "s"} · ` : ""}O robô passou para a equipe: responda pela caixa de entrada.
              </span>
            </span>
            <span className="rounded-lg bg-[#22c55e] px-3 py-1.5 text-xs font-semibold text-[#06260f]">Abrir conversas →</span>
          </a>
        )}

        <header>
          <h2 className="text-3xl font-extrabold tracking-tight text-[#1b1f2b] [text-wrap:balance] sm:text-4xl">Olá, {d.nomeLoja}!</h2>
          <p className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-[#5a5f6d]">
            <span>
              {canais} canal{canais === 1 ? "" : "is"} conectado{canais === 1 ? "" : "s"}
            </span>
            <span>{d.totalContatos.toLocaleString("pt-BR")} contatos</span>
            <a href="#metricas" className="font-medium text-[#2563eb] hover:underline">
              Ver métricas
            </a>
          </p>
        </header>

        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <h3 className="text-xl font-bold text-[#1b1f2b]">Comece aqui</h3>
            <button onClick={() => abrirModelos()} className="text-[13px] font-medium text-[#2563eb] hover:underline">
              Veja todos os modelos
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {MODELOS_INICIO.map((m) => (
              <button
                key={m.titulo}
                onClick={() => (m.modelo ? abrirModelos(m.modelo) : (window.location.hash = m.secao ?? "fluxos"))}
                className={`${cartao} flex min-h-[96px] flex-col justify-between gap-4 text-left transition hover:ring-[#c7cbe0]`}
              >
                <span className="text-[14px] font-medium leading-snug text-[#1b1f2b]">{m.titulo}</span>
                <span className="flex items-center justify-between gap-2 text-[11px] text-[#8a8f9c]">
                  <span className="flex items-center gap-1">
                    <Raio /> Automação rápida
                  </span>
                  {m.selo && <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${m.selo[1]}`}>{m.selo[0]}</span>}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xl font-bold text-[#1b1f2b]">Suas próximas melhores ações</h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={`${cartao} flex flex-col gap-3`}>
              <div>
                <p className="text-[11px] text-[#8a8f9c]">Primeiros passos</p>
                <p className="mt-0.5 text-[15px] font-semibold leading-snug text-[#1b1f2b]">
                  {feitos === d.passos.length ? "Tudo configurado! O robô já trabalha sozinho." : "Você está indo muito bem! Termine as automações que faltam para o robô atender sozinho."}
                </p>
              </div>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-[#eceef2]">
                  <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${(feitos / Math.max(1, d.passos.length)) * 100}%` }} />
                </div>
                <p className="mt-1.5 text-[11px] text-[#8a8f9c]">
                  {feitos} de {d.passos.length} concluídos
                </p>
              </div>
              <div className="flex flex-col gap-2">
                {d.passos.map((p) => (
                  <a
                    key={p.id}
                    href={`#${p.secao}`}
                    className={`flex min-h-[40px] items-center gap-2.5 rounded-lg px-3 text-[13px] ring-1 ${
                      p.feito ? "bg-[#f6f7f9] text-[#a1a5b0] line-through ring-[#eceef2]" : "text-[#1b1f2b] ring-[#e3e5ea] hover:ring-[#c7cbe0]"
                    }`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] ${p.feito ? "text-[#5a5f6d]" : "ring-1 ring-[#c9ccd6]"}`}>{p.feito ? "✓" : ""}</span>
                    <span className="min-w-0 flex-1 truncate">{p.titulo}</span>
                    {!p.feito && <span className="text-[#8a8f9c]">›</span>}
                  </a>
                ))}
              </div>
            </div>

            <div className={`${cartao} flex flex-col gap-3`}>
              <div>
                <p className="text-[11px] text-[#8a8f9c]">Contas</p>
                <p className="mt-0.5 text-[15px] font-semibold leading-snug text-[#1b1f2b]">Instagram conectado ao robô</p>
              </div>
              <div className="flex flex-col gap-2">
                {d.contas.map((c) => (
                  <div key={c.id} className="flex min-h-[44px] items-center gap-3 rounded-lg px-3 ring-1 ring-[#e3e5ea]">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${c.active ? "bg-[#22c55e]" : "bg-[#c9ccd6]"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-[#1b1f2b]">@{c.username}</span>
                      <span className="block text-[11px] text-[#8a8f9c]">
                        {c.loja === "bff" ? "BFF" : "Moranga"} · {c.active ? "ativa" : "inativa"}
                      </span>
                    </span>
                    <a href={`/api/instagram/connect?loja=${c.loja}`} className="text-[12px] font-medium text-[#2563eb] hover:underline">
                      Reconectar
                    </a>
                  </div>
                ))}
                {d.faltaConectar.map((l) => (
                  <a
                    key={l}
                    href={`/api/instagram/connect?loja=${l}`}
                    className="flex min-h-[44px] items-center rounded-lg px-3 text-[13px] text-[#5a5f6d] border border-dashed border-[#c9ccd6] hover:text-[#2563eb]"
                  >
                    + Conectar a conta da {l === "bff" ? "BFF" : "Moranga"}
                  </a>
                ))}
              </div>
              <a href="#conversas" className="mt-auto self-start rounded-lg bg-[#2563eb] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1d4ed8]">
                Abrir caixa de entrada
              </a>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-xl font-bold text-[#1b1f2b]">Seus últimos 7 dias</h3>
          <p className="mb-3 mt-0.5 text-[13px] text-[#5a5f6d]">Desempenho da sua automação, atualizado em {d.atualizadoEm}.</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={`${cartao} flex items-center justify-between gap-3`}>
              <div className="min-w-0">
                <p className="text-[12px] text-[#5a5f6d]">Top engajamento</p>
                <p className="mt-1 text-[14px] font-semibold text-[#1b1f2b]">Top {Math.min(10, d.top.length)} contatos</p>
              </div>
              <a href="#contatos" className="flex shrink-0 -space-x-3" title="Quem mais conversou com a loja nos últimos 7 dias">
                {d.top.slice(0, 3).map((p) => (
                  <Foto key={p.id} p={p} tamanho={36} />
                ))}
                {d.top.length === 0 && <span className="text-[12px] text-[#a1a5b0]">—</span>}
              </a>
            </div>
            <div className={cartao}>
              <p className="text-[12px] text-[#5a5f6d]">Tempo economizado</p>
              <p className="mt-1 text-[14px] text-[#1b1f2b]">
                <b className="text-xl">{tempo.split(" ")[0]}</b> {tempo.split(" ").slice(1).join(" ")}
              </p>
              <p className="text-[11px] text-[#2563eb]">{d.doRobo.toLocaleString("pt-BR")} respostas do robô</p>
            </div>
            <div className={cartao}>
              <p className="text-[12px] text-[#5a5f6d]">Contatos captados</p>
              <p className="mt-1 text-[14px] text-[#1b1f2b]">
                <b className="text-xl">{d.novosContatos.toLocaleString("pt-BR")}</b> novo{d.novosContatos === 1 ? "" : "s"}
              </p>
              <a href="#contatos" className="text-[11px] text-[#2563eb] hover:underline">
                Ver contatos
              </a>
            </div>
            <div className={cartao}>
              <p className="text-[12px] text-[#5a5f6d]">Mensagens recebidas</p>
              <p className="mt-1 text-xl font-bold text-[#1b1f2b]">{d.recebidas.toLocaleString("pt-BR")}</p>
            </div>
            <div className={cartao}>
              <p className="text-[12px] text-[#5a5f6d]">Respondidas pelo robô</p>
              <p className="mt-1 text-xl font-bold text-[#1b1f2b]">
                {d.recebidas ? Math.min(100, Math.round((d.doRobo / d.recebidas) * 100)) : 0}%
              </p>
              <p className="text-[11px] text-[#8a8f9c]">das mensagens recebidas</p>
            </div>
            <div className={cartao}>
              <p className="text-[12px] text-[#5a5f6d]">Chamaram atendente</p>
              <p className="mt-1 text-xl font-bold text-[#1b1f2b]">{d.chamaramAtendente.toLocaleString("pt-BR")}</p>
              <a href="#conversas" className="text-[11px] text-[#2563eb] hover:underline">
                Ver conversas
              </a>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
