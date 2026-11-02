import "server-only";
import { randomUUID } from "node:crypto";
import type { Prisma, TelegramWorkspace } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";
import { initialData, TelegramError, type Data } from "./domain";

export type Workspace = TelegramWorkspace & { parsed: Data };
let storageChecked = false;
async function checkStorage() {
  if (storageChecked) return;
  const schema =
    new URL(process.env.DATABASE_URL!).searchParams.get("schema") || "public";
  const rows = await prisma.$queryRaw<
    { rls: boolean; anon: boolean; authenticated: boolean }[]
  >`SELECT c.relrowsecurity AS rls, has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS anon, has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS authenticated FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${schema} AND c.relname='TelegramWorkspace'`;
  if (!rows[0]?.rls || rows[0].anon || rows[0].authenticated)
    throw new TelegramError(
      "storage",
      "A proteção do armazenamento Telegram ainda não está pronta.",
      0,
      503,
    );
  storageChecked = true;
}
export async function load(userId: string): Promise<Workspace> {
  await checkStorage();
  const row = await prisma.telegramWorkspace.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return { ...row, parsed: initialData(row.data) };
}
export async function mutate<T>(
  userId: string,
  fn: (row: Workspace) => T | Promise<T>,
): Promise<T> {
  await load(userId);
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "userId" FROM "TelegramWorkspace" WHERE "userId"=${userId} FOR UPDATE`;
      const row = await tx.telegramWorkspace.findUniqueOrThrow({
        where: { userId },
      });
      const workspace = { ...row, parsed: initialData(row.data) };
      const result = await fn(workspace);
      await tx.telegramWorkspace.update({
        where: { userId },
        data: {
          data: workspace.parsed as unknown as Prisma.InputJsonValue,
          credentialsEnc: workspace.credentialsEnc,
          sessionEnc: workspace.sessionEnc,
          loginEnc: workspace.loginEnc,
          authState: workspace.authState,
          authAttempt: workspace.authAttempt,
          authExpiresAt: workspace.authExpiresAt,
          busyToken: workspace.busyToken,
          busyUntil: workspace.busyUntil,
          version: { increment: 1 },
        },
      });
      return result;
    },
    { timeout: 10000, maxWait: 5000 },
  );
}
export function secret<T>(value: string | null): T | undefined {
  return value ? (JSON.parse(decrypt(value)) as T) : undefined;
}
export function seal(value: unknown): string {
  return encrypt(JSON.stringify(value));
}
export async function isAdministrator(userId: string) {
  return (
    (
      await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      })
    )?.role === "admin"
  );
}
export function finishConnection(
  row: Workspace,
  attempt: string | null,
  account: NonNullable<Data["account"]>,
  saved: string,
) {
  if (row.authAttempt !== attempt)
    throw new TelegramError("cancelled", "A conexão foi cancelada.", 0, 409);
  if (row.parsed.account && row.parsed.account.id !== account.id) {
    row.parsed.sources = [];
    row.parsed.targets = [];
    row.parsed.groups = [];
    row.parsed.authorizedIds = [];
    row.parsed.privacy = undefined;
    for (const person of row.parsed.contacts) person.selected = false;
  }
  row.authState = "connected";
  row.sessionEnc = seal(saved);
  row.loginEnc = null;
  row.authExpiresAt = null;
  row.parsed.account = account;
  row.parsed.error = undefined;
}
export function notBusy(row: Workspace) {
  if (row.busyToken && row.busyUntil && row.busyUntil.getTime() > Date.now())
    throw new TelegramError("busy", "Aguarde a operação em andamento.", 0, 409);
}
export async function lease(userId: string, milliseconds = 90000) {
  if (!(await isAdministrator(userId)))
    throw new TelegramError(
      "permission",
      "O operador não possui mais acesso de administrador.",
      0,
      403,
    );
  const token = randomUUID();
  const row = await mutate(userId, (row) => {
    notBusy(row);
    row.busyToken = token;
    row.busyUntil = new Date(Date.now() + milliseconds);
    return structuredClone(row);
  });
  return { token, row };
}
export async function release(userId: string, token: string) {
  await prisma.telegramWorkspace.updateMany({
    where: { userId, busyToken: token },
    data: { busyToken: null, busyUntil: null },
  });
}
