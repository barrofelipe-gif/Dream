import "server-only";
import type { McpTool } from "@/lib/mcpTools";
import { LOJAS, type LojaId } from "@/lib/avaliacoes";

/**
 * Avaliações (BFF e Moranga) dentro do conector MCP do app — SOMENTE LEITURA.
 *
 * O sistema de avaliações tem o próprio conector MCP (ferramentas prontas, que leem direto do banco dele e já
 * tiram e-mail, telefone e IP). Aqui o app só repassa as consultas de LEITURA para lá, por uma lista fechada:
 * aprovar, responder, rejeitar e registrar NUNCA passam por este conector (continuam no painel, com conferência).
 *
 *  - REVIEWS_MCP_URL  endereço secreto do conector de lá (https://.../api/mcp/<segredo>). A empresa vai em ?loja=.
 */

const LOJA = {
  type: "string",
  description: "Empresa: bff (BFF Fitness, atacado) ou moranga (Moranga Biquínis, varejo). Padrão: bff.",
  enum: LOJAS.map((l) => l.id),
};

type Def = { remoto: string; description: string; properties?: McpTool["inputSchema"]["properties"]; required?: string[] };

// nome aqui -> ferramenta de leitura de lá. So o que esta nesta lista e repassado.
const DEFS: Record<string, Def> = {
  avaliacoes_resumo: {
    remoto: "resumo_painel",
    description: "Avaliações e perguntas: números gerais do período — avaliações de produto (nota, distribuição, com foto, compra verificada), avaliações da loja e NPS, perguntas (na fila, tempo de resposta), o que as clientes buscam, pedidos de avaliação e cashback, mais vendidos x quantas avaliações têm.",
    properties: { dias: { type: "number", description: "Período em dias. Padrão: 30." } },
  },
  avaliacoes_alertas: {
    remoto: "alertas_e_insights",
    description: "Avaliações: o que pede ação agora (relatório Alertas) — ex.: mais vendidos com pouca prova social (lista com foto, nome, ID do produto, vendidas, avaliações, fotos de cliente e motivo), produto com reclamação repetida, nota de entrega/atendimento caindo, perguntas paradas, dúvidas buscadas sem resposta. Traz também motivos das críticas (IA), reputação da loja, críticas para responder e moderação.",
    properties: { dias: { type: "number", description: "Período em dias (mínimo 7). Padrão: 90." } },
  },
  avaliacoes_funil_produtos: {
    remoto: "funil_produtos",
    description: "Funil de cada produto nos últimos 30 dias (Google Analytics, em peças, não pessoas): visualizações → carrinho → checkout → compras, % de cada etapa, receita e avaliações. Use para achar produto muito visto que não vai pro carrinho ou carrinho que não vira compra.",
    properties: {
      ordenar: { type: "string", description: "Ordem. Padrão: visualizacoes.", enum: ["visualizacoes", "carrinho", "compras", "receita", "pior_visto_carrinho", "pior_carrinho_compra"] },
      limite: { type: "number", description: "Quantos produtos (1 a 200). Padrão: 30." },
      minimo_visualizacoes: { type: "number", description: "Ignora produtos com menos visualizações. Padrão: 50." },
      busca: { type: "string", description: "Filtra pelo nome do produto." },
    },
  },
  avaliacoes_funil_por_que_vende: {
    remoto: "funil_por_que_vende",
    description: "Relatório Funil: por que vende — média da loja em cada etapa, cada produto acima/abaixo dela com a leitura do problema, o que os produtos de cima têm de diferente na página (fotos, descrição, vídeo, avaliações, preço, estoque) e desempenho por família (canelado, flare, macacão...).",
    properties: {
      minimo_visualizacoes: { type: "number", description: "Só produtos com pelo menos isso de visualizações. Padrão: 200." },
      so_produtos: { type: "string", description: "Filtro. Padrão: todos.", enum: ["todos", "abaixo_carrinho", "abaixo_compra", "campeoes"] },
      limite_produtos: { type: "number", description: "Quantos produtos (0 a 300). Padrão: 40." },
    },
  },
  avaliacoes_melhorias: {
    remoto: "melhorias_por_produto",
    description: "Relatório Melhorias por produto: por que cada produto não vende como deveria e o que fazer (prova social, fotos, vídeo, descrição, preço, estoque, dúvidas, reclamações), do que mais perde venda para o que menos.",
    properties: {
      limite: { type: "number", description: "Quantos produtos (1 a 100). Padrão: 15." },
      area: { type: "string", description: "Só uma área. Padrão: todas.", enum: ["todas", "prova social", "fotos", "descrição", "dúvidas", "reclamações", "preço", "carrinho", "estoque"] },
      produto_id: { type: "number", description: "Só um produto (ID da Tray)." },
    },
  },
  avaliacoes_historico: {
    remoto: "historico_melhorias",
    description: "Relatório Histórico de melhorias: o que foi feito nos produtos (registrado no painel ou percebido pelo sistema: fotos, descrição, preço, estoque) com o funil antes e 30 dias depois, e a evolução semanal da loja.",
    properties: { limite: { type: "number", description: "Quantos registros (1 a 300). Padrão: 60." } },
  },
  avaliacoes_buscar_produto: {
    remoto: "buscar_produto",
    description: "Acha produtos do sistema de avaliações pelo nome e devolve o ID (o mesmo da Tray), para usar nas outras ferramentas de avaliações.",
    properties: { termo: { type: "string", description: "Parte do nome do produto (mínimo 2 letras)." } },
    required: ["termo"],
  },
  avaliacoes_produto: {
    remoto: "detalhe_produto",
    description: "Tudo das avaliações de um produto: nota e distribuição, caimento, funil do Google Analytics, últimas avaliações (com resposta da loja e assuntos) e perguntas respondidas.",
    properties: { produto_id: { type: "number", description: "ID do produto (Tray). Use avaliacoes_buscar_produto para achar." } },
    required: ["produto_id"],
  },
  avaliacoes_listar: {
    remoto: "listar_avaliacoes",
    description: "Lista avaliações de produto com filtros (25 por página). status pending = aguardando aprovação.",
    properties: {
      status: { type: "string", description: "Padrão: pending.", enum: ["pending", "approved", "rejected", "all"] },
      termo: { type: "string", description: "Texto para procurar nas avaliações." },
      produto_id: { type: "number", description: "Só um produto." },
      nota: { type: "number", description: "Só uma nota (1 a 5)." },
      pagina: { type: "number", description: "Página. Padrão: 1." },
    },
  },
  avaliacoes_perguntas: {
    remoto: "listar_perguntas",
    description: "Perguntas das clientes nos produtos. status pending = ainda sem resposta.",
    properties: {
      status: { type: "string", description: "Padrão: pending.", enum: ["pending", "approved", "rejected", "all"] },
      limite: { type: "number", description: "Quantas (1 a 200). Padrão: 50." },
    },
  },
  avaliacoes_da_loja: {
    remoto: "avaliacoes_da_loja",
    description: "Avaliações da loja (atendimento, entrega, NPS, voltaria a comprar).",
    properties: { status: { type: "string", description: "Padrão: all.", enum: ["pending", "approved", "rejected", "all"] } },
  },
  avaliacoes_buscas: {
    remoto: "buscas_das_clientes",
    description: "O que as clientes digitaram ou falaram (voz) na busca de dúvidas da página de produto. Bom para ideias de vídeo e para achar dúvida sem resposta.",
    properties: {
      dias: { type: "number", description: "Período em dias. Padrão: 30." },
      so_sem_resposta: { type: "boolean", description: "Só as buscas que não acharam resposta. Padrão: false." },
    },
  },
};

