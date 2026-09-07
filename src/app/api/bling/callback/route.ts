import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeBlingCodeForToken } from "@/lib/blingMcp";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const voltar = (status: "ok" | "erro", detail?: string) => {
    const url = new URL("/areas/financas", req.nextUrl.origin);
    url.searchParams.set("bling", status);
    if (detail) url.searchParams.set("detail", detail);
    return NextResponse.redirect(url);
  };

  if (error) return voltar("erro", error);
  if (!code || !state) return voltar("erro", "parametros_ausentes");

  let decodedState: { userId?: string; codeVerifier?: string };
  try {
    decodedState = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return voltar("erro", "state_invalido");
  }
  if (decodedState.userId !== session.user.id || !decodedState.codeVerifier) {
    return voltar("erro", "state_nao_confere");
  }

  try {
    const redirectUri = `${req.nextUrl.origin}/api/bling/callback`;
    await exchangeBlingCodeForToken(code, decodedState.codeVerifier, redirectUri, session.user.id);
    return voltar("ok");
  } catch (e) {
    return voltar("erro", e instanceof Error ? e.message : "falha_desconhecida");
  }
}
