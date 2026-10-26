import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/auth";

// Começa o login do Instagram (Instagram Business Login) para ligar uma conta
// à loja: /api/instagram/connect?loja=bff  ou  ?loja=moranga
// O token nunca passa pelo navegador nem pelo chat: o callback troca o código
// e grava criptografado.
const SCOPES = [
  "instagram_business_basic",
  "instagram_business_manage_messages",
  "instagram_business_manage_comments",
].join(",");

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const loja = req.nextUrl.searchParams.get("loja");
  if (loja !== "bff" && loja !== "moranga") {
    return NextResponse.json({ error: "Use ?loja=bff ou ?loja=moranga" }, { status: 400 });
  }
  const appId = process.env.IG_APP_ID;
  if (!appId) return NextResponse.json({ error: "IG_APP_ID não configurado" }, { status: 500 });

  const state = `${crypto.randomUUID()}.${loja}`;
  const url = new URL("https://www.instagram.com/oauth/authorize");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", `${req.nextUrl.origin}/api/instagram/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("ig_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/instagram" });
  return res;
}
