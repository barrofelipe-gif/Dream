import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { responderComoEquipe } from "@/lib/messenger";

// Resposta da atendente pelo painel: envia no Messenger, grava como equipe e o robô sai da conversa.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const { id } = await params;
  const { texto } = (await req.json().catch(() => ({}))) as { texto?: string };
  const msg = texto?.trim();
  if (!msg) return NextResponse.json({ error: "Escreva a mensagem" }, { status: 400 });
  if (msg.length > 2000) return NextResponse.json({ error: "Mensagem longa demais (máx. 2000)" }, { status: 400 });
  try {
    await responderComoEquipe(id, msg);
  } catch (e) {
    console.error("[messenger] falha ao enviar", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}
