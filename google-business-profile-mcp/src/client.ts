import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";

const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret);
oauth2Client.setCredentials({ refresh_token: config.refreshToken });

// Google Business Profile is split across several APIs. This server uses the three that don't
// require Google's separate "Business Profile API access" approval form:
export const accountManagement = google.mybusinessaccountmanagement({ version: "v1", auth: oauth2Client });
export const businessInformation = google.mybusinessbusinessinformation({ version: "v1", auth: oauth2Client });
export const performance = google.businessprofileperformance({ version: "v1", auth: oauth2Client });

/** Formats a Google API client error into a readable message for the LLM. */
export function formatBusinessProfileError(error: unknown): string {
  const err = error as any;
  const message = err?.response?.data?.error?.message ?? err?.errors?.[0]?.message ?? err?.message;
  return message ?? String(error);
}

/** Splits "YYYY-MM-DD" into the {year, month, day} object the Performance API's date params want. */
export function toApiDate(isoDate: string): { year: number; month: number; day: number } {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { year, month, day };
}
