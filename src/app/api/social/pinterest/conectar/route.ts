import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { exigirAdmin } from "@/lib/igAdmin";
import { PINTEREST_ESCOPOS } from "@/lib/social/pinterest";

// Inicia o OAuth do Pinterest: /api/social/pinterest/conectar?loja=bff|moranga
export async function GET(req: NextRequest) {
  const ad = await exigirAdmin();
  if (ad.erro) return ad.erro;

  const loja = req.nextUrl.searchParams.get("loja");
  if (loja !== "bff" && loja !== "moranga") return NextResponse.json({ error: "Use ?loja=bff ou ?loja=moranga" }, { status: 400 });
  const appId = process.env.PINTEREST_APP_ID;
  if (!appId) return NextResponse.json({ error: "PINTEREST_APP_ID não configurado" }, { status: 500 });

  const state = `${crypto.randomUUID()}.${loja}`;
  const url = new URL("https://www.pinterest.com/oauth/");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", `${req.nextUrl.origin}/api/social/pinterest/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", PINTEREST_ESCOPOS.join(","));
  url.searchParams.set("state", state);

  const res = NextResponse.redirect(url);
  res.cookies.set("pin_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/social/pinterest" });
  return res;
}
