import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

const GRAPH = `https://graph.instagram.com/${process.env.IG_GRAPH_VERSION ?? "v23.0"}`;
// Eventos que o robô usa: DMs e comentários.
const WEBHOOK_FIELDS = "messages,comments,messaging_postbacks,messaging_seen";

// A mensagem pode trazer texto de fora (error_description vem da URL): escapa o HTML e limita o tamanho.
const escapar = (t: string) =>
  t
    .slice(0, 300)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function page(msg: string, ok: boolean) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Instagram</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>${ok ? "✅" : "⚠️"} ${escapar(msg)}</h2><p><a href="/">Voltar ao painel</a></p>`,
    {
      status: ok ? 200 : 400,
      headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" },
    },
  );
}

export async function GET(req: NextRequest) {
  // Só administrador liga contas. É um redirecionamento do navegador do admin logado (cookie de sessão vai junto),
  // então quem não é admin vê a página de aviso em vez de JSON cru.
  const { erro } = await exigirAdmin();
  if (erro) {
    if (erro.status === 401) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));
    return page("Sem permissão: só administradores conectam contas do Instagram.", false);
  }

  const p = req.nextUrl.searchParams;
  if (p.get("error")) return page(`O Instagram recusou: ${p.get("error_description") ?? p.get("error")}`, false);
  const code = p.get("code");
  const state = p.get("state");
  const cookieState = req.cookies.get("ig_oauth_state")?.value;
  if (!code || !state || state !== cookieState) return page("Pedido inválido ou expirado. Comece de novo.", false);
  const loja = state.split(".")[1];
  if (loja !== "bff" && loja !== "moranga") return page("Loja inválida.", false);

  const appId = process.env.IG_APP_ID;
  const secret = process.env.META_APP_SECRET;
  if (!appId || !secret) return page("IG_APP_ID/META_APP_SECRET não configurados.", false);

  try {
    // 1) código -> token de curta duração
    const short = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: appId,
        client_secret: secret,
        grant_type: "authorization_code",
        redirect_uri: `${req.nextUrl.origin}/api/instagram/callback`,
        code: code.replace(/#_$/, ""),
      }),
    });
    if (!short.ok) throw new Error(`troca do código: ${short.status}`);
    const { access_token: shortToken } = (await short.json()) as { access_token: string };

    // 2) curta -> longa duração (60 dias)
    const long = await fetch(
      `https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(secret)}&access_token=${encodeURIComponent(shortToken)}`,
    );
    if (!long.ok) throw new Error(`token longo: ${long.status}`);
    const { access_token: token } = (await long.json()) as { access_token: string };

    // 3) quem é a conta
    const me = await fetch(`${GRAPH}/me?fields=user_id,username&access_token=${encodeURIComponent(token)}`);
    if (!me.ok) throw new Error(`perfil: ${me.status}`);
    const { user_id, username } = (await me.json()) as { user_id: string; username: string };

    // 4) BFF e Moranga nunca se misturam: entrar com o Instagram de uma marca no botão da outra trocava a loja da conta
    // em silêncio (o robô passava a responder a BFF com as regras da Moranga). O nome do @ decide quando diz a marca;
    // sem marca no nome, uma conta já ligada não muda de loja por aqui.
    const nomeLoja = (l: string) => (l === "bff" ? "BFF" : "Moranga");
    const marcaDoNome = /bff/i.test(username) ? "bff" : /moranga/i.test(username) ? "moranga" : null;
    if (marcaDoNome && marcaDoNome !== loja) {
      return page(`@${username} é o Instagram da ${nomeLoja(marcaDoNome)}. Para conectar a ${nomeLoja(loja)}, saia desse Instagram e entre com o da ${nomeLoja(loja)}. Nada foi alterado.`, false);
    }
    const existente = await prisma.instagramAccount.findUnique({ where: { igUserId: String(user_id) }, select: { loja: true } });
    if (existente && existente.loja !== loja && !marcaDoNome) {
      return page(`@${username} já está ligada à ${nomeLoja(existente.loja)}. Para conectar a ${nomeLoja(loja)}, entre com outro Instagram. Nada foi alterado.`, false);
    }

    // 5) grava (token criptografado)
    // Sem upsert: create falha se outro callback criou a conta no meio (igUserId é único) e o update só vale se a loja
    // não mudou desde a conferência acima — dois pedidos ao mesmo tempo não trocam a loja escondido.
    if (!existente) {
      await prisma.instagramAccount.create({ data: { igUserId: String(user_id), username, loja, accessToken: encrypt(token), active: true } });
    } else {
      const r = await prisma.instagramAccount.updateMany({
        where: { igUserId: String(user_id), loja: existente.loja },
        data: { username, loja, accessToken: encrypt(token), active: true },
      });
      if (r.count === 0) return page("A conta mudou enquanto conectava. Comece de novo.", false);
    }

    // 6) assina os eventos desta conta no webhook do app
    const sub = await fetch(`${GRAPH}/me/subscribed_apps?subscribed_fields=${WEBHOOK_FIELDS}&access_token=${encodeURIComponent(token)}`, { method: "POST" });
    const subOk = sub.ok;

    const res = page(
      `@${username} conectada à loja ${loja}.${subOk ? "" : " (A assinatura de eventos falhou; o app talvez precise estar publicado.)"}`,
      true,
    );
    res.cookies.delete("ig_oauth_state");
    return res;
  } catch (err) {
    console.error("[ig-callback]", err);
    return page(`Falha ao conectar: ${(err as Error).message}`, false);
  }
}
