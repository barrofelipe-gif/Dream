import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { createHash } from "node:crypto";
import {
  buildOfficialInsights,
  officialPeriod,
  OrbitaInsightsError,
  selectOfficialAccount,
  usernameOf,
} from "@/lib/orbita-insights";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id)
    return Response.json(
      {
        error: "Entre no app para ler as métricas oficiais.",
        code: "UNAUTHENTICATED",
      },
      { status: 401, headers },
    );
  if (session.user.role !== "admin")
    return Response.json(
      {
        error:
          "A leitura das métricas oficiais está disponível para administradores.",
        code: "FORBIDDEN",
      },
      { status: 403, headers },
    );
  const userScope = createHash("sha256")
    .update(String(session.user.id))
    .digest("hex")
    .slice(0, 32);
  let choices: { id: string; username: string | null; loja: string }[] = [];
  try {
    const query = new URL(request.url).searchParams,
      username = usernameOf(query.get("username")),
      period = officialPeriod(query.get("start"), query.get("end"));
    const accountId = query.get("accountId");
    if (accountId !== null && (!accountId.trim() || accountId.length > 128))
      throw new OrbitaInsightsError(
        "Identificador da conta inválido.",
        "INVALID_ACCOUNT",
      );
    // Admins may inspect either store, but the explicit @ and optional source id
    // must match one active provider record. Never infer store from its name.
    choices = await prisma.socialConta.findMany({
      where: {
        ativo: true,
        rede: "instagram",
        OR: [
          { username: { equals: username, mode: "insensitive" } },
          { username: { equals: `@${username}`, mode: "insensitive" } },
        ],
      },
      select: { id: true, username: true, loja: true },
      orderBy: { id: "asc" },
    });
    const account = selectOfficialAccount(choices, username, accountId);
    const [days, posts] = await Promise.all([
      prisma.socialMetricaConta.findMany({
        where: {
          contaId: account.id,
          data: {
            gte: new Date(`${period.start}T00:00:00.000Z`),
            lte: new Date(`${period.end}T00:00:00.000Z`),
          },
        },
        select: { contaId: true, data: true, bruto: true, coletadoEm: true },
        orderBy: { data: "asc" },
        take: 91,
      }),
      // Broader UTC bounds are filtered against the Brasília calendar by the
      // adapter, avoiding a hard-coded DST offset for historical records.
      prisma.socialMetricaPost.findMany({
        where: {
          contaId: account.id,
          publicadoEm: {
            gte: new Date(Date.parse(period.start) - 86400000),
            lt: new Date(Date.parse(period.end) + 2 * 86400000),
          },
        },
        select: {
          contaId: true,
          externoId: true,
          tipo: true,
          legenda: true,
          permalink: true,
          publicadoEm: true,
          bruto: true,
          coletadoEm: true,
        },
        orderBy: { publicadoEm: "desc" },
        take: 1001,
      }),
    ]);
    const result = buildOfficialInsights({
      account,
      username,
      start: period.start,
      end: period.end,
      days,
      posts,
      postsTruncated: posts.length >= 1001,
    });
    return Response.json({ ...result, userScope }, { headers });
  } catch (error) {
    if (error instanceof OrbitaInsightsError)
      return Response.json(
        {
          error: error.message,
          code: error.code,
          userScope,
          ...(error.code === "ACCOUNT_AMBIGUOUS" ? { accounts: choices } : {}),
        },
        { status: error.status, headers },
      );
    // Do not include SQL, provider payloads, tokens, or environment values.
    console.warn("[orbita insights] saved collection unavailable");
    return Response.json(
      {
        error:
          "Não foi possível ler a coleta salva. Nenhum dado da Órbita foi alterado.",
        code: "COLLECTION_UNAVAILABLE",
        userScope,
      },
      { status: 503, headers },
    );
  }
}
