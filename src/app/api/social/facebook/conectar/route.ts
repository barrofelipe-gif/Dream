import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { exigirAdmin } from "@/lib/igAdmin";
import { FB_ESCOPOS, FB_GRAPH_VERSION } from "@/lib/social/facebook";

// Começa o login do Facebook para ligar as Páginas à loja:
// /api/social/facebook/conectar?loja=bff  ou  ?loja=moranga
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;

  const loja = req.nextUrl.searchParams.get("loja");
  if (loja !== "bff" && loja !== "moranga") {
    return NextResponse.json({ error: "Use ?loja=bff ou ?loja=moranga" }, { status: 400 });
  }
  const appId = process.env.FB_APP_ID;
  if (!appId) return NextResponse.json({ error: "FB_APP_ID não configurado" }, { status: 500 });

  const state = `${crypto.randomUUID()}.${loja}`;
  const url = new URL(`https://www.facebook.com/${FB_GRAPH_VERSION}/dialog/oauth`);
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", `${req.nextUrl.origin}/api/social/facebook/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", FB_ESCOPOS.join(","));
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("fb_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/social/facebook" });
  return res;
}
