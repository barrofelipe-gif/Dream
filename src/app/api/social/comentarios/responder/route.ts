import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { ErroRede, REDES_COMENTARIO, responderComentario, type RedeComentario } from "@/lib/social/comentarios";

export const maxDuration = 30;

// Publica a resposta que a equipe leu e aprovou. Nada é enviado sem este clique.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => null)) as { rede?: string; contaId?: string; comentarioId?: string; texto?: string } | null;
  const texto = (b?.texto ?? "").trim();
  if (!b?.rede || !(REDES_COMENTARIO as string[]).includes(b.rede)) return NextResponse.json({ error: "Rede inválida." }, { status: 400 });
  if (!b.contaId || !b.comentarioId) return NextResponse.json({ error: "Comentário não informado." }, { status: 400 });
  if (!texto) return NextResponse.json({ error: "Escreva a resposta antes de enviar." }, { status: 400 });
  const max = b.rede === "youtube" ? 10000 : b.rede === "instagram" ? 2200 : 8000;
  if (texto.length > max) return NextResponse.json({ error: `A resposta passa de ${max} caracteres.` }, { status: 400 });
  try {
    const r = await responderComentario(b.rede as RedeComentario, b.contaId, b.comentarioId, texto);
    return NextResponse.json({ ok: true, id: r.id ?? null });
  } catch (e) {
    if (!(e instanceof ErroRede)) console.error("[comentarios] responder", e);
    return NextResponse.json({ error: e instanceof ErroRede ? e.message : "Não consegui enviar a resposta. Tente de novo." }, { status: 502 });
  }
}
