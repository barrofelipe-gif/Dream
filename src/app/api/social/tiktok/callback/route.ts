import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { salvarConta } from "@/lib/social/contas";

function page(msg: string, ok: boolean) {
  const seguro = msg.replace(/[<>&]/g, "");
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>TikTok</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>${ok ? "Conectado" : "Atenção"}: ${seguro}</h2><p><a href="/">Voltar ao painel</a></p>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest) {
  const adm = await exigirAdmin();
  if (adm.erro) return adm.erro;

  const p = req.nextUrl.searchParams;
  if (p.get("error")) return page(`O TikTok recusou: ${p.get("error_description") ?? p.get("error")}`, false);
  const code = p.get("code");
  const state = p.get("state");
  const cookieState = req.cookies.get("tiktok_oauth_state")?.value;
  if (!code || !state || state !== cookieState) return page("Pedido inválido ou expirado. Comece de novo.", false);
  const loja = state.split(".")[1];
  if (loja !== "bff" && loja !== "moranga") return page("Loja inválida.", false);

  const key = process.env.TIKTOK_CLIENT_KEY;
  const secret = process.env.TIKTOK_CLIENT_SECRET;
  if (!key || !secret) return page("TIKTOK_CLIENT_KEY/TIKTOK_CLIENT_SECRET não configurados.", false);
  const redirectUri = process.env.TIKTOK_REDIRECT_URI ?? `${req.nextUrl.origin}/api/social/tiktok/callback`;

  try {
    // 1) código -> tokens (searchParams já devolve o code decodificado, como a TikTok exige)
    const tk = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_key: key, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: redirectUri }),
    });
    const t = (await tk.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      open_id?: string;
      scope?: string;
      expires_in?: number;
      refresh_expires_in?: number;
      error?: string;
      error_description?: string;
    } | null;
    if (!tk.ok || !t?.access_token || !t.open_id) throw new Error(`troca do código: ${t?.error_description ?? t?.error ?? tk.status}`);

    // 2) perfil
    const me = await fetch("https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,avatar_url", {
      headers: { Authorization: `Bearer ${t.access_token}` },
    });
    const mj = (await me.json().catch(() => null)) as { data?: { user?: { display_name?: string; avatar_url?: string } } } | null;
    const u = mj?.data?.user;

    // 3) grava (criptografado pelo salvarConta)
    await salvarConta({
      rede: "tiktok",
      loja,
      externoId: t.open_id,
      nome: u?.display_name ?? null,
      username: null, // o @ só vem com o escopo user.info.profile; o adaptador o pega via creator_info ao publicar
      fotoUrl: u?.avatar_url ?? null,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiraEm: new Date(Date.now() + (t.expires_in ?? 86400) * 1000),
      escopos: t.scope ?? "",
      extra: { refreshExpiraEm: new Date(Date.now() + (t.refresh_expires_in ?? 31536000) * 1000).toISOString() },
    });

    const res = page(`TikTok ${u?.display_name ?? ""} conectado à loja ${loja}.`, true);
    res.cookies.delete({ name: "tiktok_oauth_state", path: "/api/social/tiktok" });
    return res;
  } catch (err) {
    console.error("[tiktok-callback]", err);
    return page(`Falha ao conectar: ${(err as Error).message}`, false);
  }
}
