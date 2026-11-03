import { readFile } from "node:fs/promises";
import path from "node:path";
import { operator, checkPost, body } from "@/lib/telegram/access";
import * as telegram from "@/lib/telegram/service";
import { mapError } from "@/lib/telegram/driver";
import { TelegramError } from "@/lib/telegram/domain";
import * as growth from "@/lib/telegram/growth";
import { restoreTray } from "@/lib/telegram/analytics";
import { withRequestContext } from "@/lib/telegram/request-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
type Context = { params: Promise<{ path: string[] }> };
function failure(error: unknown) {
  const safe = error instanceof TelegramError ? error : mapError(error);
  const diagnostic = error as {
    code?: unknown;
    name?: unknown;
    meta?: { code?: unknown };
  };
  console.warn("[telegram] api", {
    code: safe.code,
    kind: typeof diagnostic?.name === "string" ? diagnostic.name : undefined,
    database:
      typeof diagnostic?.code === "string" ? diagnostic.code : undefined,
    sqlstate:
      typeof diagnostic?.meta?.code === "string"
        ? diagnostic.meta.code
        : undefined,
  });
  return Response.json(
    { error: safe.message, code: safe.code },
    { status: safe.status, headers },
  );
}
export async function GET(_request: Request, context: Context) {
  try {
    const userId = await operator();
    const parts = (await context.params).path;
    const route = "/" + parts.join("/");
    if (route === "/growth") return Response.json(await growth.dashboard(userId, new URL(_request.url).searchParams), { headers });
    if (route === "/painel") {
      const html = await readFile(
        path.join(process.cwd(), "public/telegram-assets/painel.html"),
        "utf8",
      );
      return new Response(html, {
        headers: {
          ...headers,
          "Content-Type": "text/html; charset=utf-8",
          "X-Frame-Options": "SAMEORIGIN",
          "Content-Security-Policy":
            "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'none'",
        },
      });
    }
    if (route === "/state")
      return Response.json(await telegram.state(userId), { headers });
    if (route === "/health")
      return Response.json({ ready: true, mode: "live" }, { headers });
    if (route === "/export/contacts.csv" || route === "/export/results.csv") {
      const results = route.endsWith("results.csv");
      const exported = results ? await telegram.csv(userId, true)
        : await withRequestContext(new URL(_request.url).searchParams.get("account_context"), () => telegram.csv(userId, false));
      return new Response(exported, {
        headers: {
          ...headers,
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="telegram-${results ? "resultados" : "participantes"}.csv"`,
        },
      });
    }
    return Response.json(
      { error: "Página não encontrada." },
      { status: 404, headers },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    const userId = await operator();
    checkPost(request, userId);
    const data = await body(request);
    const route = "/" + (await context.params).path.join("/");
    return await withRequestContext(request.headers.get("x-telegram-context"), async () => {
    let result: unknown;
    if (route === "/growth/reconnect-tray") result = await restoreTray(userId);
    else if (route === "/growth/links") result = await growth.createLink(userId, data);
    else if (route === "/growth/link") result = await growth.toggleLink(userId, data);
    else if (route === "/growth/install") result = await growth.installTracker(userId, new URL(request.url).origin);
    else if (route === "/growth/sync") result = await growth.syncSales(userId);
    else if (route === "/growth/prospect") result = await telegram.saveProspect(userId, data);
    else if (route === "/growth/prospects/refresh") result = await telegram.refreshProspect(userId, data);
    else if (route === "/discover") result = await telegram.discover(userId, data);
    else if (route === "/connection/prepare-origin")
      result = await telegram.prepareOrigin(userId, data);
    else if (route === "/connection/accounts/add")
      result = await telegram.addAccount(userId, data);
    else if (route === "/connection/accounts/switch")
      result = await telegram.switchAccount(userId, data);
    else if (route === "/connection/channel/create")
      result = await telegram.createChannel(userId, data);
    else if (route === "/connection/channel/test")
      result = await telegram.testChannel(userId, data);
    else if (route === "/connection/qr")
      result = await telegram.begin(userId, data, true);
    else if (route === "/connection/start")
      result = await telegram.begin(userId, data, false);
    else if (route === "/connection/code")
      result = await telegram.verify(userId, data, false);
    else if (route === "/connection/password")
      result = await telegram.verify(userId, data, true);
    else if (route === "/connection/cancel")
      result = await telegram.cancel(userId);
    else if (route === "/connection/disconnect")
      result = await telegram.disconnect(userId);
    else if (route === "/connection/restore")
      result = await telegram.restore(userId);
    else if (route === "/connection/groups")
      result = await telegram.groups(userId);
    else if (route === "/connection/privacy" || route === "/connection/protect")
      result = await telegram.privacy(
        userId,
        data.group_id,
        route.endsWith("/protect"),
      );
    else if (route === "/connection/configure")
      result = await telegram.configure(userId, data);
    else if (route === "/collect")
      result = await telegram.collect(userId, data);
    else if (["/selection", "/selection/bulk"].includes(route))
      result = await telegram.localAction(userId, route, data);
    else if (route === "/jobs") result = await telegram.createJob(userId, data);
    else if (route === "/control")
      result = await telegram.control(userId, data);
    else throw new TelegramError("input", "Operação não encontrada.", 0, 404);
    return Response.json(result, { headers });
    });
  } catch (error) {
    return failure(error);
  }
}
