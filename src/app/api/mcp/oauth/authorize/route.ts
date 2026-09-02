import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { gerarCode, redirectUriValida, MCP_OAUTH_EXPIRACAO_CODE_MS } from "@/lib/mcpOAuth";

/**
 * Tela de autorização do mini fluxo OAuth do MCP.
 *
 * Fica atrás do middleware de sessão (src/proxy.ts exclui essa rota
 * específica do bypass do /api/mcp) — quem chega aqui sem estar logado no
 * painel é redirecionado pro /login primeiro. Só depois de logado é que o
 * clique em "Autorizar" gera o code de uso único que o Claude troca por
 * token em /api/mcp/oauth/token.
 */

interface ParametrosAutorizacao {
  responseType: string | null;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  scope: string;
  resource: string;
}

function lerParametros(url: URL): ParametrosAutorizacao {
  return {
    responseType: url.searchParams.get("response_type"),
    clientId: url.searchParams.get("client_id") ?? "",
    redirectUri: url.searchParams.get("redirect_uri") ?? "",
    state: url.searchParams.get("state") ?? "",
    codeChallenge: url.searchParams.get("code_challenge") ?? "",
    codeChallengeMethod: url.searchParams.get("code_challenge_method") ?? "S256",
    scope: url.searchParams.get("scope") ?? "",
    resource: url.searchParams.get("resource") ?? "",
  };
}

function paginaHtml(p: ParametrosAutorizacao, erro?: string): string {
  const campo = (nome: string, valor: string) =>
    `<input type="hidden" name="${nome}" value="${valor.replace(/"/g, "&quot;")}">`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Autorizar acesso — Painel BFF</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: #09090b; color: #e4e4e7; font-family: -apple-system, system-ui, sans-serif;
  }
  .card {
    width: 100%; max-width: 380px; margin: 24px; padding: 28px;
    background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
    border-radius: 16px;
  }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 14px; color: #a1a1aa; line-height: 1.5; }
  .aviso { color: #fb7185; font-size: 13px; margin-top: 8px; }
  .botoes { display: flex; gap: 10px; margin-top: 20px; }
  button, a.botao {
    flex: 1; text-align: center; padding: 10px 14px; border-radius: 8px; font-size: 14px;
    border: 1px solid rgba(255,255,255,0.1); cursor: pointer; text-decoration: none;
  }
  button[type=submit] { background: #6366f1; color: white; border-color: transparent; font-weight: 500; }
  a.botao { background: transparent; color: #a1a1aa; }
</style>
</head>
<body>
  <div class="card">
    <h1>Autorizar acesso ao painel BFF</h1>
    <p>Um assistente está pedindo acesso somente leitura aos dados da BFF (vendas, clientes, estoque, pendências) via MCP.</p>
    ${erro ? `<p class="aviso">${erro}</p>` : ""}
    <form method="POST" action="/api/mcp/oauth/authorize">
      ${campo("response_type", p.responseType ?? "")}
      ${campo("client_id", p.clientId)}
      ${campo("redirect_uri", p.redirectUri)}
      ${campo("state", p.state)}
      ${campo("code_challenge", p.codeChallenge)}
      ${campo("code_challenge_method", p.codeChallengeMethod)}
      ${campo("scope", p.scope)}
      ${campo("resource", p.resource)}
      <div class="botoes">
        <a class="botao" href="${p.redirectUri ? `${p.redirectUri}${p.redirectUri.includes("?") ? "&" : "?"}error=access_denied&state=${encodeURIComponent(p.state)}` : "/painel"}">Cancelar</a>
        <button type="submit">Autorizar acesso</button>
      </div>
    </form>
  </div>
</body>
</html>`;
}

function html(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  const p = lerParametros(req.nextUrl);
  if (p.responseType !== "code" || !p.redirectUri || !redirectUriValida(p.redirectUri)) {
    return html(
      paginaHtml(p, "Requisição de autorização inválida (response_type ou redirect_uri ausente/incorreto)."),
      400
    );
  }
  if (!p.codeChallenge) {
    return html(paginaHtml(p, "Faltou code_challenge (PKCE) na requisição."), 400);
  }

  return html(paginaHtml(p));
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const p: ParametrosAutorizacao = {
    responseType: String(form.get("response_type") ?? ""),
    clientId: String(form.get("client_id") ?? ""),
    redirectUri: String(form.get("redirect_uri") ?? ""),
    state: String(form.get("state") ?? ""),
    codeChallenge: String(form.get("code_challenge") ?? ""),
    codeChallengeMethod: String(form.get("code_challenge_method") ?? "S256"),
    scope: String(form.get("scope") ?? ""),
    resource: String(form.get("resource") ?? ""),
  };

  if (!p.redirectUri || !redirectUriValida(p.redirectUri) || !p.codeChallenge) {
    return html(paginaHtml(p, "Requisição inválida — tente reconectar o conector do zero."), 400);
  }

  const code = gerarCode();
  await prisma.mcpAuthCode.create({
    data: {
      code,
      clientId: p.clientId || "desconhecido",
      redirectUri: p.redirectUri,
      codeChallenge: p.codeChallenge,
      codeChallengeMethod: p.codeChallengeMethod,
      expiresAt: new Date(Date.now() + MCP_OAUTH_EXPIRACAO_CODE_MS),
    },
  });

  const destino = new URL(p.redirectUri);
  destino.searchParams.set("code", code);
  if (p.state) destino.searchParams.set("state", p.state);
  return NextResponse.redirect(destino);
}
