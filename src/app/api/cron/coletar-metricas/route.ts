import { NextRequest, NextResponse } from "next/server";
import { coletarTodas } from "@/lib/social/metricas";

export const maxDuration = 60;

// Chamado por um agendador (1x por dia basta). Protegido por PUBLICAR_SECRET ou CRON_SECRET.
export async function GET(req: NextRequest) {
  const bearer = req.headers.get("authorization");
  const ok = [process.env.PUBLICAR_SECRET, process.env.CRON_SECRET].some((x) => x && bearer === `Bearer ${x}`);
  if (!ok) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const resultados = await coletarTodas(30);
  return NextResponse.json({ ok: true, resultados, em: new Date().toISOString() });
}
