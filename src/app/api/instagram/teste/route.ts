import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { responder } from "@/lib/igBot";

// Teste a seco do robô: /api/instagram/teste?loja=bff&q=<mensagem>
// Roda a mesma escolha de resposta do webhook, sem enviar nada ao Instagram.
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const loja = req.nextUrl.searchParams.get("loja");
  const q = req.nextUrl.searchParams.get("q")?.trim();
  if ((loja !== "bff" && loja !== "moranga") || !q) {
    return NextResponse.json({ error: "Use ?loja=bff|moranga&q=mensagem" }, { status: 400 });
  }
  const t0 = Date.now();
  try {
    const r = await responder(loja, q);
    return NextResponse.json({ pergunta: q, ms: Date.now() - t0, ...r });
  } catch (err) {
    return NextResponse.json({ pergunta: q, erro: (err as Error).message }, { status: 500 });
  }
}
