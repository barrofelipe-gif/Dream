import { readFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { body } from "@/lib/telegram/access";
import { checkGrowthStorage } from "@/lib/telegram/growth";
import {
  hash,
  isPreview,
  STORE_HOSTS,
  verifyClick,
} from "@/lib/telegram/growth-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ action: string }> };
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};
export async function GET(_request: Request, context: Context) {
  if ((await context.params).action !== "tracker.js")
    return new Response(null, { status: 404 });
  return new Response(
    await readFile(
      path.join(process.cwd(), "public/telegram-assets/tracker.js"),
      "utf8",
    ),
    {
      headers: {
        ...headers,
        "Content-Type": "application/javascript; charset=utf-8",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}
export async function POST(request: Request, context: Context) {
  if ((await context.params).action !== "visit")
    return new Response(null, { status: 404 });
  let origin: URL;
  try {
    origin = new URL(request.headers.get("origin") || "");
  } catch {
    return new Response(null, { status: 403 });
  }
  if (
    origin.protocol !== "https:" ||
    !STORE_HOSTS.includes(origin.hostname) ||
    origin.port ||
    isPreview(request.headers)
  )
    return new Response(null, { status: 403 });
  const cors = {
    ...headers,
    "Access-Control-Allow-Origin": origin.origin,
    Vary: "Origin",
  };
  try {
    const data = await body(request);
    const id = verifyClick(data.token);
    if (!id) return new Response(null, { status: 400, headers: cors });
    await checkGrowthStorage();
    const click = await prisma.telegramGrowthClick.findUnique({
      where: { id },
    });
    if (!click || Date.now() - click.createdAt.getTime() > 30 * 86400000)
      return new Response(null, { status: 410, headers: cors });
    const sessionHash =
      typeof data.session === "string" && /^[a-f0-9]{64}$/.test(data.session)
        ? hash(`session:${data.session}`)
        : undefined;
    // Replays never add a visit or replace a session already attached to a click.
    if (!click.visitedAt && Date.now() - click.createdAt.getTime() <= 86400000)
      await prisma.telegramGrowthClick.updateMany({
        where: { id, visitedAt: null },
        data: { visitedAt: new Date(), sessionHash },
      });
    if (sessionHash)
      await prisma.telegramGrowthClick.updateMany({
        where: { id, visitedAt: { not: null }, sessionHash: null },
        data: { sessionHash },
      });
    return new Response(null, { status: 204, headers: cors });
  } catch {
    console.warn("[telegram-growth] visit unavailable");
    return new Response(null, { status: 400, headers: cors });
  }
}