export const AVALIACOES_TOOLS: McpTool[] = Object.entries(DEFS).map(([name, d]) => ({
  name,
  description: `${d.description} (Sistema de avaliações; somente leitura.)`,
  inputSchema: { type: "object", properties: { loja: LOJA, ...(d.properties || {}) }, ...(d.required ? { required: d.required } : {}) },
}));

export const isAvaliacoesTool = (name: string) => Object.prototype.hasOwnProperty.call(DEFS, name);

// Defesa extra: mesmo que la mude, contato de cliente nao sai por aqui.
const PII = new Set(["email", "author_email", "customer_email", "phone", "telefone", "cpf", "ip", "ip_hash"]);
function scrub(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !PII.has(k)).map(([k, x]) => [k, scrub(x)]));
  return v;
}

// Contato escrito DENTRO do texto (avaliacao, pergunta, mensagem de erro) tambem sai mascarado, e o endereco secreto
// do conector de la nunca volta para a conversa.
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const FONE = /(?<!\d)(?:\+?55[\s-]?)?\(?\d{2}\)?[\s-]?9?\d{4}[\s-]?\d{4}(?!\d)/g;
const SEGREDO = /https?:\/\/[^\s"']*\/api\/mcp\/[^\s"']*/gi;
const ocultar = (s: string) => s.replace(SEGREDO, "[endereço interno]").replace(EMAIL, "[e-mail oculto]").replace(FONE, "[telefone oculto]");

type Rpc = { id?: number | string | null; result?: { protocolVersion?: string; content?: { type: string; text?: string }[]; isError?: boolean }; error?: { message?: string } };

/** Le a resposta JSON-RPC: JSON puro ou eventos SSE (pode vir notificacao antes; vale a mensagem com o id pedido). */
async function lerRpc(r: Response, id: number): Promise<Rpc> {
  const t = await r.text();
  if (!/^\s*(event:|data:|id:|:)/m.test(t)) return JSON.parse(t || "{}") as Rpc;
  const eventos = t.split(/\r?\n\r?\n/).map((bloco) => bloco.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trimStart()).join("\n")).filter(Boolean);
  for (const ev of eventos) {
    try { const m = JSON.parse(ev) as Rpc; if (m && m.id === id) return m; } catch { /* evento que nao e JSON */ }
  }
  throw new Error("Resposta do sistema de avaliações sem o resultado esperado.");
}

