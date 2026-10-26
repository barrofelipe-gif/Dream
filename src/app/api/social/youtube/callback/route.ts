import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { salvarConta } from "@/lib/social/contas";
import { buscarCanal, trocarCodigo, YT_ESCOPOS } from "@/lib/social/youtube";

function pagina(msg: string, ok: boolean) {
  const seguro = msg.replace(/[<>&]/g, "");
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>YouTube</title><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem"><h2>${ok ? "Pronto" : "Atenção"}: ${seguro}</h2><p><a href="/">Voltar ao painel</a></p>`,
    { status: ok ? 200 : 400, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export async function GET(req: NextRequest) {
  const a = await exigirAdmin();
  if (a.erro) return a.erro;

  const p = req.nextUrl.searchParams;
  if (p.get("error")) return pagina(`O Google recusou: ${p.get("error")}`, false);
  const code = p.get("code");
  const state = p.get("state");
  const cookieState = req.cookies.get("yt_oauth_state")?.value;
  if (!code || !state || state !== cookieState) return pagina("Pedido inválido ou expirado. Comece de novo.", false);
  const loja = state.split(".")[1];
  if (loja !== "bff" && loja !== "moranga") return pagina("Loja inválida.", false);

  try {
    const t = await trocarCodigo(code, `${req.nextUrl.origin}/api/social/youtube/callback`);
    if (!t.refresh_token) {
      return pagina("O Google não enviou o refresh token. Revogue o acesso do app em myaccount.google.com/permissions e conecte de novo.", false);
    }
    const escoposDados = (t.scope ?? "").split(" ");
    if (!escoposDados.includes(YT_ESCOPOS[0])) {
      return pagina("A permissão de enviar vídeos não foi marcada. Conecte de novo e deixe todas as caixas marcadas.", false);
    }

    const canal = await buscarCanal(t.access_token);
    if (!canal) return pagina("Essa conta do Google não tem canal do YouTube. Crie o canal e conecte de novo.", false);

    await salvarConta({
      rede: "youtube",
      loja,
      externoId: canal.id,
      nome: canal.titulo,
      username: canal.handle,
      fotoUrl: canal.foto,
      accessToken: t.access_token,
      refreshToken: t.refresh_token,
      expiraEm: new Date(Date.now() + t.expires_in * 1000),
      escopos: t.scope ?? YT_ESCOPOS.join(" "),
    });

    const res = pagina(`canal ${canal.titulo} conectado à loja ${loja}.`, true);
    res.cookies.delete("yt_oauth_state");
    return res;
  } catch (err) {
    console.error("[youtube-callback]", err);
    return pagina(`Falha ao conectar: ${(err as Error).message}`, false);
  }
}
