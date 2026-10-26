import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/igAdmin";
import { coletarConta, coletarTodas } from "@/lib/social/metricas";

// A coleta de uma conta faz dezenas de chamadas à Meta: o plano gratuito da Vercel aceita até 60 segundos.
export const maxDuration = 60;

// Coleta agora. Corpo: { contaId?: string, dias?: number }. Sem contaId = todas as contas ativas.
export async function POST(req: NextRequest) {
  const { erro } = await exigirAdmin();
  if (erro) return erro;
  const corpo = (await req.json().catch(() => ({}))) as { contaId?: string; dias?: number };
  const dias = Math.min(Math.max(Number(corpo.dias ?? 30) || 30, 1), 90);
  const resultados = corpo.contaId ? [await coletarConta(corpo.contaId, dias)] : await coletarTodas(dias);
  return NextResponse.json({ ok: resultados.every((r) => !r.erro), resultados });
}
