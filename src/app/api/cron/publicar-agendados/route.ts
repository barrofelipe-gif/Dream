import { NextRequest, NextResponse } from "next/server";
import { publicarAgendados } from "@/lib/social/publicar";
import { seguirSemAtendente } from "@/lib/igSeguimento";
import { processarTransmissoes } from "@/lib/igTransmissao";
import { processarSequencias } from "@/lib/igSequencias";
import { processarFluxos } from "@/lib/igFluxos";
import { processarEnviosAgendados } from "@/lib/igEnvios";

// Publicar em várias redes (com vídeo) demora: o plano gratuito da Vercel aceita até 60 segundos.
export const maxDuration = 60;

// Chamado por um agendador externo a cada ~5 min (o plano gratuito da Vercel só roda cron 1x por dia).
// Protegido por PUBLICAR_SECRET (ou CRON_SECRET, que a Vercel manda no cron diário de segurança).
export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization");
  const ok = [process.env.PUBLICAR_SECRET, process.env.CRON_SECRET].some((x) => x && bearer === `Bearer ${x}`);
  if (!ok) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  // Os jobs do Instagram (curtos e sensíveis a tempo) rodam primeiro; publicar vídeos demora e não pode derrubar nem atrasar os outros.
  // Depois de ~45 s não se pega outro lote: a função morre aos 60 s e o que ficou pendente sai na rodada seguinte.
  const inicio = Date.now();
  const prazo = inicio + 45_000;
  const temTempo = () => Date.now() < prazo;
  // Aproveita o agendador de 5 min: retoma conversas em que ninguém da equipe respondeu.
  const agendadas = temTempo() ? await processarEnviosAgendados().catch(() => 0) : 0;
  const seguimentos = temTempo() ? await seguirSemAtendente().catch(() => 0) : 0;
  const transmitidas = temTempo() ? await processarTransmissoes().catch(() => 0) : 0;
  const sequenciadas = temTempo() ? await processarSequencias().catch(() => 0) : 0;
  const fluxos = temTempo() ? await processarFluxos().catch(() => 0) : 0;
  let r: { processados: number } = { processados: 0 };
  if (temTempo()) {
    try {
      r = await publicarAgendados({ prazo });
    } catch (e) {
      console.error("[cron] falha ao publicar agendados", e);
    }
  }
  return NextResponse.json({ ok: true, ...r, agendadas, seguimentos, transmitidas, sequenciadas, fluxos, ms: Date.now() - inicio, em: new Date().toISOString() });
}
