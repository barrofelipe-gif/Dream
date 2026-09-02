import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

/**
 * Mini fluxo OAuth (authorization_code + PKCE) só pra satisfazer o conector
 * personalizado do Claude.ai.
 *
 * Por quê: testado na prática — quando o servidor MCP exige só um cabeçalho
 * custom (Authorization ou X-Api-Key) configurado na tela do conector, o
 * Claude.ai não manda esse cabeçalho nas chamadas reais (confirmado pelo
 * log de acesso: toda tentativa chegava sem credencial). Quando o servidor
 * fala OAuth de verdade, o Claude.ai gerencia o token sozinho e ele chega
 * certinho no Authorization — esse é o caminho suportado de fato.
 *
 * A "senha" continua sendo o login normal do painel: /api/mcp/oauth/authorize
 * fica atrás do middleware de sessão (NextAuth) — só quem já está logado no
 * painel consegue autorizar um cliente novo. O access_token devolvido no
 * final do handshake é sempre o mesmo MCP_TOKEN estático que a API já
 * validava por cabeçalho — o OAuth aqui é só a "entrega assistida" desse
 * token pro Claude, não um sistema de token novo.
 */

export function gerarCode(): string {
  return randomBytes(32).toString("base64url");
}

export function gerarClientId(): string {
  return randomBytes(16).toString("hex");
}

/** PKCE: confere code_verifier contra o code_challenge salvo na autorização. */
export function verificaPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  if (method === "plain") return codeVerifier === codeChallenge;
  // S256 é o único método que o /.well-known anuncia — o padrão do MCP.
  const hash = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(hash);
  const b = Buffer.from(codeChallenge);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Redirect URI só http(s) — evita esquemas exóticos (javascript:, data:, etc.). */
export function redirectUriValida(uri: string): boolean {
  try {
    const u = new URL(uri);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

export const MCP_OAUTH_EXPIRACAO_CODE_MS = 5 * 60 * 1000; // 5min, uso único
