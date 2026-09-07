import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/auth";
import { getBlingAuthorizeUrl, gerarPkce } from "@/lib/blingMcp";

/**
 * Inicia a conexão com o bling-mcp-server já existente — o painel entra
 * como mais um cliente OAuth desse servidor (igual o Claude.ai já faz),
 * pegando seu próprio grant independente. Não mexe na autorização com a
 * Bling em si nem no grant que o Claude.ai usa.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { codeVerifier, codeChallenge } = gerarPkce();
  // O code_verifier viaja dentro do próprio "state" (assim como o userId já
  // viaja no state do fluxo do Gmail nesse mesmo projeto) — evita precisar
  // de cookie só pra sobreviver ao redirect de ida e volta.
  const state = Buffer.from(
    JSON.stringify({ userId: session.user.id, nonce: crypto.randomUUID(), codeVerifier })
  ).toString("base64url");

  const redirectUri = `${req.nextUrl.origin}/api/bling/callback`;
  const url = getBlingAuthorizeUrl(redirectUri, state, codeChallenge);
  return NextResponse.redirect(url);
}
