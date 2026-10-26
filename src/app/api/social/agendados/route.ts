import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { publicarAgendados } from "@/lib/social/publicar";

// Publica o que estava agendado e já passou da hora. A tela do publicador chama isto a cada minuto
// enquanto está aberta; o agendador externo (GitHub Actions) faz o mesmo com o painel fechado.
export const maxDuration = 60;

export async function POST() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  return NextResponse.json({ ok: true, ...(await publicarAgendados()) });
}
