import { auth } from "@/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isPublic = pathname.startsWith("/login") || pathname.startsWith("/api/auth");
  const isCron = pathname.startsWith("/api/cron");
  // O endpoint MCP autentica sozinho pelo token secreto na URL (ver
  // src/app/api/mcp/[token]/route.ts) — não usa sessão de navegador, porque
  // quem chama é um assistente externo (Claude, ChatGPT).
  const isMcp = pathname.startsWith("/api/mcp");

  if (isPublic || isCron || isMcp) return NextResponse.next();

  if (!isLoggedIn) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
