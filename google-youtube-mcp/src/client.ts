import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";

const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret);
oauth2Client.setCredentials({ refresh_token: config.refreshToken });

export const youtube = google.youtube({ version: "v3", auth: oauth2Client });
export const youtubeAnalytics = google.youtubeAnalytics({ version: "v2", auth: oauth2Client });

/** Formats a Google API client error into a readable message for the LLM. */
export function formatYoutubeError(error: unknown): string {
  const err = error as any;
  const message = err?.response?.data?.error?.message ?? err?.errors?.[0]?.message ?? err?.message;
  return message ?? String(error);
}
