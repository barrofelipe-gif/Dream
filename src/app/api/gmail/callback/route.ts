import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
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

    // Descobre QUAL conta foi conectada — é o que permite ter várias
    // (pessoal, empresa, fornecedor) lado a lado sem uma sobrescrever a outra.
    client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: "v2", auth: client });
    const { data: userInfo } = await oauth2.userinfo.get();
    const email = userInfo.email;
    if (!email) return redirectBack("erro", "sem_email_da_conta");

    await prisma.gmailConnection.upsert({
      where: { userId_email: { userId: session.user.id, email } },
      create: {
        userId: session.user.id,
        email,
        refreshToken: encrypt(tokens.refresh_token),
      },
      update: {
        refreshToken: encrypt(tokens.refresh_token),
      },
    });

    return redirectBack("ok", email);
  } catch (e) {
    console.error("Erro no callback do Gmail:", e);
    return redirectBack("erro", "falha_troca_token");
  }
}
