import { NextRequest, NextResponse } from "next/server";
import { pingTrayConnection } from "@/lib/tray";

// Chamado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET —
// a Vercel envia esse header automaticamente em execuções de cron; em teste
// manual, use: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/sync-tray
//
// Existe só pra manter a conexão com a Tray viva: sem nenhum acesso diário,
// o refresh_token fica sem uso por tempo demais e expira sem avisar
// ninguém. Chamando isso 1x/dia, o access_token é renovado bem antes de
// vencer e o refresh_token nunca fica ocioso.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  try {
    const result = await pingTrayConnection();
    return NextResponse.json({ syncedAt: new Date().toISOString(), ...result });
  } catch (error) {
    // Não deixa silencioso: um status != 200 aqui fica visível no painel
    // de Cron Jobs da Vercel (e pode virar alerta por e-mail nas
    // configurações do projeto, em Settings > Cron Jobs).
    return NextResponse.json(
      { syncedAt: new Date().toISOString(), connected: false, error: String(error) },
      { status: 502 }
    );
  }
}
