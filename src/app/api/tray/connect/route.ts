import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getAuthorizeUrl } from "@/lib/tray";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Só admin conecta a Tray" }, { status: 403 });
  }

  const callbackUrl = process.env.TRAY_CALLBACK_URL ?? `${req.nextUrl.origin}/api/tray/callback`;
  const url = getAuthorizeUrl(callbackUrl);
  return NextResponse.redirect(url);
}
