import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { exchangeCodeForToken } from "@/lib/tray";

export async function GET(req: NextRequest) {
  const session = await auth();

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const apiAddress = searchParams.get("api_address");
  const error = searchParams.get("error");

  const redirectBack = (status: "ok" | "erro", detail?: string) => {
    const url = new URL("/conectar-tray", req.nextUrl.origin);
    url.searchParams.set("status", status);
    if (detail) url.searchParams.set("detail", detail);
    return NextResponse.redirect(url);
  };

  if (!session?.user?.id) return redirectBack("erro", "nao_autenticado");
  if (error) return redirectBack("erro", error);
  if (!code || !apiAddress) return redirectBack("erro", "parametros_ausentes");

  try {
    await exchangeCodeForToken(code, apiAddress, session.user.id);
    return redirectBack("ok");
  } catch (e) {
    console.error("Erro no callback da Tray:", e);
    return redirectBack("erro", "falha_troca_token");
  }
}
