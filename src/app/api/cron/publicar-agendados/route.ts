import { NextRequest, NextResponse } from "next/server";
import { publicarAgendados } from "@/lib/social/publicar";

// Chamado por um agendador externo a cada ~5 min (o plano gratuito da Vercel só roda cron 1x por dia).
// Protegido por CRON_SECRET, igual aos outros crons do painel.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const r = await publicarAgendados();
  return NextResponse.json({ ok: true, ...r, em: new Date().toISOString() });
}
