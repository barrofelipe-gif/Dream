import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { TelegramError } from "./domain";

export async function operator() {
  const session = await auth();
  if (!session?.user?.id)
    throw new TelegramError(
      "auth",
      "Entre no app BFF Fitness para continuar.",
      0,
      401,
    );
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, role: true },
  });
  if (!user || user.role !== "admin")
    throw new TelegramError(
      "permission",
      "Somente administradores podem acessar as contas Telegram.",
      0,
      403,
    );
  return user.id;
}
export function csrf(userId: string, day = Math.floor(Date.now() / 86400000)) {
  const key = process.env.AUTH_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!key)
    throw new TelegramError(
      "config",
      "A segurança da sessão do app ainda não está configurada.",
      0,
      503,
    );
  return createHmac("sha256", key)
    .update(`telegram:${userId}:${day}`)
    .digest("base64url");
}
export function checkPost(request: Request, userId: string) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new TelegramError("origin", "Origem não permitida.", 0, 403);
  const token = request.headers.get("x-csrf-token") || "";
  const matches = [0, -1].some((offset) => {
    const expected = Buffer.from(
      csrf(userId, Math.floor(Date.now() / 86400000) + offset),
    );
    const supplied = Buffer.from(token);
    return (
      expected.length === supplied.length && timingSafeEqual(expected, supplied)
    );
  });
  if (!matches)
    throw new TelegramError(
      "csrf",
      "Reabra o painel para atualizar sua sessão.",
      0,
      403,
    );
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new TelegramError("input", "Envie um objeto JSON.");
}
export async function body(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new TelegramError("input", "Solicitação vazia.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > 65536) {
        await reader.cancel();
        throw new TelegramError("input", "Solicitação grande demais.");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value;
  } catch {
    throw new TelegramError("input", "Dados inválidos. Confira os campos.");
  }
}
