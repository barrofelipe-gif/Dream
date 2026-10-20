import "server-only";
import type { McpTool } from "@/lib/mcpTools";
import { LOJAS, type LojaId } from "@/lib/avaliacoes";

/**
 * Avaliações (BFF e Moranga) dentro do conector MCP do app.
 *
 * O sistema de avaliações tem o próprio conector MCP (ferramentas prontas, que leem direto do banco dele e já
 * tiram e-mail, telefone e IP). Aqui o app repassa para lá, por uma LISTA FECHADA (DEFS):
 *  - leitura (relatórios, panorama, listas);
 *  - edição pedida pelo Felipe em 19/10/2026 (escrita: true): importar planilha com conferência, aprovar/rejeitar/
 *    devolver para a fila, responder avaliação e pergunta, rascunho da IA, registrar melhoria. Essas exigem a
 *    empresa explícita (nada de "padrão bff" numa ação que muda o site) e vão marcadas "ALTERA O SITE".
 * O texto, a nota e a data escritos pela cliente não são editáveis aqui nem no painel.
 *
 *  - REVIEWS_MCP_URL  endereço secreto do conector de lá (https://.../api/mcp/<segredo>). A empresa vai em ?loja=.
 */

const LOJA = {
  type: "string",
  description: "Empresa: bff (BFF Fitness, atacado) ou moranga (Moranga Biquínis, varejo). Padrão nas consultas: bff.",
  enum: LOJAS.map((l) => l.id),
};

type Def = { remoto: string; description: string; properties?: McpTool["inputSchema"]["properties"]; required?: string[]; escrita?: boolean };

const STATUS_ACAO = { type: "string", description: "approved = publicar no site; rejected = rejeitar; pending = tirar do site e devolver para a fila (sem apagar).", enum: ["approved", "rejected", "pending"] };
const IDS = (o: string) => ({ type: "array", items: { type: "number" }, description: `IDs das ${o} (até 500 por vez).` });

