"use client";

import { useEffect, useMemo, useState } from "react";
import { novoId, novoNo, type DadosPorTipo, type Grafo, type No, type TipoNo } from "@/lib/igFluxosModelo";

type Objetivo = "seguidores" | "engajar" | "trafego" | "vender";
type GatilhoModelo = "comentario" | "palavra" | "story";

export type Modelo = {
  id: string;
  titulo: string;
  descricao: string;
  objetivo: Objetivo;
  gatilho: GatilhoModelo;
  selo?: "NOVO" | "POPULAR";
  grafo: () => Grafo;
};

/** Bloco com dados prontos (o resto vem do padrão do tipo). */
function bloco<T extends TipoNo>(tipo: T, x: number, y: number, dados: Partial<DadosPorTipo[T]>): No<T> {
  const n = novoNo(tipo, x, y);
  return { ...n, dados: { ...n.dados, ...dados } };
}
const ligar = (de: No, saida: string, para: No) => ({ id: novoId("l"), de: de.id, saida, para: para.id });

// Os links ficam vazios de propósito: cada loja coloca o seu no editor antes de ligar o fluxo (BFF e Moranga não se misturam).
export const MODELOS: Modelo[] = [
  {
    id: "story",
    titulo: "Responda quem responde seus stories",
    descricao: "Quem responder um story recebe uma mensagem na hora, com o botão do seu site ou app.",
    objetivo: "engajar",
    gatilho: "story",
    selo: "NOVO",
    grafo: () => {
      const g = bloco("gatilho", 60, 120, { tipo: "story", palavras: "" });
      const m = bloco("mensagem", 380, 100, { texto: "Oi, {nome}! Que bom que você respondeu nosso story 💜 Dá uma olhada nas novidades:", botoesTipo: "link", link: { titulo: "Ver novidades", url: "" } });
      return { nos: [g, m], ligacoes: [ligar(g, "proximo", m)] };
    },
  },
  {
    id: "comentario-link",
    titulo: "Envie link por DM a partir dos comentários",
    descricao: "Quem comentar a palavra na publicação recebe o link no direct automaticamente.",
    objetivo: "trafego",
    gatilho: "comentario",
    selo: "POPULAR",
    grafo: () => {
      const g = bloco("gatilho", 60, 120, { tipo: "comentario", palavras: "EU QUERO" });
      const m = bloco("mensagem", 380, 100, { texto: "Oi, {nome}! Aqui está o link que você pediu 👇", botoesTipo: "link", link: { titulo: "Abrir link", url: "" } });
      return { nos: [g, m], ligacoes: [ligar(g, "proximo", m)] };
    },
  },
  {
    id: "seguir-antes",
    titulo: "Aumente seus seguidores com comentários",
    descricao: "Quem comenta recebe o link só se já segue a loja. Quem não segue recebe o convite para seguir.",
    objetivo: "seguidores",
    gatilho: "comentario",
    grafo: () => {
      const g = bloco("gatilho", 60, 140, { tipo: "comentario", palavras: "QUERO" });
      const c = bloco("condicao", 380, 140, { tipo: "segue_loja" });
      const sim = bloco("mensagem", 720, 40, { texto: "Oi, {nome}! Obrigada por seguir a gente 💜 Aqui está o seu link:", botoesTipo: "link", link: { titulo: "Abrir link", url: "" } });
      const nao = bloco("mensagem", 720, 260, { texto: "Oi, {nome}! Pra liberar o link, segue a gente aqui no Instagram e comenta QUERO de novo 😉" });
      return { nos: [g, c, sim, nao], ligacoes: [ligar(g, "proximo", c), ligar(c, "sim", sim), ligar(c, "nao", nao)] };
    },
  },
  {
    id: "palavra-link",
    titulo: "Palavra-chave no direct manda o link",
    descricao: "Quem mandar a palavra (ex.: LINK ou SITE) no direct recebe o botão com o endereço.",
    objetivo: "trafego",
    gatilho: "palavra",
    grafo: () => {
      const g = bloco("gatilho", 60, 120, { tipo: "palavra", palavras: "LINK, SITE", modo: "contem" });
      const m = bloco("mensagem", 380, 100, { texto: "Claro, {nome}! É só tocar no botão 👇", botoesTipo: "link", link: { titulo: "Abrir site", url: "" } });
      return { nos: [g, m], ligacoes: [ligar(g, "proximo", m)] };
    },
  },
  {
    id: "atacado-varejo",
    titulo: "Pergunte se é atacado ou varejo",
    descricao: "Mostra dois botões e etiqueta o contato conforme a resposta, para você filtrar depois.",
    objetivo: "vender",
    gatilho: "palavra",
    grafo: () => {
      const g = bloco("gatilho", 60, 160, { tipo: "palavra", palavras: "PREÇO, VALOR", modo: "contem" });
      const m = bloco("mensagem", 380, 140, { texto: "Oi, {nome}! Você quer comprar no atacado ou no varejo?", botoesTipo: "rapidos", botoes: [{ titulo: "Atacado" }, { titulo: "Varejo" }] });
      const ea = bloco("etiqueta", 720, 40, { acao: "adicionar", etiquetas: "Atacado" });
      const ev = bloco("etiqueta", 720, 300, { acao: "adicionar", etiquetas: "Varejo" });
      const ma = bloco("mensagem", 1040, 20, { texto: "Perfeito! Te explico como funciona o atacado:" });
      const mv = bloco("mensagem", 1040, 280, { texto: "Entendi! Te mostro por onde comprar:" });
      return {
        nos: [g, m, ea, ev, ma, mv],
        ligacoes: [ligar(g, "proximo", m), ligar(m, "b0", ea), ligar(m, "b1", ev), ligar(ea, "proximo", ma), ligar(ev, "proximo", mv)],
      };
    },
  },
  {
    id: "cidade",
    titulo: "Descubra a cidade do cliente",
    descricao: "Pergunta a cidade, grava no contato e etiqueta como lead para campanhas por região.",
    objetivo: "engajar",
    gatilho: "palavra",
    grafo: () => {
      const g = bloco("gatilho", 60, 120, { tipo: "palavra", palavras: "REVENDER", modo: "contem" });
      const p = bloco("pergunta", 380, 100, { texto: "Que bom, {nome}! De qual cidade você é?", variavel: "cidade", salvarNoContato: true });
      const e = bloco("etiqueta", 700, 100, { acao: "adicionar", etiquetas: "Lead" });
      const m = bloco("mensagem", 1020, 100, { texto: "Obrigada! Já anotei aqui: {cidade} 💜" });
      return { nos: [g, p, e, m], ligacoes: [ligar(g, "proximo", p), ligar(p, "proximo", e), ligar(e, "proximo", m)] };
    },
  },
  {
    id: "horario",
    titulo: "Atendente só no horário comercial",
    descricao: "Dentro do horário chama a equipe; fora dele avisa quando a loja volta e etiqueta a conversa.",
    objetivo: "engajar",
    gatilho: "palavra",
    grafo: () => {
      const g = bloco("gatilho", 60, 140, { tipo: "palavra", palavras: "ATENDENTE", modo: "contem" });
      const c = bloco("condicao", 380, 140, { tipo: "horario", inicio: "09:00", fim: "18:00", dias: [1, 2, 3, 4, 5] });
      const a = bloco("atendente", 720, 40, {});
      const m = bloco("mensagem", 720, 260, { texto: "Nosso atendimento é de segunda a sexta, das 9h às 18h. Assim que abrir, uma atendente te responde por aqui 💜" });
      const e = bloco("etiqueta", 1040, 260, { acao: "adicionar", etiquetas: "Fora do horário" });
      return { nos: [g, c, a, m, e], ligacoes: [ligar(g, "proximo", c), ligar(c, "sim", a), ligar(c, "nao", m), ligar(m, "proximo", e)] };
    },
  },
];

