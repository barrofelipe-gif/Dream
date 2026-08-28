import crypto from "node:crypto";

/**
 * Criptografia simétrica (AES-256-GCM) para dados sensíveis em repouso —
 * usada exclusivamente para o refresh_token do Gmail salvo em GmailConnection.
 *
 * A chave vem de TOKEN_ENCRYPTION_KEY (.env), uma string de 32 bytes em base64.
 * Gerar uma nova com: `openssl rand -base64 32`
 */

function getKey(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENCRYPTION_KEY não configurada. Gere uma com `openssl rand -base64 32` e adicione ao .env"
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("TOKEN_ENCRYPTION_KEY deve decodificar para 32 bytes (AES-256).");
  }
  return key;
}

export function encrypt(plainText: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // formato: iv.authTag.ciphertext, tudo em base64
  return [iv, authTag, encrypted].map((b) => b.toString("base64")).join(".");
}

export function decrypt(payload: string): string {
  const key = getKey();
  const [ivB64, authTagB64, dataB64] = payload.split(".");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("Payload criptografado em formato inválido.");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}
