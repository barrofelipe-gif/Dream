import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";

const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret);
oauth2Client.setCredentials({ refresh_token: config.refreshToken });

// Content API for Shopping v2.1 — the classic, stable Merchant Center surface (products,
// product statuses/diagnostics, account statuses). Google's newer "Merchant API" (split into
// several v1beta sub-APIs) exists too, but v2.1 covers everything this server needs and is
// simpler to work against.
export const content = google.content({ version: "v2.1", auth: oauth2Client });

export function resolveMerchantId(merchantIdInput?: string): string {
  const merchantId = merchantIdInput ?? config.defaultMerchantId;
  if (!merchantId) {
    throw new Error(
      "No merchant_id provided and GOOGLE_MERCHANT_CENTER_MERCHANT_ID is not set in the " +
        "environment. Pass merchant_id explicitly (find it in the top-right of the Merchant " +
        "Center UI)."
    );
  }
  return merchantId;
}

/** Formats a Google API client error into a readable message for the LLM. */
export function formatMerchantCenterError(error: unknown): string {
  const err = error as any;
  const message = err?.response?.data?.error?.message ?? err?.errors?.[0]?.message ?? err?.message;
  return message ?? String(error);
}
