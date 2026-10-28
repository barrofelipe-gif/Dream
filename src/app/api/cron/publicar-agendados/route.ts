import { NextRequest, NextResponse } from "next/server";
import { concluirPendentes, destravarPublicacoes, publicarAgendados } from "@/lib/social/publicar";
import { seguirSemAtendente } from "@/lib/igSeguimento";
import { processarTransmissoes } from "@/lib/igTransmissao";
import { processarSequencias } from "@/lib/igSequencias";
import { processarFluxos } from "@/lib/igFluxos";
import { processarEnviosAgendados } from "@/lib/igEnvios";
import { limparEnviosFantasma, retomarSemResposta } from "@/lib/igWebhook";

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
  // Mensagem de cliente que ficou sem resposta (a função do webhook morreu no meio): o robô responde agora.
  await limparEnviosFantasma().catch(() => 0);
  await destravarPublicacoes().catch(() => 0);
  // Reel do Instagram que ficou processando na rede: publica agora que ficou pronto.
  const concluidas = await concluirPendentes({ prazo: inicio + 10_000 }).catch(() => 0);
  const retomadas = temTempo() ? await retomarSemResposta({ prazo: inicio + 25_000 }).catch(() => 0) : 0;
  const agendadas = temTempo() ? await processarEnviosAgendados().catch(() => 0) : 0;
  const seguimentos = temTempo() ? await seguirSemAtendente({ prazo: inicio + 20_000 }).catch(() => 0) : 0;
  const transmitidas = temTempo() ? await processarTransmissoes().catch(() => 0) : 0;
  const sequenciadas = temTempo() ? await processarSequencias().catch(() => 0) : 0;
  const fluxos = temTempo() ? await processarFluxos().catch(() => 0) : 0;
  let r: { processados: number } = { processados: 0 };
  if (temTempo()) {
    try {
      // Começa postagem só até os 20 s: um Reel pode esperar 30 s pelo Instagram, e a função morre aos 60 s.
      r = await publicarAgendados({ prazo: inicio + 20_000 });
    } catch (e) {
      console.error("[cron] falha ao publicar agendados", e);
    }
  }
  return NextResponse.json({ ok: true, ...r, concluidas, retomadas, agendadas, seguimentos, transmitidas, sequenciadas, fluxos, ms: Date.now() - inicio, em: new Date().toISOString() });
}
