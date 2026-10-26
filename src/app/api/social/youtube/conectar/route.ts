import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { exigirAdmin } from "@/lib/igAdmin";
import { urlAutorizacao, youtubeConfigurado } from "@/lib/social/youtube";

// Começa a ligação de um canal do YouTube à loja: /api/social/youtube/conectar?loja=bff  ou  ?loja=moranga
// No Google, escolha o canal (ou a conta de marca) certo na tela de consentimento.
export async function GET(req: NextRequest) {
  const a = await exigirAdmin();
  if (a.erro) return a.erro;

  const loja = req.nextUrl.searchParams.get("loja");
  if (loja !== "bff" && loja !== "moranga") {
    return NextResponse.json({ error: "Use ?loja=bff ou ?loja=moranga" }, { status: 400 });
  }
  if (!youtubeConfigurado()) {
    return NextResponse.json({ error: "GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET não configurados" }, { status: 500 });
  }

  const state = `${crypto.randomUUID()}.${loja}`;
  const url = urlAutorizacao(`${req.nextUrl.origin}/api/social/youtube/callback`, state);

  const res = NextResponse.redirect(url);
  res.cookies.set("yt_oauth_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/social/youtube" });
  return res;
}
