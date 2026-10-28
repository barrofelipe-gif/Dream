import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { sugerirTextos } from "@/lib/social/sugerir";
import { REDES, type Rede } from "@/lib/social/types";

export const maxDuration = 60;

// Textos de cada rede (título, legenda, hashtags, palavras-chave) escritos pela IA a partir da descrição do conteúdo.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => null)) as { descricao?: string; legenda?: string; redes?: string[]; tipo?: string } | null;
  const redes = (b?.redes ?? []).filter((r): r is Rede => (REDES as string[]).includes(r));
  if (!redes.length) return NextResponse.json({ error: "Escolha pelo menos uma rede" }, { status: 400 });
  if (!(b?.descricao ?? "").trim() && !(b?.legenda ?? "").trim()) return NextResponse.json({ error: "Conte o que aparece no vídeo ou na foto para a IA escrever" }, { status: 400 });
  const tipo = b?.tipo === "imagem" || b?.tipo === "carrossel" || b?.tipo === "texto" ? b.tipo : "video";
  try {
    const s = await sugerirTextos({ descricao: (b?.descricao ?? "").slice(0, 2000), legenda: (b?.legenda ?? "").slice(0, 2200), redes, tipo });
    return NextResponse.json(s);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha na IA" }, { status: 502 });
  }
}
