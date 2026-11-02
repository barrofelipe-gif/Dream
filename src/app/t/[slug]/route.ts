import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkGrowthStorage } from "@/lib/telegram/growth";
import {
  hash,
  isPreview,
  signClick,
  trackedDestination,
} from "@/lib/telegram/growth-domain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ slug: string }> };
export async function GET(request: NextRequest, context: Context) {
  const { slug } = await context.params;
  if (!/^[\w-]{12}$/.test(slug))
    return new Response("Link não encontrado.", { status: 404 });
  await checkGrowthStorage();
  const link = await prisma.telegramGrowthLink.findUnique({ where: { slug } });
  if (!link) return new Response("Link não encontrado.", { status: 404 });
  // Pausar desliga a medição, mas preserva links já publicados.
  let token: string | undefined, visitor: string | undefined;
  if (link.active && !isPreview(request.headers)) {
    visitor = request.cookies.get("__Host-bff-tg-v")?.value;
    if (!visitor || !/^[0-9a-f-]{36}$/.test(visitor)) visitor = randomUUID();
    try {
      const visitorHash = hash(`visitor:${visitor}`);
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const count = await prisma.telegramGrowthClick.count({
        where: { visitorHash, createdAt: { gte: today } },
      });
      if (count < 100) {
        const click = await prisma.telegramGrowthClick.create({
          data: { linkId: link.id, visitorHash },
        });
        token = signClick(click.id);
      }
    } catch {
      console.warn("[telegram-growth] click unavailable");
    }
  }
  const response = NextResponse.redirect(trackedDestination(link, token), 302);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("Referrer-Policy", "no-referrer");
  if (visitor)
    response.cookies.set("__Host-bff-tg-v", visitor, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 31536000,
    });
  return response;
}
export async function HEAD(_request: NextRequest, context: Context) {
  const { slug } = await context.params;
  if (!/^[\w-]{12}$/.test(slug)) return new Response(null, { status: 404 });
  const link = await prisma.telegramGrowthLink.findUnique({ where: { slug } });
  return link
    ? new Response(null, {
        status: 302,
        headers: {
          Location: trackedDestination(link),
          "Cache-Control": "no-store",
        },
      })
    : new Response(null, { status: 404 });
}
