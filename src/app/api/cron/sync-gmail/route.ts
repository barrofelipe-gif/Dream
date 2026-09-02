import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncGmailForUser } from "@/lib/gmail";

// Chamado pelo Vercel Cron (ver vercel.json). Protegido por CRON_SECRET —
// a Vercel envia esse header automaticamente em execuções de cron; em teste
// manual, use: curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/sync-gmail
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  // distinct por usuário: syncGmailForUser já percorre TODAS as contas
  // conectadas daquela pessoa, então um usuário com 3 contas entra uma vez só.
  const connections = await prisma.gmailConnection.findMany({
    select: { userId: true },
    distinct: ["userId"],
  });

  const results = await Promise.allSettled(
    connections.map((c) => syncGmailForUser(c.userId))
  );

  const summary = results.map((r, i) => ({
    userId: connections[i].userId,
    ok: r.status === "fulfilled",
    ...(r.status === "fulfilled" ? r.value : { error: String(r.reason) }),
  }));

  return NextResponse.json({ syncedAt: new Date().toISOString(), summary });
}
