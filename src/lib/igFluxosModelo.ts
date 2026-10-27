// Modelo dos fluxos visuais do Instagram (Flow Builder do ManyChat).
// Arquivo puro (sem banco, sem "server-only"): usado pelo editor/simulador no navegador e pelo motor no servidor.

import { contemPalavra } from "@/lib/igTexto";

export type TipoNo = "gatilho" | "mensagem" | "pergunta" | "condicao" | "atraso" | "etiqueta" | "atendente" | "irpara" | "fim";

export type TipoGatilho = "palavra" | "story" | "comentario" | "etiqueta" | "postback";

export type DadosGatilho = {
  tipo: TipoGatilho;
  /** Palavras separadas por vírgula (palavra-chave na DM, resposta a story, comentário). */
  palavras: string;
  modo: "contem" | "exata";
  /** Comentário: só nesta publicação (vazio = qualquer uma). */
  midiaId: string;
  /** Etiqueta aplicada. */
  etiqueta: string;
  /** Botão do menu / postback: payload exato. */
  payload: string;
};

export type DadosMensagem = {
  texto: string;
  /** Tipo de botão: nenhum, respostas rápidas (até 13) ou um botão com link. */
  botoesTipo: "nenhum" | "rapidos" | "link";
  botoes: { titulo: string }[];
  link: { titulo: string; url: string };
};

export type DadosPergunta = {
  texto: string;
  variavel: string;
  /** Sugestões de resposta (respostas rápidas). A resposta guardada é o texto tocado ou digitado. */
  sugestoes: { titulo: string }[];
  /** Também grava a resposta no campo personalizado do contato (IgConversation.campos). */
  salvarNoContato: boolean;
};

export type TipoCondicao = "etiqueta" | "variavel_igual" | "contem_texto" | "segue_loja" | "horario";
export type DadosCondicao = {
  tipo: TipoCondicao;
  etiqueta: string;
  variavel: string;
  valor: string;
  /** Horário (America/Sao_Paulo) "HH:MM". */
  inicio: string;
  fim: string;
  /** Dias da semana (0 = domingo … 6 = sábado). */
  dias: number[];
};

export type DadosAtraso = { quantidade: number; unidade: "minutos" | "horas" | "dias" };
export type DadosEtiqueta = { acao: "adicionar" | "remover"; etiquetas: string };
export type DadosAtendente = { texto: string };
export type DadosIrPara = { fluxoId: string };
export type DadosFim = Record<string, never>;

export type DadosPorTipo = {
  gatilho: DadosGatilho;
  mensagem: DadosMensagem;
  pergunta: DadosPergunta;
  condicao: DadosCondicao;
  atraso: DadosAtraso;
  etiqueta: DadosEtiqueta;
  atendente: DadosAtendente;
  irpara: DadosIrPara;
  fim: DadosFim;
};

export type No<T extends TipoNo = TipoNo> = { id: string; tipo: T; x: number; y: number; dados: DadosPorTipo[T] };
export type Ligacao = { id: string; de: string; saida: string; para: string };
export type Grafo = { nos: No[]; ligacoes: Ligacao[] };

export const MAX_PASSOS = 30;
export const MAX_BOTOES = 13;
export const MAX_NOS = 150;
export const PREFIXO_PAYLOAD = "FLX:";

export const BLOCOS: Record<TipoNo, { rotulo: string; cor: string; descricao: string }> = {
  gatilho: { rotulo: "Gatilho", cor: "#16a34a", descricao: "O que faz o fluxo começar" },
  mensagem: { rotulo: "Mensagem", cor: "#6366f1", descricao: "Texto com botões ou link" },
  pergunta: { rotulo: "Pergunta", cor: "#0ea5e9", descricao: "Pergunta e guarda a resposta" },
  condicao: { rotulo: "Condição", cor: "#f59e0b", descricao: "Divide em Sim / Não" },
  atraso: { rotulo: "Atraso", cor: "#8b5cf6", descricao: "Espera minutos, horas ou dias" },
  etiqueta: { rotulo: "Etiqueta", cor: "#ec4899", descricao: "Adiciona ou remove etiquetas" },
  atendente: { rotulo: "Chamar atendente", cor: "#ef4444", descricao: "Passa para a equipe" },
  irpara: { rotulo: "Ir para outro fluxo", cor: "#14b8a6", descricao: "Continua em outro fluxo" },
  fim: { rotulo: "Fim", cor: "#64748b", descricao: "Encerra o fluxo" },
};

