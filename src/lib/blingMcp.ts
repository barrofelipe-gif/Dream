import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";

/**
 * Cliente do bling-mcp-server já existente (projeto separado na Vercel:
 * https://bling-mcp-server.vercel.app — contas a pagar/receber, pedidos de
 * venda e fluxo de caixa projetado, direto da Bling).
 *
 * Em vez de duplicar a autorização com a Bling (outro app cadastrado, outro
 * projeto na Vercel), o painel entra como mais um "cliente" OAuth desse
 * servidor — exatamente como o Claude.ai já faz quando você conecta o
 * conector por lá. Isso gera um grant PRÓPRIO e independente: não toca no
 * grant que o Claude.ai usa, então conectar por aqui não quebra a conexão
 * que já existe.
 *
 * O servidor já fala o protocolo padrão (RFC 8414 + DCR + PKCE) — o mesmo
 * que o /api/mcp/oauth do nosso próprio servidor implementa do lado
 * "provedor". Aqui é o mesmo desenho, só que do lado "cliente".
 */

const BLING_MCP_BASE = "https://bling-mcp-server.vercel.app";
const CLIENT_ID = "painel-bff"; // o servidor aceita qualquer client_id (token_endpoint_auth_method: none)

export function getBlingAuthorizeUrl(redirectUri: string, state: string, codeChallenge: string): string {
  const url = new URL(`${BLING_MCP_BASE}/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export function gerarPkce() {
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  return { codeVerifier, codeChallenge };
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

async function trocarPorToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${BLING_MCP_BASE}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
  if (!res.ok) {
    const texto = await res.text().catch(() => "");
    throw new Error(`bling-mcp-server recusou o token: HTTP ${res.status} ${texto}`);
  }
  return res.json();
}

async function salvarConexao(tokens: TokenResponse, connectedByUserId?: string) {
  await prisma.blingConnection.deleteMany({}); // só existe 1 conexão — a mais recente vence
  await prisma.blingConnection.create({
    data: {
      accessToken: encrypt(tokens.access_token),
      refreshToken: encrypt(tokens.refresh_token),
      accessTokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      connectedByUserId,
    },
  });
}

export async function exchangeBlingCodeForToken(
  code: string,
  codeVerifier: string,
  redirectUri: string,
  connectedByUserId?: string
) {
  const tokens = await trocarPorToken({
    grant_type: "authorization_code",
    code,
    code_verifier: codeVerifier,
    redirect_uri: redirectUri,
    client_id: CLIENT_ID,
  });
  await salvarConexao(tokens, connectedByUserId);
}

async function renovarToken(refreshToken: string): Promise<TokenResponse> {
  return trocarPorToken({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/** Retorna um access_token válido, renovando (e regravando, já que o refresh_token da Bling é rotativo) se preciso. */
export async function getValidBlingAccessToken(): Promise<string> {
  const conn = await prisma.blingConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!conn) throw new Error("Bling ainda não conectado neste painel.");

  const margemMs = 2 * 60 * 1000;
  if (conn.accessTokenExpiresAt.getTime() - margemMs > Date.now()) {
    return decrypt(conn.accessToken);
  }

  const tokens = await renovarToken(decrypt(conn.refreshToken));
  await salvarConexao(tokens);
  return tokens.access_token;
}

/** "Hoje" e "daqui a `dias` dias" em AAAA-MM-DD — função só pra não deixar
 * `new Date()`/`Date.now()` soltos no corpo de um componente (o lint novo
 * trata isso como impureza de render). */
export function janelaDeDias(dias: number): { hoje: string; fim: string } {
  const agora = Date.now();
  return {
    hoje: new Date(agora).toISOString().slice(0, 10),
    fim: new Date(agora + dias * 86400000).toISOString().slice(0, 10),
  };
}

export async function isBlingConectado(): Promise<boolean> {
  const conn = await prisma.blingConnection.findFirst({ select: { id: true } });
  return !!conn;
}

/**
 * Códigos numéricos de "situacao" que a Bling devolve nos registros de
 * contas a pagar/receber (não documentado publicamente — confirmado
 * testando contra a API real): 1 = em aberto, 2 = pago/recebido,
 * 4 = cancelado. Qualquer outro código é tratado como "ainda conta".
 */
const SITUACAO_QUITADA = new Set([2, 4]);
function estaQuitada(situacao: unknown): boolean {
  return typeof situacao === "number" && SITUACAO_QUITADA.has(situacao);
}

// A ferramenta bling_contas_pagar/receber trunca a resposta em 25.000
// caracteres (bling-mcp-server) — com nome de contato resolvido, 100
// registros por página estoura isso e devolve um JSON cortado no meio
// (quebra o JSON.parse). 40 por página fica com folga segura.
const PAGE_SIZE = 40;

interface ContaBling {
  id: number;
  situacao: number;
  vencimento: string;
  valor: number;
  contato?: { id: number; nome?: string };
}

export interface FornecedorDespesa {
  nome: string;
  total: number;
  ocorrencias: number;
  recorrente: boolean;
  proximoVencimento: string;
}

export interface DespesasAbertas {
  periodo: { dataInicial: string; dataFinal: string };
  total: number;
  porFornecedor: FornecedorDespesa[];
  truncado: boolean;
}

/**
 * Contas a pagar em aberto na janela pedida, agrupadas por fornecedor.
 *
 * IMPORTANTE: a Bling tem categorização própria de despesa (ex.: "despesa
 * fixa" vs "despesa variável"), mas o app cadastrado ("Fluxo de Caixa MCP")
 * ainda não tem o escopo "Categorias de Receitas e Despesas" liberado — a
 * API responde 403 insufficient_scope pra esse endpoint. Até isso ser
 * liberado (no cadastro do app, no painel de apps da Bling) e reconectado,
 * uso uma aproximação: fornecedor que aparece 2+ vezes na janela é marcado
 * como "recorrente" (proxy razoável pra despesa fixa/parcelada), mas não é
 * a categoria oficial.
 */
export async function buscarDespesasAbertas(diasJanela = 60): Promise<DespesasAbertas> {
  const { hoje, fim } = janelaDeDias(diasJanela);
  const porFornecedor = new Map<string, { total: number; ocorrencias: number; proximoVencimento: string }>();
  let truncado = false;

  for (let pagina = 1; pagina <= 5; pagina++) {
    const resp = await chamarFerramentaBling<{ count: number; data: ContaBling[] }>("bling_contas_pagar", {
      dataInicialVencimento: hoje,
      dataFinalVencimento: fim,
      pagina,
      limite: PAGE_SIZE,
    });
    const abertas = resp.data.filter((c) => !estaQuitada(c.situacao));
    for (const c of abertas) {
      const nome = c.contato?.nome ?? `Fornecedor #${c.contato?.id ?? "desconhecido"}`;
      const cur = porFornecedor.get(nome) ?? { total: 0, ocorrencias: 0, proximoVencimento: c.vencimento };
      cur.total += c.valor;
      cur.ocorrencias += 1;
      if (c.vencimento < cur.proximoVencimento) cur.proximoVencimento = c.vencimento;
      porFornecedor.set(nome, cur);
    }
    if (resp.data.length < PAGE_SIZE) break;
    if (pagina === 5) truncado = true;
    await sleep(400);
  }

  const lista: FornecedorDespesa[] = [...porFornecedor.entries()]
    .map(([nome, v]) => ({
      nome,
      total: Math.round(v.total * 100) / 100,
      ocorrencias: v.ocorrencias,
      recorrente: v.ocorrencias >= 2,
      proximoVencimento: v.proximoVencimento,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    periodo: { dataInicial: hoje, dataFinal: fim },
    total: Math.round(lista.reduce((s, f) => s + f.total, 0) * 100) / 100,
    porFornecedor: lista,
    truncado,
  };
}

export interface ContaReceberAberta {
  nome: string;
  valor: number;
  vencimento: string;
  atrasada: boolean;
}

export interface ContasReceberAbertas {
  periodo: { dataInicial: string; dataFinal: string };
  totalAtrasado: number;
  totalAVencer: number;
  itens: ContaReceberAberta[];
  truncado: boolean;
}

/** Contas a receber em aberto — separadas em atrasadas (vencimento < hoje) e a vencer, pra régua de cobrança. */
export async function buscarContasReceberAbertas(diasJanela = 30): Promise<ContasReceberAbertas> {
  const { hoje } = janelaDeDias(0);
  const { fim } = janelaDeDias(diasJanela);
  // também busca o que já venceu nos últimos 90 dias e continua em aberto (inadimplência)
  const { fim: inicioAtraso } = janelaDeDias(-90);

  const itens: ContaReceberAberta[] = [];
  let truncado = false;
  for (let pagina = 1; pagina <= 5; pagina++) {
    const resp = await chamarFerramentaBling<{ count: number; data: ContaBling[] }>("bling_contas_receber", {
      dataInicialVencimento: inicioAtraso,
      dataFinalVencimento: fim,
      pagina,
      limite: PAGE_SIZE,
    });
    for (const c of resp.data.filter((c) => !estaQuitada(c.situacao))) {
      itens.push({
        nome: c.contato?.nome ?? `Cliente #${c.contato?.id ?? "desconhecido"}`,
        valor: c.valor,
        vencimento: c.vencimento,
        atrasada: c.vencimento < hoje,
      });
    }
    if (resp.data.length < PAGE_SIZE) break;
    if (pagina === 5) truncado = true;
    await sleep(400);
  }

  itens.sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  return {
    periodo: { dataInicial: inicioAtraso, dataFinal: fim },
    totalAtrasado: Math.round(itens.filter((i) => i.atrasada).reduce((s, i) => s + i.valor, 0) * 100) / 100,
    totalAVencer: Math.round(itens.filter((i) => !i.atrasada).reduce((s, i) => s + i.valor, 0) * 100) / 100,
    itens,
    truncado,
  };
}

export interface ProjecaoJanela {
  dias: number;
  totalEntradas: number;
  totalSaidas: number;
  saldoFinalProjetado: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Projeta o fluxo de caixa Bling (contas a pagar/receber) em 3 janelas —
 * 30/60/90 dias — pra visão de curto/médio prazo.
 *
 * Sequencial, não em paralelo: cada chamada de bling_fluxo_caixa já dispara
 * 2 requisições simultâneas pro lado da Bling (contas a pagar + a receber),
 * e a Bling limita a 3 req/s por app — 3 janelas em paralelo estourava isso
 * e voltava 429.
 */
export async function buscarProjecaoMultiJanela(): Promise<ProjecaoJanela[]> {
  const janelas = [30, 60, 90];
  const resultados: ProjecaoJanela[] = [];
  for (const dias of janelas) {
    const { hoje, fim } = janelaDeDias(dias);
    const r = await chamarFerramentaBling<{ totalEntradas: number; totalSaidas: number; saldoFinalProjetado: number }>(
      "bling_fluxo_caixa",
      { dataInicial: hoje, dataFinal: fim, granularidade: "mes" }
    );
    resultados.push({ dias, totalEntradas: r.totalEntradas, totalSaidas: r.totalSaidas, saldoFinalProjetado: r.saldoFinalProjetado });
    if (dias !== janelas[janelas.length - 1]) await sleep(400);
  }
  return resultados;
}

interface McpToolResult {
  content?: { type: string; text: string }[];
  isError?: boolean;
}

/** Chama uma ferramenta do bling-mcp-server (contas_pagar, contas_receber, pedidos_vendas, fluxo_caixa, api_request). */
export async function chamarFerramentaBling<T = unknown>(
  nome: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const token = await getValidBlingAccessToken();
  const res = await fetch(`${BLING_MCP_BASE}/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      // O SDK oficial de MCP (StreamableHTTPServerTransport, usado pelo
      // bling-mcp-server) exige esse Accept — sem ele responde 406 (achado
      // testando contra o servidor real).
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: nome, arguments: args },
    }),
  });
  if (!res.ok) {
    throw new Error(`bling-mcp-server HTTP ${res.status} ao chamar ${nome}`);
  }
  const json = (await res.json()) as { result?: McpToolResult; error?: { message: string } };
  if (json.error) throw new Error(`bling-mcp-server: ${json.error.message}`);
  const texto = json.result?.content?.[0]?.text ?? "{}";
  if (json.result?.isError) throw new Error(`Ferramenta ${nome} retornou erro: ${texto}`);
  try {
    return JSON.parse(texto) as T;
  } catch {
    // A ferramenta trunca a resposta em 25.000 caracteres — se ainda assim
    // vier truncada, JSON.parse quebra no meio. Erro claro em vez de um
    // SyntaxError opaco: quem chamou sabe que precisa pedir menos por vez
    // (página menor / janela de data mais curta).
    throw new Error(`bling-mcp-server: resposta de ${nome} truncada ou inválida — peça menos itens por página.`);
  }
}
