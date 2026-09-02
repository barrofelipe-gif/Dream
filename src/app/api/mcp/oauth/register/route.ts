import { NextRequest, NextResponse } from "next/server";
import { gerarClientId } from "@/lib/mcpOAuth";

/**
 * Registro dinâmico de cliente OAuth (RFC 7591), bem simplificado: como o
 * painel é de uso pessoal (um dono só, sem multi-tenant de clientes OAuth
 * de verdade), não persiste nada — só devolve um client_id novo a cada
 * chamada. A validação real de "quem pode usar" acontece depois, no login
 * exigido em /api/mcp/oauth/authorize, não aqui.
 */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // corpo vazio/ inválido — segue com valores default
  }

  const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];

  return NextResponse.json(
    {
      client_id: gerarClientId(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      redirect_uris: redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: typeof body.client_name === "string" ? body.client_name : "Cliente MCP",
    },
    { status: 201 }
  );
}
