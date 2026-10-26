import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { exigirAdmin } from "@/lib/igAdmin";

// Começa o login do TikTok (Login Kit v2): /api/social/tiktok/conectar?loja=bff  ou  ?loja=moranga
// Para app web a TikTok não exige PKCE (só mobile/desktop), então usamos só o state anti-CSRF.
const ESCOPOS = ["user.info.basic", "video.publish", "video.upload"].join(","); // separados por vírgula

export async function GET(req: NextRequest) {
  const ok = await exigirAdmin();
  if (ok.erro) return ok.erro;

  const loja = req.nextUrl.searchParams.get("loja");
  if (loja !== "bff" && loja !== "moranga") return NextResponse.json({ error: "Use ?loja=bff ou ?loja=moranga" }, { status: 400 });
  const key = process.env.TIKTOK_CLIENT_KEY;
  if (!key) return NextResponse.json({ error: "TIKTOK_CLIENT_KEY não configurado" }, { status: 500 });

  const state = `${crypto.randomUUID()}.${loja}`;
  const url = new URL("https://www.tiktok.com/v2/auth/authorize/");
  url.searchParams.set("client_key", key);
  url.searchParams.set("scope", ESCOPOS);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", process.env.TIKTOK_REDIRECT_URI ?? `${req.nextUrl.origin}/api/social/tiktok/callback`);
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("tiktok_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/social/tiktok" });
  return res;
}
