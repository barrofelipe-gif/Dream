import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { salvarConta } from "@/lib/social/contas";
import { FB_ESCOPOS, FB_GRAPH } from "@/lib/social/facebook";
import { assinarPagina } from "@/lib/messenger";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function pagina(msg: string, ok: boolean, detalhes: string[] = []) {
  const lista = detalhes.length ? `<ul>${detalhes.map((d) => `<li>${esc(d)}</li>`).join("")}</ul>` : "";
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Facebook</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>${ok ? "Conectado" : "Atenção"}: ${esc(msg)}</h2>${lista}<p><a href="/">Voltar ao painel</a></p>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

type Pag = { id: string; name: string; access_token: string; instagram_business_account?: { id: string; username?: string } };

export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;

  const p = req.nextUrl.searchParams;
  if (p.get("error")) return pagina(`O Facebook recusou: ${p.get("error_description") ?? p.get("error")}`, false);
  const code = p.get("code");
  const state = p.get("state");
  const cookieState = req.cookies.get("fb_oauth_state")?.value;
  if (!code || !state || state !== cookieState) return pagina("Pedido inválido ou expirado. Comece de novo.", false);
  const loja = state.split(".")[1];
  if (loja !== "bff" && loja !== "moranga") return pagina("Loja inválida.", false);

  const appId = process.env.FB_APP_ID;
  const secret = process.env.FB_APP_SECRET;
  if (!appId || !secret) return pagina("FB_APP_ID/FB_APP_SECRET não configurados.", false);

  try {
    // 1) código -> token de usuário (curta duração)
    const curto = await fetch(
      `${FB_GRAPH}/oauth/access_token?` +
        new URLSearchParams({ client_id: appId, client_secret: secret, redirect_uri: `${req.nextUrl.origin}/api/social/facebook/callback`, code }),
    );
    if (!curto.ok) throw new Error(`troca do código: ${curto.status}`);
    const { access_token: tokenCurto } = (await curto.json()) as { access_token: string };

    // 2) curta -> longa duração (os tokens de Página gerados a partir dele não vencem)
    const longo = await fetch(
      `${FB_GRAPH}/oauth/access_token?` +
        new URLSearchParams({ grant_type: "fb_exchange_token", client_id: appId, client_secret: secret, fb_exchange_token: tokenCurto }),
    );
    if (!longo.ok) throw new Error(`token de longa duração: ${longo.status}`);
    const { access_token: tokenUsuario } = (await longo.json()) as { access_token: string };

    // 3) Páginas que o usuário administra (com o token de cada Página)
    const paginas: Pag[] = [];
    let proxima: string | null = `${FB_GRAPH}/me/accounts?fields=${encodeURIComponent("id,name,access_token,instagram_business_account{id,username}")}&limit=100`;
    while (proxima) {
      const r: Response = await fetch(proxima, { headers: { Authorization: `Bearer ${tokenUsuario}` } });
      if (!r.ok) throw new Error(`lista de Páginas: ${r.status}`);
      const j = (await r.json()) as { data: Pag[]; paging?: { next?: string } };
      paginas.push(...j.data);
      proxima = j.paging?.next ?? null;
    }
    if (paginas.length === 0) return pagina("Nenhuma Página encontrada. Marque as Páginas na tela de permissões do Facebook e tente de novo.", false);

    // 4) grava cada Página (token criptografado pelo salvarConta)
    // Cada Página vai para a sua própria loja (o login traz as duas de uma vez; BFF e Moranga são empresas separadas).
    const lojaDe = (nome: string) => (/moranga/i.test(nome) ? "moranga" : /bff/i.test(nome) ? "bff" : loja);
    const semMensagens: string[] = [];
    const recusadas: string[] = [];
    for (const pg of paginas) {
      // Página que a trava de marca recusa (já é da outra empresa): pula só ela, as outras seguem.
      const salva = await salvarConta({
        rede: "facebook",
        loja: lojaDe(pg.name),
        externoId: pg.id,
        nome: pg.name,
        username: null,
        accessToken: pg.access_token,
        escopos: FB_ESCOPOS.join(","),
        extra: pg.instagram_business_account
          ? { instagramId: pg.instagram_business_account.id, instagramUsername: pg.instagram_business_account.username ?? null }
          : {},
      }).catch((e: Error) => (recusadas.push(`${pg.name}: ${e.message}`), null));
      if (!salva) continue;
      // Messenger: liga o webhook da Página (mensagens no painel). Sem a permissão pages_messaging, só avisa.
      await assinarPagina(salva.id).catch(() => semMensagens.push(pg.name));
    }

    const res = pagina(`${paginas.length - recusadas.length} Página(s) conectada(s).`, true, [
      ...paginas.filter((x) => !recusadas.some((r) => r.startsWith(`${x.name}:`))).map((x) => `${x.name} → loja ${lojaDe(x.name)}`),
      ...recusadas,
      ...semMensagens.map((n) => `${n}: mensagens do Messenger não ligadas (falta a permissão pages_messaging/pages_manage_metadata).`),
    ]);
    res.cookies.delete("fb_oauth_state");
    return res;
  } catch (err) {
    console.error("[fb-callback]", err);
    return pagina(`Falha ao conectar: ${(err as Error).message}`, false);
  }
}
