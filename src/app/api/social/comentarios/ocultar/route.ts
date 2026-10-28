import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { ErroRede, ocultarComentario } from "@/lib/social/comentarios";

// Conferir de quem é o comentário e publicar são duas chamadas de até 15 s cada: cabe com folga em 60 s.
export const maxDuration = 60;

// Oculta ou mostra de novo um comentário (Instagram e Facebook). Não apaga nada.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => null)) as { rede?: string; contaId?: string; comentarioId?: string; ocultar?: boolean } | null;
  if (b?.rede !== "instagram" && b?.rede !== "facebook") return NextResponse.json({ error: "Ocultar só no Instagram e no Facebook." }, { status: 400 });
  if (!b.contaId || !b.comentarioId) return NextResponse.json({ error: "Comentário não informado." }, { status: 400 });
  try {
    await ocultarComentario(b.rede, b.contaId, b.comentarioId, b.ocultar !== false);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (!(e instanceof ErroRede)) console.error("[comentarios] ocultar", e);
    return NextResponse.json({ error: e instanceof ErroRede ? e.message : "Não consegui ocultar o comentário." }, { status: 502 });
  }
}
