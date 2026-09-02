import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { ensureDefaultColumns } from "@/lib/columns";

export const GMAIL_LABEL_NAME = "Pendente";

// Escopos pedidos numa única autorização por conta Google:
// - gmail.readonly + gmail.labels: ler e-mails marcados e criar a label "Pendente"
// - userinfo.email: descobrir QUAL conta foi conectada (necessário pra múltiplas contas)
// - drive.file: anexar arquivos do Drive escolhidos pelo usuário no Picker
//   (drive.file dá acesso só ao que o usuário escolher, nunca ao Drive inteiro)
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/drive.file",
];

export function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

export function getAuthUrl(state: string) {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline", // necessário pra receber refresh_token
    prompt: "consent", // força reenvio do refresh_token mesmo se já autorizado antes
    scope: GMAIL_SCOPES,
    state,
  });
}

/** Cliente autenticado a partir do refresh_token criptografado de uma conexão. */
export function clientForConnection(refreshTokenEncrypted: string) {
  const client = getOAuthClient();
  client.setCredentials({ refresh_token: decrypt(refreshTokenEncrypted) });
  return client;
}

async function ensurePendingLabel(gmail: ReturnType<typeof google.gmail>): Promise<string> {
  const { data } = await gmail.users.labels.list({ userId: "me" });
  const existing = data.labels?.find((l) => l.name === GMAIL_LABEL_NAME);
  if (existing?.id) return existing.id;

  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name: GMAIL_LABEL_NAME,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  return created.data.id!;
}

interface SyncResult {
  created: number;
  updated: number;
  total: number;
}

/**
 * Sincroniza UMA conta Google conectada. sourceRef = `${connectionId}:${messageId}`
 * pra que a mesma mensagem em contas diferentes nunca colida, e pra que
 * desconectar/reconectar não duplique o que já foi importado.
 */
async function syncConnection(
  userId: string,
  connectionId: string,
  refreshTokenEncrypted: string,
  accountEmail: string
): Promise<SyncResult> {
  const client = clientForConnection(refreshTokenEncrypted);
  const gmail = google.gmail({ version: "v1", auth: client });

  const labelId = await ensurePendingLabel(gmail);
  const [defaultColumn] = await ensureDefaultColumns(userId, "emails");

  const { data } = await gmail.users.messages.list({
    userId: "me",
    labelIds: [labelId],
    maxResults: 50,
  });

  const messages = data.messages ?? [];
  let created = 0;
  let updated = 0;

  for (const msg of messages) {
    if (!msg.id) continue;

    const full = await gmail.users.messages.get({
      userId: "me",
      id: msg.id,
      format: "metadata",
      metadataHeaders: ["Subject", "From", "Date"],
    });

    const headers = full.data.payload?.headers ?? [];
    const subject = headers.find((h) => h.name === "Subject")?.value ?? "(sem assunto)";
    const from = headers.find((h) => h.name === "From")?.value ?? "";
    const snippet = full.data.snippet ?? "";
    const detail = `De: ${from}\nConta: ${accountEmail}\n\n${snippet}`;

    const sourceRef = `${connectionId}:${msg.id}`;

    const existingItem = await prisma.item.findFirst({
      where: { ownerId: userId, source: "gmail", sourceRef },
    });

    if (existingItem) {
      await prisma.item.update({
        where: { id: existingItem.id },
        data: { title: subject, detail },
      });
      updated += 1;
    } else {
      await prisma.item.create({
        data: {
          ownerId: userId,
          category: "emails",
          columnId: defaultColumn.id,
          title: subject,
          detail,
          priority: "media",
          source: "gmail",
          sourceRef,
        },
      });
      created += 1;
    }
  }

  await prisma.gmailConnection.update({
    where: { id: connectionId },
    data: { lastSyncAt: new Date() },
  });

  return { created, updated, total: messages.length };
}

/**
 * Sincroniza TODAS as contas Google conectadas do usuário. Critério de
 * "pendente": o próprio usuário aplica a label "Pendente" no Gmail — mais
 * simples e mais preciso do que tentar adivinhar (ver especificação).
 *
 * Uma conta com problema (token revogado, por ex.) não derruba as outras:
 * o erro é registrado em `errors` e a sincronização segue.
 */
export async function syncGmailForUser(userId: string) {
  const connections = await prisma.gmailConnection.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (connections.length === 0) throw new Error("Usuário sem conexão com o Gmail");

  let created = 0;
  let updated = 0;
  let total = 0;
  const perAccount: { email: string; created: number; updated: number; total: number }[] = [];
  const errors: { email: string; error: string }[] = [];

  for (const connection of connections) {
    try {
      const result = await syncConnection(
        userId,
        connection.id,
        connection.refreshToken,
        connection.email
      );
      created += result.created;
      updated += result.updated;
      total += result.total;
      perAccount.push({ email: connection.email, ...result });
    } catch (e) {
      errors.push({
        email: connection.email,
        error: e instanceof Error ? e.message : "erro desconhecido",
      });
    }
  }

  return { created, updated, total, perAccount, errors };
}
