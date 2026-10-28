import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { prisma } from "@/lib/prisma";
import { sugerirTextos } from "@/lib/social/sugerir";
import { REDES, type Rede } from "@/lib/social/types";

export const maxDuration = 60;

// Textos de cada rede (título, legenda, hashtags, palavras-chave) escritos pela IA a partir da descrição do conteúdo.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => null)) as { descricao?: string; legenda?: string; redes?: string[]; tipo?: string; contaIds?: string[] } | null;
  // A marca vem das contas escolhidas, lida no servidor: BFF e Moranga nunca no mesmo texto.
  const contaIds = [...new Set((b?.contaIds ?? []).filter((x) => typeof x === "string"))];
  const lojas = contaIds.length ? [...new Set((await prisma.socialConta.findMany({ where: { id: { in: contaIds } }, select: { loja: true } })).map((c) => c.loja))] : ["bff"];
  if (lojas.length > 1) return NextResponse.json({ error: "Escolha contas de uma marca só (BFF ou Moranga) para a IA escrever." }, { status: 400 });
  const loja = lojas[0] === "moranga" ? "moranga" : "bff";
  const redes = (b?.redes ?? []).filter((r): r is Rede => (REDES as string[]).includes(r));
  if (!redes.length) return NextResponse.json({ error: "Escolha pelo menos uma rede" }, { status: 400 });
  if (!(b?.descricao ?? "").trim() && !(b?.legenda ?? "").trim()) return NextResponse.json({ error: "Conte o que aparece no vídeo ou na foto para a IA escrever" }, { status: 400 });
  const tipo = b?.tipo === "imagem" || b?.tipo === "carrossel" || b?.tipo === "texto" ? b.tipo : "video";
  try {
    const s = await sugerirTextos({ descricao: (b?.descricao ?? "").slice(0, 2000), legenda: (b?.legenda ?? "").slice(0, 2200), redes, tipo, loja });
    return NextResponse.json(s);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Falha na IA" }, { status: 502 });
  }
}
