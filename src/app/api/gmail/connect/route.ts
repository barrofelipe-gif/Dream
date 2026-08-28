import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { auth } from "@/auth";
import { getAuthUrl } from "@/lib/gmail";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  // state carrega o userId assinado de forma simples pra validar no callback
  const state = Buffer.from(JSON.stringify({ userId: session.user.id, nonce: crypto.randomUUID() })).toString(
    "base64url"
  );

  const url = getAuthUrl(state);
  return NextResponse.redirect(url);
}