const OBJETIVOS: [Objetivo, string][] = [
  ["seguidores", "Aumente seus seguidores"],
  ["engajar", "Engaje seu público"],
  ["trafego", "Direcionar tráfego"],
  ["vender", "Vender mais"],
];
const GATILHOS: [GatilhoModelo, string][] = [
  ["comentario", "Comentário na publicação"],
  ["palavra", "DM (palavra-chave)"],
  ["story", "Resposta ao story"],
];
const COR_SELO = { NOVO: "bg-[#6d5dfc] text-white", POPULAR: "bg-[#d9480f] text-white" };

/** Janela "Modelos" (como a do ManyChat): filtros por objetivo e por gatilho à esquerda, cartões à direita. */
export default function ModelosFluxo({
  contas,
  inicial,
  onFechar,
  onEscolher,
  onDoZero,
}: {
  contas: { id: string; username: string | null; loja: string }[];
  inicial: string;
  onFechar: () => void;
  onEscolher: (m: Modelo, contaId: string) => Promise<void>;
  onDoZero: (contaId: string) => void;
}) {
  const [filtro, setFiltro] = useState<string>(MODELOS.some((m) => m.id === inicial) ? "todos" : inicial || "todos");
  const [busca, setBusca] = useState("");
  const [contaId, setContaId] = useState(contas[0]?.id ?? "");
  const [criando, setCriando] = useState<string | null>(null);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onFechar();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onFechar]);

  // Veio de um atalho da Inicial com um modelo específico: já cria esse.
  useEffect(() => {
    const m = MODELOS.find((x) => x.id === inicial);
    if (m && contaId) {
      setCriando(m.id);
      onEscolher(m, contaId).finally(() => setCriando(null));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return MODELOS.filter((m) => {
      if (filtro.startsWith("o:") && m.objetivo !== filtro.slice(2)) return false;
      if (filtro.startsWith("g:") && m.gatilho !== filtro.slice(2)) return false;
      return !q || `${m.titulo} ${m.descricao}`.toLowerCase().includes(q);
    });
  }, [filtro, busca]);

  const tituloLista =
    filtro === "todos"
      ? "Todos os modelos"
      : (filtro.startsWith("o:") ? OBJETIVOS.find(([k]) => `o:${k}` === filtro) : GATILHOS.find(([k]) => `g:${k}` === filtro))?.[1] ?? "Modelos";

  const item = (id: string, rotulo: string) => (
    <button
      key={id}
      onClick={() => setFiltro(id)}
      className={`w-full truncate rounded-lg px-3 py-1.5 text-left text-[13px] ${filtro === id ? "bg-[#e9eaee] font-medium text-[#1b1f2b]" : "text-[#3d4250] hover:bg-[#f2f3f5]"}`}
    >
      {rotulo}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onFechar()}>
      <div role="dialog" aria-modal="true" aria-label="Modelos" className="flex max-h-[92vh] w-full max-w-[940px] flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-[#eceef2] px-4 py-3">
          <p className="flex-1 text-base font-semibold text-[#1b1f2b]">Modelos</p>
          <button
            onClick={() => onDoZero(contaId)}
            disabled={!contaId}
            className="rounded-lg border border-[#e3e5ea] px-3 py-1.5 text-[13px] font-medium text-[#1b1f2b] hover:bg-[#f6f7f9] disabled:opacity-40"
          >
            + Começar do zero
          </button>
          <button onClick={onFechar} className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-[#5a5f6d] hover:bg-[#f2f3f5]" aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar modelos do Instagram…"
            className="min-w-0 flex-1 rounded-lg border border-[#e3e5ea] px-3 py-2 text-sm outline-none focus:border-[#2563eb]"
          />
          {contas.length > 1 && (
            <select value={contaId} onChange={(e) => setContaId(e.target.value)} className="rounded-lg border border-[#e3e5ea] px-3 py-2 text-sm">
              {contas.map((c) => (
                <option key={c.id} value={c.id}>
                  @{c.username} ({c.loja === "bff" ? "BFF" : "Moranga"})
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:flex-row">
          <nav className="flex shrink-0 flex-row gap-1 overflow-x-auto md:w-48 md:flex-col md:overflow-visible" aria-label="Filtrar modelos">
            <div className="hidden md:block">{item("todos", "Todos os modelos")}</div>
            <p className="hidden px-3 pb-1 pt-3 text-[13px] font-semibold text-[#1b1f2b] md:block">Por objetivo</p>
            <div className="flex gap-1 md:flex-col">{OBJETIVOS.map(([k, r]) => item(`o:${k}`, r))}</div>
            <p className="hidden px-3 pb-1 pt-3 text-[13px] font-semibold text-[#1b1f2b] md:block">Por gatilho</p>
            <div className="flex gap-1 md:flex-col">{GATILHOS.map(([k, r]) => item(`g:${k}`, r))}</div>
          </nav>
          <div className="min-w-0 flex-1">
            <p className="mb-3 text-lg font-semibold text-[#1b1f2b]">{tituloLista}</p>
            {visiveis.length === 0 && <p className="py-8 text-center text-sm text-[#8a8f9c]">Nenhum modelo com esse filtro.</p>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visiveis.map((m) => (
                <button
                  key={m.id}
                  onClick={async () => {
                    setCriando(m.id);
                    await onEscolher(m, contaId);
                    setCriando(null);
                  }}
                  disabled={!!criando || !contaId}
                  className="flex min-h-[164px] flex-col rounded-xl border border-[#e3e5ea] p-4 text-left transition hover:border-[#9aa3c7] hover:shadow-sm disabled:opacity-60"
                >
                  <span className="text-[16px] font-semibold leading-snug text-[#1b1f2b] [text-wrap:balance]">{m.titulo}</span>
                  <span className="mt-1.5 line-clamp-2 text-[12.5px] leading-snug text-[#6b6f80]">{m.descricao}</span>
                  <span className="mt-auto flex items-center justify-between gap-2 pt-4 text-[11px] text-[#8a8f9c]">
                    <span>{criando === m.id ? "Criando…" : m.grafo().nos.length > 2 ? "Construtor de fluxo" : "⚡ Automação rápida"}</span>
                    {m.selo && <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold tracking-wide ${COR_SELO[m.selo]}`}>{m.selo}</span>}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
