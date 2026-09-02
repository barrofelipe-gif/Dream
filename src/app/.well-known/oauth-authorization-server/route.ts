import { NextRequest, NextResponse } from "next/server";

/**
 * Metadados do authorization server (RFC 8414). Descreve os 3 endpoints do
 * mini fluxo OAuth em src/app/api/mcp/oauth/* — registro dinâmico de
 * cliente, autorização (atrás do login do painel) e troca de código por
 * token.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/api/mcp/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
  });
}