/** Repassa uma consulta de leitura ao conector do sistema de avaliações e devolve o texto pronto. */
export async function runAvaliacoesTool(name: string, args: Record<string, unknown>): Promise<string> {
  const def = DEFS[name];
  if (!def) throw new Error(`Ferramenta desconhecida: ${name}`);
  const base = process.env.REVIEWS_MCP_URL;
  if (!base) throw new Error("Conector de avaliações não configurado no app (REVIEWS_MCP_URL).");

  const { loja: lojaArg, ...resto } = args;
  const loja = (lojaArg ?? "bff") as LojaId;
  if (!LOJAS.some((l) => l.id === loja)) throw new Error(`Empresa inválida: ${String(lojaArg)}. Use bff ou moranga.`);
  const url = new URL(base);
  url.searchParams.set("loja", loja);

  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  const post = (body: unknown) => fetch(url, { method: "POST", headers, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(25_000) });

  // Ciclo do protocolo: initialize -> notifications/initialized -> tools/call (com a versao combinada e a sessao, se houver)
  const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "bff-painel", version: "2.0.0" } } });
  if (!init.ok) throw new Error(`Sistema de avaliações não respondeu (${init.status}).`);
  const sid = init.headers.get("mcp-session-id");
  if (sid) headers["mcp-session-id"] = sid;
  const ini = await lerRpc(init, 1);
  if (ini.error || !ini.result) throw new Error("Sistema de avaliações recusou a conexão.");
  if (ini.result.protocolVersion) headers["mcp-protocol-version"] = ini.result.protocolVersion;
  await post({ jsonrpc: "2.0", method: "notifications/initialized" }).catch(() => undefined);

  const r = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: def.remoto, arguments: resto } });
  if (!r.ok) throw new Error(`Sistema de avaliações respondeu ${r.status}.`);
  const j = await lerRpc(r, 2);
  if (j.error) throw new Error(ocultar(j.error.message || "Erro no sistema de avaliações."));
  const texto = (j.result?.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("\n");
  if (j.result?.isError) throw new Error(ocultar(texto || "Erro no sistema de avaliações."));

  let dados: unknown;
  try { dados = JSON.parse(texto); } catch { return ocultar(texto); }
  // Alertas: a lista completa de produtos (167 linhas) e pesada e ja existe em outras ferramentas; aqui fica o que pede acao.
  if (name === "avaliacoes_alertas" && dados && typeof dados === "object") {
    const { products, ...semProdutos } = dados as Record<string, unknown>;
    void products;
    dados = semProdutos;
  }
  // Produto: as perguntas respondidas incluem as ~240 de SEO da categoria (80 KB). Ficam as do produto e as gerais
  // primeiro (as de SEO por ultimo), ate 30, com o total — o bastante para a conversa sem estourar o tamanho.
  if (name === "avaliacoes_produto" && dados && typeof dados === "object") {
    const o = dados as Record<string, unknown>;
    const qa = o.perguntas_respondidas;
    if (Array.isArray(qa) && qa.length > 30) {
      const seo = (x: unknown) => !!(x && typeof x === "object" && (x as { seo?: boolean }).seo);
      o.perguntas_respondidas = [...qa.filter((x) => !seo(x)), ...qa.filter(seo)].slice(0, 30);
      o.perguntas_respondidas_total = qa.length;
      o.observacao_perguntas = `Mostrando 30 de ${qa.length} perguntas respondidas (as de SEO da categoria por último).`;
    }
  }
  const empresa = LOJAS.find((l) => l.id === loja)!.nome;
  return `Empresa: ${empresa}\n${ocultar(JSON.stringify(scrub(dados), null, 1))}`;
}
