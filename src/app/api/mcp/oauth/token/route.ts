import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { verificaPkce } from "@/lib/mcpOAuth";

/**
 * Troca o code (ou refresh_token) pelo access_token.
 *
 * O access_token devolvido é sempre o MCP_TOKEN estático — o mesmo que
 * /api/mcp já validava por Authorization/X-Api-Key. O handshake OAuth aqui
 * só decide QUANDO entregar esse token (depois do login no painel), não cria
 * um sistema de token paralelo.
 */

const UM_ANO_SEGUNDOS = 60 * 60 * 24 * 365;

async function lerCorpo(req: NextRequest): Promise<Record<string, string>> {
  const tipo = req.headers.get("content-type") ?? "";
  if (tipo.includes("application/json")) {
    try {
      const j = await req.json();
      return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v)]));
    } catch {
      return {};
    }
  }
  const form = await req.formData();
  return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}

function erroOAuth(codigo: string, descricao: string, status = 400) {
  return NextResponse.json({ error: codigo, error_description: descricao }, { status });
}

function tokenValido(a: string, b: string): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function POST(req: NextRequest) {
  const mcpToken = process.env.MCP_TOKEN;
  if (!mcpToken) return erroOAuth("server_error", "MCP_TOKEN não configurado no servidor.", 500);

  const body = await lerCorpo(req);
  const grantType = body.grant_type;

  if (grantType === "refresh_token") {
    if (!tokenValido(body.refresh_token ?? "", mcpToken)) {
      return erroOAuth("invalid_grant", "refresh_token inválido.");
    }
    return NextResponse.json({
      access_token: mcpToken,
      token_type: "Bearer",
      expires_in: UM_ANO_SEGUNDOS,
      refresh_token: mcpToken,
    });
  }

  if (grantType !== "authorization_code") {
    return erroOAuth("unsupported_grant_type", `grant_type '${grantType}' não suportado.`);
  }

  const code = body.code;
  const codeVerifier = body.code_verifier;
  const redirectUri = body.redirect_uri;
  if (!code || !codeVerifier || !redirectUri) {
    return erroOAuth("invalid_request", "Faltou code, code_verifier ou redirect_uri.");
  }

  const registro = await prisma.mcpAuthCode.findUnique({ where: { code } });
  if (!registro) return erroOAuth("invalid_grant", "code desconhecido.");
  if (registro.used) return erroOAuth("invalid_grant", "code já foi usado.");
  if (registro.expiresAt < new Date()) return erroOAuth("invalid_grant", "code expirado.");
  if (registro.redirectUri !== redirectUri) return erroOAuth("invalid_grant", "redirect_uri não confere.");
  if (!verificaPkce(codeVerifier, registro.codeChallenge, registro.codeChallengeMethod)) {
    return erroOAuth("invalid_grant", "code_verifier não confere com o code_challenge.");
  }

  // Uso único: marca antes de responder, mesmo que a resposta falhe depois.
  await prisma.mcpAuthCode.update({ where: { code }, data: { used: true } });

  return NextResponse.json({
    access_token: mcpToken,
    token_type: "Bearer",
    expires_in: UM_ANO_SEGUNDOS,
    refresh_token: mcpToken,
    scope: "",
  });
}
