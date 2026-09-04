import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";

const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret);
oauth2Client.setCredentials({ refresh_token: config.refreshToken });

// webmasters v3 covers search analytics + sites + sitemaps (the classic, stable surface).
export const webmasters = google.webmasters({ version: "v3", auth: oauth2Client });
// searchconsole v1 adds URL Inspection, not present in webmasters v3.
export const searchConsole = google.searchconsole({ version: "v1", auth: oauth2Client });

export function resolveSiteUrl(siteUrlInput?: string): string {
  const siteUrl = siteUrlInput ?? config.defaultSiteUrl;
  if (!siteUrl) {
    throw new Error(
      "No site_url provided and GOOGLE_SEARCH_CONSOLE_SITE_URL is not set in the environment. " +
        "Pass site_url explicitly, or call google_search_console_list_sites to find one."
    );
  }
  return siteUrl;
}

/** Formats a Google API client error into a readable message for the LLM. */
export function formatSearchConsoleError(error: unknown): string {
  const err = error as any;
  const message = err?.response?.data?.error?.message ?? err?.errors?.[0]?.message ?? err?.message;
  return message ?? String(error);
}
