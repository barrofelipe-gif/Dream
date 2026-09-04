import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { config, normalizePropertyId } from "./config.js";

const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret);
oauth2Client.setCredentials({ refresh_token: config.refreshToken });

export const analyticsData = google.analyticsdata({ version: "v1beta", auth: oauth2Client });
export const analyticsAdmin = google.analyticsadmin({ version: "v1beta", auth: oauth2Client });

/** Resolves a property id argument against the configured default, normalizing to "properties/<id>". */
export function resolvePropertyId(propertyIdInput?: string): string {
  const raw = propertyIdInput ?? config.defaultPropertyId;
  if (!raw) {
    throw new Error(
      "No property_id provided and GOOGLE_ANALYTICS_PROPERTY_ID is not set in the environment. " +
        "Pass property_id explicitly, or call google_analytics_list_properties to find one."
    );
  }
  return normalizePropertyId(raw);
}

/** Formats a Google API client error into a readable message for the LLM. */
export function formatAnalyticsError(error: unknown): string {
  const err = error as any;
  const message = err?.response?.data?.error?.message ?? err?.errors?.[0]?.message ?? err?.message;
  return message ?? String(error);
}
