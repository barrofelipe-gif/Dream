import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isPublic =
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