export function novoId(prefixo = "n"): string {
  return `${prefixo}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function dadosPadrao<T extends TipoNo>(tipo: T): DadosPorTipo[T] {
  const d: { [K in TipoNo]: DadosPorTipo[K] } = {
    gatilho: { tipo: "palavra", palavras: "", modo: "contem", midiaId: "", etiqueta: "", payload: "" },
    mensagem: { texto: "Oi, {nome}! ", botoesTipo: "nenhum", botoes: [], link: { titulo: "Abrir", url: "" } },
    pergunta: { texto: "Qual é a sua cidade?", variavel: "cidade", sugestoes: [], salvarNoContato: false },
    condicao: { tipo: "etiqueta", etiqueta: "", variavel: "", valor: "", inicio: "09:00", fim: "18:00", dias: [1, 2, 3, 4, 5] },
    atraso: { quantidade: 1, unidade: "horas" },
    etiqueta: { acao: "adicionar", etiquetas: "" },
    atendente: { texto: "Vou chamar uma atendente pra te ajudar, já já ela te responde por aqui." },
    irpara: { fluxoId: "" },
    fim: {},
  };
  return structuredClone(d[tipo]);
}

export function novoNo<T extends TipoNo>(tipo: T, x: number, y: number): No<T> {
  return { id: novoId(), tipo, x: Math.round(x), y: Math.round(y), dados: dadosPadrao(tipo) };
}

export function grafoInicial(): Grafo {
  const g = novoNo("gatilho", 60, 120);
  const m = novoNo("mensagem", 380, 100);
  return { nos: [g, m], ligacoes: [{ id: novoId("l"), de: g.id, saida: "proximo", para: m.id }] };
}

/** Saídas (pontos de ligação) de cada bloco, na ordem em que aparecem no editor. */
export function saidasDe(no: No): { id: string; rotulo: string }[] {
  switch (no.tipo) {
    case "mensagem": {
      const d = no.dados as DadosMensagem;
      if (d.botoesTipo === "rapidos" && d.botoes.length) {
        return [...d.botoes.map((b, i) => ({ id: `b${i}`, rotulo: `Botão: ${b.titulo || `#${i + 1}`}` })), { id: "proximo", rotulo: "Digitou outra coisa" }];
      }
      return [{ id: "proximo", rotulo: "Próximo" }];
    }
    case "pergunta":
      return [{ id: "proximo", rotulo: "Depois da resposta" }];
    case "condicao":
      return [
        { id: "sim", rotulo: "Sim" },
        { id: "nao", rotulo: "Não" },
      ];
    case "irpara":
    case "fim":
      return [];
    default:
      return [{ id: "proximo", rotulo: "Próximo" }];
  }
}

export function proximoNo(grafo: Grafo, noId: string, saida: string): string | null {
  return grafo.ligacoes.find((l) => l.de === noId && l.saida === saida)?.para ?? null;
}

export function noGatilho(grafo: Grafo): No<"gatilho"> | null {
  return (grafo.nos.find((n) => n.tipo === "gatilho") as No<"gatilho"> | undefined) ?? null;
}

// ───────── Validação (servidor) ─────────

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, padrao: number) => (typeof v === "number" && Number.isFinite(v) ? v : padrao);
const TIPOS: TipoNo[] = ["gatilho", "mensagem", "pergunta", "condicao", "atraso", "etiqueta", "atendente", "irpara", "fim"];

function limparDados(tipo: TipoNo, raw: unknown): DadosPorTipo[TipoNo] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const base = dadosPadrao(tipo) as Record<string, unknown>;
  switch (tipo) {
    case "gatilho": {
      const tiposG: TipoGatilho[] = ["palavra", "story", "comentario", "etiqueta", "postback"];
      return {
        tipo: tiposG.includes(r.tipo as TipoGatilho) ? (r.tipo as TipoGatilho) : "palavra",
        palavras: str(r.palavras, 500),
        modo: r.modo === "exata" ? "exata" : "contem",
        midiaId: str(r.midiaId, 100),
        etiqueta: str(r.etiqueta, 40),
        payload: str(r.payload, 200),
      };
    }
    case "mensagem": {
      const botoes = Array.isArray(r.botoes) ? r.botoes.slice(0, MAX_BOTOES).map((b) => ({ titulo: str((b as { titulo?: unknown })?.titulo, 20) })) : [];
      const link = (r.link && typeof r.link === "object" ? r.link : {}) as Record<string, unknown>;
      const bt = r.botoesTipo === "rapidos" || r.botoesTipo === "link" ? r.botoesTipo : "nenhum";
      return { texto: str(r.texto, 1000), botoesTipo: bt, botoes, link: { titulo: str(link.titulo, 20), url: str(link.url, 1000) } };
    }
    case "pergunta": {
      const sugestoes = Array.isArray(r.sugestoes) ? r.sugestoes.slice(0, MAX_BOTOES).map((b) => ({ titulo: str((b as { titulo?: unknown })?.titulo, 20) })) : [];
      return { texto: str(r.texto, 1000), variavel: nomeVariavel(str(r.variavel, 40)) || "resposta", sugestoes, salvarNoContato: r.salvarNoContato === true };
    }
    case "condicao": {
      const tiposC: TipoCondicao[] = ["etiqueta", "variavel_igual", "contem_texto", "segue_loja", "horario"];
      return {
        tipo: tiposC.includes(r.tipo as TipoCondicao) ? (r.tipo as TipoCondicao) : "etiqueta",
        etiqueta: str(r.etiqueta, 40),
        variavel: str(r.variavel, 40),
        valor: str(r.valor, 200),
        inicio: /^\d{2}:\d{2}$/.test(str(r.inicio)) ? str(r.inicio) : "09:00",
        fim: /^\d{2}:\d{2}$/.test(str(r.fim)) ? str(r.fim) : "18:00",
        dias: Array.isArray(r.dias) ? [...new Set(r.dias.filter((d): d is number => Number.isInteger(d) && d >= 0 && d <= 6))] : [],
      };
    }
    case "atraso":
      return {
        quantidade: Math.max(1, Math.min(10000, Math.round(num(r.quantidade, 1)))),
        unidade: r.unidade === "minutos" || r.unidade === "dias" ? r.unidade : "horas",
      };
    case "etiqueta":
      return { acao: r.acao === "remover" ? "remover" : "adicionar", etiquetas: str(r.etiquetas, 400) };
    case "atendente":
      return { texto: str(r.texto, 1000) };
    case "irpara":
      return { fluxoId: str(r.fluxoId, 60) };
    default:
      return base as DadosFim;
  }
}

/** Confere e normaliza o grafo que veio do editor. */
export function validarGrafo(raw: unknown): { grafo: Grafo } | { erro: string } {
  const r = (raw && typeof raw === "object" ? raw : {}) as { nos?: unknown; ligacoes?: unknown };
  if (!Array.isArray(r.nos)) return { erro: "Fluxo sem blocos" };
  if (r.nos.length > MAX_NOS) return { erro: `No máximo ${MAX_NOS} blocos por fluxo` };
  const nos: No[] = [];
  const ids = new Set<string>();
  for (const n of r.nos as Record<string, unknown>[]) {
    const tipo = n?.tipo as TipoNo;
    const id = str(n?.id, 60);
    if (!TIPOS.includes(tipo) || !id || ids.has(id)) continue;
    ids.add(id);
    nos.push({ id, tipo, x: Math.round(num(n.x, 0)), y: Math.round(num(n.y, 0)), dados: limparDados(tipo, n.dados) } as No);
  }
  const gatilhos = nos.filter((n) => n.tipo === "gatilho");
  if (gatilhos.length !== 1) return { erro: "O fluxo precisa de exatamente um bloco de Gatilho" };
  const vistos = new Set<string>();
  const ligacoes: Ligacao[] = [];
  for (const l of (Array.isArray(r.ligacoes) ? r.ligacoes : []) as Record<string, unknown>[]) {
    const de = str(l?.de, 60);
    const para = str(l?.para, 60);
    const saida = str(l?.saida, 20);
    const origem = nos.find((n) => n.id === de);
    const destino = nos.find((n) => n.id === para);
    if (!origem || !destino || destino.tipo === "gatilho" || de === para) continue;
    if (!saidasDe(origem).some((s) => s.id === saida)) continue;
    const chave = `${de}|${saida}`;
    if (vistos.has(chave)) continue; // cada saída liga em um bloco só
    vistos.add(chave);
    ligacoes.push({ id: str(l.id, 60) || novoId("l"), de, saida, para });
  }
  return { grafo: { nos, ligacoes } };
}

/** Vazio quando o grafo pode ser ativado; senão a lista do que falta. */
export function problemasParaAtivar(grafo: Grafo): string[] {
  const p: string[] = [];
  const g = noGatilho(grafo);
  if (!g) return ["Falta o bloco de Gatilho"];
  const d = g.dados;
  if (d.tipo === "palavra" && !d.palavras.trim()) p.push("Gatilho de palavra-chave sem nenhuma palavra");
  if (d.tipo === "etiqueta" && !d.etiqueta.trim()) p.push("Gatilho de etiqueta sem a etiqueta");
  if (d.tipo === "postback" && !d.payload.trim()) p.push("Gatilho de botão do menu sem o payload");
  if (!proximoNo(grafo, g.id, "proximo")) p.push("O Gatilho não está ligado a nenhum bloco");
  for (const n of grafo.nos) {
    if (n.tipo === "mensagem" && !(n.dados as DadosMensagem).texto.trim()) p.push("Há uma Mensagem sem texto");
    if (n.tipo === "pergunta" && !(n.dados as DadosPergunta).texto.trim()) p.push("Há uma Pergunta sem texto");
    if (n.tipo === "mensagem") {
      const m = n.dados as DadosMensagem;
      if (m.botoesTipo === "link" && !/^https?:\/\//i.test(m.link.url)) p.push("Há uma Mensagem com botão de link sem endereço (https://…)");
      if (m.botoesTipo === "rapidos" && m.botoes.some((b) => !b.titulo.trim())) p.push("Há um botão de resposta rápida sem texto");
    }
    if (n.tipo === "irpara" && !(n.dados as DadosIrPara).fluxoId) p.push("Há um bloco Ir para outro fluxo sem fluxo escolhido");
  }
  return [...new Set(p)];
}

// ───────── Execução (motor e simulador) ─────────

export function nomeVariavel(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** Troca {variavel} pelos valores conhecidos; chaves desconhecidas somem (nunca chega "{cidade}" para a cliente). */
export function aplicarVariaveis(texto: string, vars: Record<string, unknown>): string {
  return texto
    .replace(/\{([\p{L}\p{N}_]+)\}/gu, (_m, chave: string) => {
      const v = vars[chave] ?? vars[nomeVariavel(chave)];
      return v === undefined || v === null ? "" : String(v);
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function duracaoMs(d: DadosAtraso): number {
  const mult = d.unidade === "minutos" ? 60_000 : d.unidade === "horas" ? 3_600_000 : 86_400_000;
  return Math.max(1, d.quantidade) * mult;
}

export function descreverAtraso(d: DadosAtraso): string {
  const q = d.quantidade;
  const u = d.unidade === "minutos" ? (q === 1 ? "minuto" : "minutos") : d.unidade === "horas" ? (q === 1 ? "hora" : "horas") : q === 1 ? "dia" : "dias";
  return `${q} ${u}`;
}

const normal = (t: string) =>
  t
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();

/** Hora e dia da semana no horário de Brasília. */
export function horaBrasilia(agora = new Date()): { minutos: number; dia: number } {
  const partes = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false }).formatToParts(agora);
  const h = Number(partes.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const m = Number(partes.find((p) => p.type === "minute")?.value ?? 0);
  const dias = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return { minutos: h * 60 + m, dia: dias.indexOf(partes.find((p) => p.type === "weekday")?.value ?? "Sun") };
}

export type ContextoCondicao = {
  tags: string[];
  variaveis: Record<string, unknown>;
  seguePagina: boolean | null;
  /** Último texto que a pessoa mandou (para "contém texto" sem variável). */
  ultimoTexto: string;
  agora?: Date;
};

export function avaliarCondicao(d: DadosCondicao, ctx: ContextoCondicao): boolean {
  switch (d.tipo) {
    case "etiqueta":
      return ctx.tags.some((t) => normal(t) === normal(d.etiqueta));
    case "variavel_igual": {
      const v = ctx.variaveis[nomeVariavel(d.variavel)] ?? ctx.variaveis[d.variavel];
      return normal(String(v ?? "")) === normal(d.valor);
    }
    case "contem_texto": {
      const alvo = d.variavel.trim() ? String(ctx.variaveis[nomeVariavel(d.variavel)] ?? ctx.variaveis[d.variavel] ?? "") : ctx.ultimoTexto;
      const lista = d.valor.split(",").map(normal).filter(Boolean);
      const t = normal(alvo);
      return lista.length > 0 && lista.some((p) => t.includes(p));
    }
    case "segue_loja":
      return ctx.seguePagina === true;
    case "horario": {
      const { minutos, dia } = horaBrasilia(ctx.agora);
      const [hi, mi] = d.inicio.split(":").map(Number);
      const [hf, mf] = d.fim.split(":").map(Number);
      const ini = hi * 60 + mi;
      const fim = hf * 60 + mf;
      const naHora = ini <= fim ? minutos >= ini && minutos < fim : minutos >= ini || minutos < fim; // atravessa a meia-noite
      const noDia = d.dias.length === 0 || d.dias.includes(dia);
      return naHora && noDia;
    }
  }
}

export function descreverCondicao(d: DadosCondicao): string {
  const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  switch (d.tipo) {
    case "etiqueta":
      return `Tem a etiqueta "${d.etiqueta || "…"}"?`;
    case "variavel_igual":
      return `{${d.variavel || "…"}} é igual a "${d.valor}"?`;
    case "contem_texto":
      return `${d.variavel ? `{${d.variavel}}` : "A mensagem"} contém "${d.valor || "…"}"?`;
    case "segue_loja":
      return "Segue a loja?";
    case "horario":
      return `Entre ${d.inicio} e ${d.fim}${d.dias.length && d.dias.length < 7 ? ` (${d.dias.map((x) => DIAS[x]).join(", ")})` : ""}?`;
  }
}

export function descreverGatilho(d: DadosGatilho): string {
  switch (d.tipo) {
    case "palavra":
      return d.palavras.trim() ? `DM com ${d.modo === "exata" ? "exatamente" : "a palavra"}: ${d.palavras}` : "DM com palavra-chave (defina as palavras)";
    case "story":
      return d.palavras.trim() ? `Resposta a story com: ${d.palavras}` : "Qualquer resposta ou menção em story";
    case "comentario":
      return `Comentário ${d.midiaId ? "numa publicação específica" : "em qualquer publicação"}${d.palavras.trim() ? ` com: ${d.palavras}` : ""}`;
    case "etiqueta":
      return `Etiqueta aplicada: ${d.etiqueta || "…"}`;
    case "postback":
      return `Botão do menu: ${d.payload || "…"}`;
  }
}

/** Palavras separadas por vírgula; vazio = qualquer texto. */
export function casaPalavras(texto: string, palavras: string, modo: "contem" | "exata"): boolean {
  const lista = palavras.split(",").map(normal).filter(Boolean);
  if (lista.length === 0) return true;
  const t = normal(texto);
  const limpo = t.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  // "contém" casa palavra inteira e ignora acento ("oi" não casa dentro de "hoje").
  return lista.some((p) => (modo === "exata" ? limpo === p || t === p : contemPalavra(texto, p)));
}

/** Payload dos botões de resposta rápida: FLX:<fluxoId>:<noId>:<índice>. */
export function montarPayload(fluxoId: string, noId: string, indice: number): string {
  return `${PREFIXO_PAYLOAD}${fluxoId}:${noId}:${indice}`;
}

export function lerPayload(payload: string | null | undefined): { fluxoId: string; noId: string; indice: number } | null {
  if (!payload?.startsWith(PREFIXO_PAYLOAD)) return null;
  const [fluxoId, noId, i] = payload.slice(PREFIXO_PAYLOAD.length).split(":");
  const indice = Number(i);
  if (!fluxoId || !noId || !Number.isInteger(indice) || indice < 0) return null;
  return { fluxoId, noId, indice };
}
