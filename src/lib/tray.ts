import "server-only";
import { prisma } from "@/lib/prisma";
import { encrypt, decrypt } from "@/lib/crypto";

/**
 * Client da API clássica da Tray Commerce (loja-s.tray.com.br / api de lojas
 * na plataforma Tray). Fluxo confirmado na doc oficial (developers.tray.com.br):
 *
 * 1. Usuário é mandado pra `${TRAY_STORE_URL}/auth.php?response_type=code&
 *    consumer_key=...&callback=...` — precisa estar logado no admin da loja.
 * 2. Depois de autorizar, a Tray redireciona pro callback com `code`,
 *    `store` e `api_address` (o host da API muda por loja, ex:
 *    trayparceiros.commercesuite.com.br).
 * 3. Trocamos o `code` por tokens em POST {api_address}/auth.
 * 4. Chamadas de API: GET {api_address}/{recurso}?access_token={token}.
 * 5. Refresh: GET {api_address}/auth?refresh_token={refresh_token}.
 *
 * Access token expira rápido (poucas horas) — sempre passar pelo
 * `getValidAccessToken()` abaixo em vez de ler o token direto do banco.
 */

interface TrayTokenResponse {
  message: string;
  code: string;
  access_token: string;
  refresh_token: string;
  date_expiration_access_token: string; // "2021-03-02 14:58:21" (sem timezone — a Tray usa horário de Brasília)
  date_expiration_refresh_token: string;
  date_activated: string;
  api_host: string;
  store_id: string;
}

// As datas da Tray vêm sem timezone, no horário de Brasília (UTC-3).
function parseTrayDate(value: string): Date {
  return new Date(`${value.replace(" ", "T")}-03:00`);
}

export function getAuthorizeUrl(callbackUrl: string): string {
  const storeUrl = process.env.TRAY_STORE_URL;
  const consumerKey = process.env.TRAY_CONSUMER_KEY;
  if (!storeUrl || !consumerKey) {
    throw new Error("TRAY_STORE_URL / TRAY_CONSUMER_KEY não configurados no .env");
  }
  const url = new URL(`${storeUrl}/auth.php`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("consumer_key", consumerKey);
  url.searchParams.set("callback", callbackUrl);
  return url.toString();
}

async function saveTokenResponse(data: TrayTokenResponse, connectedByUserId?: string) {
  await prisma.trayConnection.deleteMany({}); // só existe 1 conexão — a mais recente vence
  await prisma.trayConnection.create({
    data: {
      apiAddress: data.api_host,
      storeId: data.store_id,
      accessToken: encrypt(data.access_token),
      refreshToken: encrypt(data.refresh_token),
      accessTokenExpiresAt: parseTrayDate(data.date_expiration_access_token),
      refreshTokenExpiresAt: parseTrayDate(data.date_expiration_refresh_token),
      connectedByUserId,
    },
  });
}

export async function exchangeCodeForToken(code: string, apiAddress: string, connectedByUserId?: string) {
  const consumerKey = process.env.TRAY_CONSUMER_KEY;
  const consumerSecret = process.env.TRAY_CONSUMER_SECRET;
  if (!consumerKey || !consumerSecret) {
    throw new Error("TRAY_CONSUMER_KEY / TRAY_CONSUMER_SECRET não configurados no .env");
  }

  const res = await fetch(`${apiAddress}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ consumer_key: consumerKey, consumer_secret: consumerSecret, code }),
  });

  if (!res.ok) {
    throw new Error(`Falha ao trocar code por token na Tray: HTTP ${res.status}`);
  }
  const data = (await res.json()) as TrayTokenResponse;
  await saveTokenResponse(data, connectedByUserId);
  return data;
}

async function refreshToken(connection: { apiAddress: string; refreshToken: string }) {
  const url = new URL(`${connection.apiAddress}/auth`);
  url.searchParams.set("refresh_token", decrypt(connection.refreshToken));

  const res = await fetch(url.toString(), { method: "GET" });
  if (!res.ok) {
    throw new Error(`Falha ao atualizar token da Tray: HTTP ${res.status}`);
  }
  const data = (await res.json()) as TrayTokenResponse;
  await saveTokenResponse(data);
  return data;
}

/** Retorna { accessToken, apiAddress } válidos, renovando se preciso. Lança se não houver conexão. */
export async function getValidAccessToken(): Promise<{ accessToken: string; apiAddress: string }> {
  const connection = await prisma.trayConnection.findFirst({ orderBy: { createdAt: "desc" } });
  if (!connection) throw new Error("Nenhuma conexão com a Tray configurada");

  // margem de 2min pra evitar usar um token que expira no meio da requisição
  const expiresWithMargin = new Date(connection.accessTokenExpiresAt.getTime() - 2 * 60 * 1000);
  if (expiresWithMargin > new Date()) {
    return { accessToken: decrypt(connection.accessToken), apiAddress: connection.apiAddress };
  }

  const refreshed = await refreshToken(connection);
  return { accessToken: refreshed.access_token, apiAddress: refreshed.api_host };
}

/** Chamada autenticada genérica: GET {api_address}/{resource}?access_token=...&...params */
export async function trayGet<T = unknown>(resource: string, params: Record<string, string> = {}): Promise<T> {
  const { accessToken, apiAddress } = await getValidAccessToken();
  const url = new URL(`${apiAddress}/${resource.replace(/^\//, "")}`);
  url.searchParams.set("access_token", accessToken);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Erro na API da Tray (${resource}): HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}
