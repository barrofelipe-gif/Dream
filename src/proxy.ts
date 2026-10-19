import { auth } from "@/auth";
import { NextResponse, type NextRequest } from "next/server";
import { REVIEWS_ORIGIN, reviewsPass } from "@/lib/avaliacoes";
import { hasSectorAccess } from "@/lib/permissions";

/**
 * Sistema de avaliações (BFF e Moranga) dentro do app, em /avaliacoes/...: o pedido é repassado ao serviço de
 * avaliações (REVIEWS_ORIGIN).
 *  - Painel (/avaliacoes/admin e /avaliacoes/api/admin/...): exige login do app (admin, ou membro com acesso ao
 *    setor Clientes) e leva um "passe" assinado, para o painel abrir sem outra senha.
 *  - Partes públicas (widget das lojas, envio de avaliações e perguntas, páginas /avaliar): sem login.
 * O navegador nunca manda o passe: qualquer x-bffr-sso que chegue de fora é apagado. Para o serviço só vão os
 * cookies dele (bffr_*), nunca o login do app.
 */
async function repassarAvaliacoes(req: NextRequest, user: { email?: string | null; id?: string; role?: string } | null) {
  const { pathname, search } = req.nextUrl;
  const rest = pathname.replace(/^\/avaliacoes/, "");
  if (rest === "" || rest === "/") return NextResponse.redirect(new URL("/avaliacoes/admin", req.nextUrl.origin));
  if (!REVIEWS_ORIGIN) return new NextResponse("Sistema de avaliações não configurado (REVIEWS_ORIGIN).", { status: 503 });

  const painel = rest === "/admin" || rest.startsWith("/admin/") || rest.startsWith("/api/admin/") || rest.startsWith("/api/cron/");
  const headers = new Headers(req.headers);
  headers.delete("x-bffr-sso");
  headers.delete("host");
  const cookies = (req.headers.get("cookie") || "").split(/;\s*/).filter((c) => c.startsWith("bffr_")).join("; ");
  if (cookies) headers.set("cookie", cookies);
  else headers.delete("cookie");

  if (painel) {
    if (!user) {
      if (rest.startsWith("/api/")) return NextResponse.json({ error: "Entre no app para usar o painel de avaliações." }, { status: 401 });
      const loginUrl = new URL("/login", req.nextUrl.origin);
      loginUrl.searchParams.set("callbackUrl", pathname + search);
      return NextResponse.redirect(loginUrl);
    }
    const pode = user.role === "admin" || (!!user.id && (await hasSectorAccess(user.id, user.role || "", "clientes")));
    const pass = pode && user.email ? reviewsPass(user.email) : null;
    if (pass) headers.set("x-bffr-sso", pass);
    // Sem permissão (ou sem segredo configurado) o painel pede a senha própria dele, como antes.
  }
  return NextResponse.rewrite(new URL(rest + search, REVIEWS_ORIGIN), { request: { headers } });
}

export default auth(async (req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  if (pathname === "/avaliacoes" || pathname.startsWith("/avaliacoes/")) {
    return repassarAvaliacoes(req, req.auth?.user ? (req.auth.user as { email?: string | null; id?: string; role?: string }) : null);
  }

  const isPublic =
    pathname === "/" || // home com o cérebro — porta de entrada pública
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/.well-known/oauth-");
  const isCron = pathname.startsWith("/api/cron");
  // O endpoint MCP autentica sozinho por token/cabeçalho (ver
  // src/app/api/mcp/route.ts) — não usa sessão de navegador, porque quem
  // chama é um assistente externo (Claude, ChatGPT). Exceção: a tela de
  // autorização do mini fluxo OAuth (/api/mcp/oauth/authorize) É protegida
  // por sessão de propósito — é ela que faz o "login" do handshake OAuth
  // usar o login de verdade do painel, em vez de um token solto.
  const isMcp = pathname.startsWith("/api/mcp") && pathname !== "/api/mcp/oauth/authorize";

  if (isPublic || isCron || isMcp) return NextResponse.next();

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
