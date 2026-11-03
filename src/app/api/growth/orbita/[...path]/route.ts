import { auth } from "@/auth";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ORBITA_ASSETS,
  ORBITA_CSP,
  ORBITA_VERSION,
  orbitaPanel,
} from "@/lib/orbita-hosting";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return Response.json(
      { error: "Entre no app para usar a Órbita." },
      { status: 401, headers },
    );
  if (session.user.role !== "admin")
    return Response.json(
      { error: "A Órbita está disponível para administradores neste teste." },
      { status: 403, headers },
    );
  const parts = (await context.params).path;
  if (parts.length !== 1)
    return new Response("Página não encontrada.", { status: 404, headers });
  const name = parts[0];
  if (name === "session")
    return Response.json({ ready: true, version: ORBITA_VERSION }, { headers });
  if (name === "painel") {
    const scope = createHash("sha256")
      .update(session.user.id)
      .digest("hex")
      .slice(0, 32);
    return new Response(orbitaPanel(scope), {
      headers: {
        ...headers,
        "Content-Type": "text/html; charset=utf-8",
        "X-Frame-Options": "SAMEORIGIN",
        "Content-Security-Policy": ORBITA_CSP,
      },
    });
  }
  const asset = Object.hasOwn(ORBITA_ASSETS, name) ? ORBITA_ASSETS[name] : null;
  if (!asset)
    return new Response("Página não encontrada.", { status: 404, headers });
  try {
    const content = await readFile(
      path.join(process.cwd(), "integrations/orbita/assets", asset.file),
    );
    return new Response(new Uint8Array(content), {
      headers: {
        ...headers,
        "Content-Type": asset.type,
        ...(asset.download
          ? {
              "Content-Disposition": `attachment; filename="${asset.download}"`,
            }
          : {}),
      },
    });
  } catch {
    console.error("[orbita] packaged asset unavailable", asset.file);
    return Response.json(
      {
        error:
          "O arquivo da Órbita está indisponível. Atualize a página ou avise o administrador.",
      },
      { status: 503, headers },
    );
  }
}
