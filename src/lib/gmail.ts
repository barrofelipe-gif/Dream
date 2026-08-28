import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { decrypt } from "@/lib/crypto";
import { ensureDefaultColumns } from "@/lib/columns";

export const GMAIL_LABEL_NAME = "Pendente";

// Somente leitura + gerenciar labels (pra poder criar a label "Pendente" se não existir)
export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.labels",
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

/**
 * Sincroniza os e-mails marcados com a label "Pendente" do usuário como Items
 * (category = emails, source = gmail). Critério de "pendente" adotado: o
 * próprio usuário aplica a label "Pendente" no Gmail — mais simples e mais
 * preciso do que tentar adivinhar (ver especificação).
 */
export async function syncGmailForUser(userId: string) {
  const connection = await prisma.gmailConnection.findUnique({ where: { userId } });
  if (!connection) throw new Error("Usuário sem conexão com o Gmail");

  const client = getOAuthClient();
  client.setCredentials({ refresh_token: decrypt(connection.refreshToken) });

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

    const existingItem = await prisma.item.findFirst({
      where: { ownerId: userId, source: "gmail", sourceRef: msg.id },
    });

    if (existingItem) {
      await prisma.item.update({
        where: { id: existingItem.id },
        data: { title: subject, detail: `De: ${from}\n\n${snippet}` },
      });
      updated += 1;
    } else {
      await prisma.item.create({
        data: {
          ownerId: userId,
          category: "emails",
          columnId: defaultColumn.id,
          title: subject,
          detail: `De: ${from}\n\n${snippet}`,
          priority: "media",
          source: "gmail",
          sourceRef: msg.id,
        },
      });
      created += 1;
    }
  }

  await prisma.gmailConnection.update({
    where: { userId },
    data: { lastSyncAt: new Date() },
  });

  return { created, updated, total: messages.length };
}
