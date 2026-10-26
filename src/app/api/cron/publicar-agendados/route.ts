import { NextRequest, NextResponse } from "next/server";
import { publicarAgendados } from "@/lib/social/publicar";

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
  const r = await publicarAgendados();
  return NextResponse.json({ ok: true, ...r, em: new Date().toISOString() });
}
