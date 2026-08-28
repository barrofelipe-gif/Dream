import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getOAuthClient } from "@/lib/gmail";
import { encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.redirect(new URL("/login", req.nextUrl.origin));

  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const redirectBack = (status: "ok" | "erro", detail?: string) => {
    const url = new URL("/conectar-gmail", req.nextUrl.origin);
    url.searchParams.set("status", status);
    if (detail) url.searchParams.set("detail", detail);
    return NextResponse.redirect(url);
  };

  if (error) return redirectBack("erro", error);
  if (!code || !state) return redirectBack("erro", "parametros_ausentes");

  let decodedState: { userId?: string };
  try {
    decodedState = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  } catch {
    return redirectBack("erro", "state_invalido");
  }

  if (decodedState.userId !== session.user.id) {
    return redirectBack("erro", "state_nao_confere");
  }

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);

    if (!tokens.refresh_token) {
      // Acontece quando o usuário já autorizou antes e o Google não reenvia
      // o refresh_token. Nesse caso pedimos pra revogar o acesso em
      // myaccount.google.com/permissions e tentar de novo.
      return redirectBack("erro", "sem_refresh_token");
    }

    await prisma.gmailConnection.upsert({
      where: { userId: session.user.id },
      create: {
        userId: session.user.id,
        refreshToken: encrypt(tokens.refresh_token),
      },
      update: {
        refreshToken: encrypt(tokens.refresh_token),
      },
    });

    return redirectBack("ok");
  } catch (e) {
    console.error("Erro no callback do Gmail:", e);
    return redirectBack("erro", "falha_troca_token");
  }
}
