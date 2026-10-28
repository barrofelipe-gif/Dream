import { NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { concluirPendentes, publicarAgendados } from "@/lib/social/publicar";

// Publica o que estava agendado e já passou da hora. A tela do publicador chama isto a cada minuto
// enquanto está aberta; o agendador externo (GitHub Actions) faz o mesmo com o painel fechado.
export const maxDuration = 60;

export async function POST() {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  // Também termina Reel do Instagram que ficou processando (a tela aberta faz isso a cada minuto).
  // Prazos contados da entrada: um Reel começado aos 15 s espera no máximo 30 s pelo Instagram e termina antes dos 60 s.
  const inicio = Date.now();
  const concluidas = await concluirPendentes({ prazo: inicio + 10_000 }).catch(() => 0);
  const r = await publicarAgendados({ prazo: inicio + 15_000 });
  return NextResponse.json({ ok: true, ...r, processados: r.processados + concluidas, concluidas });
}
