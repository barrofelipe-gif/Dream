import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { listarComentarios, REDES_COMENTARIO, type RedeComentario } from "@/lib/social/comentarios";

export const maxDuration = 60;

// Comentários recentes nas publicações (Instagram, Facebook, YouTube), mais novos primeiro. Só administradores.
export async function GET(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const p = req.nextUrl.searchParams;
  const loja = p.get("loja");
  const rede = p.get("rede");
  if (loja && loja !== "bff" && loja !== "moranga") return NextResponse.json({ error: "Loja inválida." }, { status: 400 });
  if (rede && !(REDES_COMENTARIO as string[]).includes(rede)) return NextResponse.json({ error: "Rede inválida." }, { status: 400 });
  try {
    return NextResponse.json(await listarComentarios({ loja: loja ?? undefined, rede: (rede as RedeComentario) ?? undefined }));
  } catch (e) {
    console.error("[comentarios] listar", e);
    return NextResponse.json({ error: "Não consegui buscar os comentários agora. Tente de novo." }, { status: 500 });
  }
}
