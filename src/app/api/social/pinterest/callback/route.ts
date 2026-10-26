import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { salvarConta } from "@/lib/social/contas";
import { PINTEREST_ESCOPOS, pinterestBase, pinterestBasic } from "@/lib/social/pinterest";

function pagina(msg: string, ok: boolean) {
  const esc = msg.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Pinterest</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>${ok ? "Pronto" : "Atenção"}: ${esc}</h2><p><a href="/">Voltar ao painel</a></p>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest) {
  const ad = await exigirAdmin();
  if (ad.erro) return ad.erro;

  const p = req.nextUrl.searchParams;
  if (p.get("error")) return pagina(`O Pinterest recusou: ${p.get("error_description") ?? p.get("error")}`, false);
  const code = p.get("code");
  const state = p.get("state");
  if (!code || !state || state !== req.cookies.get("pin_oauth_state")?.value) return pagina("Pedido inválido ou expirado. Comece de novo.", false);
  const loja = state.split(".")[1];
  if (loja !== "bff" && loja !== "moranga") return pagina("Loja inválida.", false);
  if (!process.env.PINTEREST_APP_ID || !process.env.PINTEREST_APP_SECRET) return pagina("PINTEREST_APP_ID/PINTEREST_APP_SECRET não configurados.", false);

  try {
    // 1) código -> tokens (continuous_refresh deixa o refresh token renovável sem limite)
    const tr = await fetch(`${pinterestBase()}/oauth/token`, {
      method: "POST",
      headers: { Authorization: pinterestBasic(), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: `${req.nextUrl.origin}/api/social/pinterest/callback`,
        continuous_refresh: "true",
      }),
    });
    if (!tr.ok) throw new Error(`troca do código: ${tr.status}`);
    const t = (await tr.json()) as { access_token: string; refresh_token?: string; expires_in?: number; scope?: string };

    // 2) quem é a conta
    const me = await fetch(`${pinterestBase()}/user_account`, { headers: { Authorization: `Bearer ${t.access_token}` } });
    if (!me.ok) throw new Error(`perfil: ${me.status}`);
    const u = (await me.json()) as { username?: string; id?: string; account_type?: string; profile_image?: string; business_name?: string };
    const externoId = u.username ?? u.id;
    if (!externoId) throw new Error("o Pinterest não devolveu o nome da conta");

    // 3) grava (tokens criptografados em salvarConta)
    await salvarConta({
      rede: "pinterest",
      loja,
      externoId,
      nome: u.business_name ?? u.username ?? null,
      username: u.username ?? null,
      fotoUrl: u.profile_image ?? null,
      accessToken: t.access_token,
      refreshToken: t.refresh_token ?? null,
      expiraEm: t.expires_in ? new Date(Date.now() + t.expires_in * 1000) : null,
      escopos: t.scope ?? PINTEREST_ESCOPOS.join(","),
      extra: { accountType: u.account_type ?? null, sandbox: process.env.PINTEREST_SANDBOX === "1" },
    });

    const res = pagina(`${u.username ?? externoId} conectada à loja ${loja}.`, true);
    res.cookies.delete("pin_oauth_state");
    return res;
  } catch (err) {
    console.error("[pinterest-callback]", err);
    return pagina(`Falha ao conectar: ${(err as Error).message}`, false);
  }
}