// nome aqui -> ferramenta de lá. Só o que está nesta lista é repassado.
const DEFS: Record<string, Def> = {
  avaliacoes_panorama: {
    remoto: "panorama",
    description: "Panorama de ponta a ponta das avaliações numa chamada: avaliações (quantas, nota, fila, compra verificada), loja e reputação, perguntas e buscas sem resposta, pedidos de avaliação e cashback, alertas com a lista de produtos (ID), funil da loja e por família, piores produtos antes do carrinho, os que mais perdem venda e o que fazer, mudanças recentes e moderação. Use primeiro quando pedirem panorama, resumo geral, \"como estamos\" ou análise completa.",
    properties: { dias: { type: "number", description: "Período das avaliações e perguntas. Padrão: 30. O funil é sempre 30 dias." } },
  },
  avaliacoes_importar: {
    remoto: "importar_avaliacoes", escrita: true,
    description: "Sobe uma lista de avaliações (de produto ou da loja), como em Importar e backup do painel. A planilha vai como texto CSV com cabeçalho na 1ª linha (separador ; , ou tab). Produto: id_produto*, nota*, nome*, texto, cidade, data (dd/mm/aaaa), qualidade, conforto, tamanho, recomenda, titulo, email, fotos, resposta_loja, verificado, pedido. Loja: nota*, nome*, texto, cidade, data, entrega, atendimento, email, verificado, pedido. SEMPRE rode antes com conferir=true e mostre o resultado; só grave (conferir=false) depois que o Felipe confirmar. publicar=false (padrão) manda para a fila de aprovação. Até uns 2.000 linhas por vez.",
    properties: {
      tipo: { type: "string", description: "produto ou loja.", enum: ["produto", "loja"] },
      planilha_csv: { type: "string", description: "Conteúdo da planilha em CSV, com o cabeçalho." },
      conferir: { type: "boolean", description: "true = só confere, não grava (padrão). false = grava." },
      publicar: { type: "boolean", description: "true = publica direto no site; false = vai para a fila (padrão)." },
    },
    required: ["loja", "tipo", "planilha_csv"],
  },
  avaliacoes_moderar: {
    remoto: "moderar_avaliacoes", escrita: true,
    description: "Avaliações de PRODUTO: publicar no site (paga o cashback da Bonifiq quando for o caso), rejeitar ou tirar do site e devolver para a fila.",
    properties: { avaliacao_ids: IDS("avaliações"), acao: STATUS_ACAO },
    required: ["loja", "avaliacao_ids", "acao"],
  },
  avaliacoes_moderar_loja: {
    remoto: "moderar_avaliacoes_da_loja", escrita: true,
    description: "Avaliações da LOJA (depoimentos da home e do selo): publicar, rejeitar ou tirar do site e devolver para a fila.",
    properties: { avaliacao_ids: IDS("avaliações da loja"), acao: STATUS_ACAO },
    required: ["loja", "avaliacao_ids", "acao"],
  },
  avaliacoes_responder: {
    remoto: "responder_avaliacao", escrita: true,
    description: "Grava a resposta da loja numa avaliação de produto (aparece abaixo dela no site). Texto vazio apaga a resposta. Só com o texto aprovado pelo Felipe.",
    properties: { avaliacao_id: { type: "number", description: "ID da avaliação." }, resposta: { type: "string", description: "Texto da resposta (até 1.500 letras)." } },
    required: ["loja", "avaliacao_id", "resposta"],
  },
  avaliacoes_responder_pergunta: {
    remoto: "responder_pergunta", escrita: true,
    description: "Publica a resposta da loja numa pergunta de produto (aparece no site na hora). Só com o texto aprovado pelo Felipe.",
    properties: {
      pergunta_id: { type: "number", description: "ID da pergunta." },
      resposta: { type: "string", description: "Texto da resposta." },
      salvar_como_padrao: { type: "string", description: "Também salvar como pergunta padrão: nao (padrão), todos (todos os produtos) ou produto (só este).", enum: ["nao", "todos", "produto"] },
    },
    required: ["loja", "pergunta_id", "resposta"],
  },
  avaliacoes_rejeitar_pergunta: {
    remoto: "rejeitar_pergunta", escrita: true,
    description: "Tira uma pergunta da fila sem publicar (spam, ofensiva, repetida).",
    properties: { pergunta_id: { type: "number", description: "ID da pergunta." } },
    required: ["loja", "pergunta_id"],
  },
  avaliacoes_rascunho_resposta: {
    remoto: "rascunho_resposta_ia", escrita: true,
    description: "Gera um rascunho de resposta para uma pergunta (IA, com descrição do produto e perguntas padrão). NÃO publica: o rascunho fica salvo no painel para revisar.",
    properties: { pergunta_id: { type: "number", description: "ID da pergunta." } },
    required: ["loja", "pergunta_id"],
  },
  avaliacoes_registrar_melhoria: {
    remoto: "registrar_melhoria", escrita: true,
    description: "Anota no Histórico de melhorias algo feito num produto (ex.: \"coloquei 3 fotos novas\", \"pedi avaliação para 40 clientes\"). Só quando o Felipe disser que fez.",
    properties: {
      produto_id: { type: "number", description: "ID do produto (opcional: sem ele vale para a loja toda)." },
      area: { type: "string", description: "Área: prova social, fotos, descrição, preço, estoque, dúvidas, reclamações, carrinho, página, tráfego ou outro." },
      o_que_foi_feito: { type: "string", description: "O que foi feito." },
    },
    required: ["loja", "area", "o_que_foi_feito"],
  },
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
  description: d.escrita
    ? `ALTERA O SITE (sistema de avaliações). Só use quando o Felipe pedir e confirme a empresa e o que vai mudar antes. ${d.description}`
    : `${d.description} (Sistema de avaliações; somente leitura.)`,
  inputSchema: { type: "object", properties: { loja: LOJA, ...(d.properties || {}) }, ...(d.required ? { required: d.required } : {}) },
  annotations: d.escrita ? { readOnlyHint: false, destructiveHint: d.remoto !== "registrar_melhoria" && d.remoto !== "rascunho_resposta_ia", openWorldHint: true } : { readOnlyHint: true, openWorldHint: false },
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
  // Acao que muda o site nunca cai na BFF "por padrao": a empresa tem que vir dita.
  if (def.escrita && lojaArg == null) throw new Error("Diga a empresa (bff ou moranga) antes de alterar o site.");
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
