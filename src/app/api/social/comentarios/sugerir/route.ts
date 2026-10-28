import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { contaPorId, REDES_COMENTARIO, type RedeComentario } from "@/lib/social/comentarios";
import { sugerirResposta } from "@/lib/social/respostaIa";

export const maxDuration = 60;

// Sugestão de resposta da IA. Só devolve o texto: quem publica é a equipe, depois de ler e corrigir.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const b = (await req.json().catch(() => null)) as {
    rede?: string;
    contaId?: string;
    autor?: string;
    texto?: string;
    legenda?: string;
    respostas?: unknown;
  } | null;
  if (!b?.rede || !(REDES_COMENTARIO as string[]).includes(b.rede)) return NextResponse.json({ error: "Rede inválida." }, { status: 400 });
  if (!b.contaId) return NextResponse.json({ error: "Conta não informada." }, { status: 400 });
  if (!(b.texto ?? "").trim()) return NextResponse.json({ error: "Comentário vazio." }, { status: 400 });
  // A loja vem da conta salva, nunca do navegador: regras da BFF não vão para a Moranga e vice-versa.
  const conta = await contaPorId(b.rede as RedeComentario, b.contaId);
  if (!conta) return NextResponse.json({ error: "Conta não encontrada ou desconectada." }, { status: 404 });
  const respostas = Array.isArray(b.respostas) ? b.respostas.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  try {
    const s = await sugerirResposta({
      loja: conta.status.loja,
      rede: b.rede as RedeComentario,
      autor: (b.autor ?? "").slice(0, 80),
      comentario: (b.texto ?? "").slice(0, 1500),
      legendaPost: (b.legenda ?? "").slice(0, 500),
      respostasAnteriores: respostas.map((r) => r.slice(0, 300)),
    });
    return NextResponse.json(s);
  } catch (e) {
    console.error("[comentarios] ia", e);
    return NextResponse.json({ error: "A IA não conseguiu sugerir agora. Escreva a resposta ou tente de novo." }, { status: 502 });
  }
}
