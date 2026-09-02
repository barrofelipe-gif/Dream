import { NextRequest, NextResponse } from "next/server";

/**
 * Metadados do "resource server" (RFC 9728) — aponta pro authorization
 * server que protege o endpoint /api/mcp. É o primeiro arquivo que um
 * cliente OAuth-aware (Claude.ai) busca ao ver um 401 sem WWW-Authenticate
 * explícito, pra descobrir onde fazer login.
 */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  return NextResponse.json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
  });
}
