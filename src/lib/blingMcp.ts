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
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
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
  return JSON.parse(texto) as T;
}
