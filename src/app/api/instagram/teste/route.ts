import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { responder, escreverApoio, type Mensagem } from "@/lib/igBot";

// Teste a seco do robô: /api/instagram/teste?loja=bff&q=<mensagem>[&prev=c:oi||l:Oi!&apoio=esclarecer1|esclarecer2|atendente]
// prev = conversa anterior (c: cliente, l: loja), separada por ||
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
    const prev = (req.nextUrl.searchParams.get("prev") ?? "")
      .split("||")
      .filter(Boolean)
      .map((x): Mensagem => ({ de: x.startsWith("l:") ? "loja" : "cliente", texto: x.slice(2) }));
    const historico: Mensagem[] = [...prev, { de: "cliente", texto: q }];
    const apoio = req.nextUrl.searchParams.get("apoio");
    if (apoio === "esclarecer1" || apoio === "esclarecer2" || apoio === "atendente") {
      return NextResponse.json({ pergunta: q, apoio, texto: await escreverApoio(loja, apoio, historico), ms: Date.now() - t0 });
    }
    const r = await responder(loja, q, historico);
    return NextResponse.json({ pergunta: q, ms: Date.now() - t0, ...r });
  } catch (err) {
    return NextResponse.json({ pergunta: q, erro: (err as Error).message }, { status: 500 });
  }
}
