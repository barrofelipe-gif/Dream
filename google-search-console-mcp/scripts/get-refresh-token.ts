#!/usr/bin/env tsx
/**
 * One-time helper to generate a Google Search Console OAuth2 refresh token.
 *
 * Run this on YOUR OWN COMPUTER (it opens a browser and needs your Google login) —
 * not inside a remote/headless session. See README.md for the full walkthrough.
 *
 * Usage:
 *   npm run auth
 *
 * Requires GOOGLE_SEARCH_CONSOLE_CLIENT_ID and GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET to already
 * be set in .env (create the OAuth 2.0 "Desktop app" client in Google Cloud Console first — you
 * can reuse the same client you made for google-ads-mcp / google-analytics-mcp or Gmail).
 *
 * Scope note: this uses the full (read/write) "webmasters" scope, not "webmasters.readonly",
 * because google_search_console_submit_sitemap needs write access. If you only ever want to
 * read data, edit SCOPE below to ".../auth/webmasters.readonly" before running this.
 */
import "dotenv/config";
import http from "node:http";
import { URL } from "node:url";
import open from "open";

const PORT = 51765;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const SCOPE = "https://www.googleapis.com/auth/webmasters";

const clientId = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error(
    "\nMissing GOOGLE_SEARCH_CONSOLE_CLIENT_ID / GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET.\n" +
      "Create a .env file (copy .env.example) and fill those two in first — " +
      "see README.md step 1.\n"
  );
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

const server = http.createServer(async (req, res) => {
  if (!req.url) return;
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    res.end(`Authorization failed: ${error}. You can close this tab and check the terminal.`);
    console.error(`\nGoogle returned an error: ${error}`);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.end("Waiting for authorization code...");
    return;
  }

  res.end("Authorized! You can close this tab and go back to the terminal.");
  server.close();

  try {
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId!,
        client_secret: clientSecret!,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenResponse.json()) as {
      refresh_token?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokens.refresh_token) {
      console.error(
        "\nNo refresh_token in the response:\n" +
          JSON.stringify(tokens, null, 2) +
          "\n\nThis usually means you've authorized this app before and Google only issues a NEW " +
          "refresh token on first consent (or when prompt=consent, which this script already sets). " +
          "If it still fails, revoke the app's access at https://myaccount.google.com/permissions " +
          "and run `npm run auth` again."
      );
      process.exit(1);
    }

    console.log("\n✅ Success! Your refresh token:\n");
    console.log(tokens.refresh_token);
    console.log("\nAdd this line to your .env file:\n");
    console.log(`GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } catch (err) {
    console.error("\nFailed to exchange the code for a refresh token:", err);
    process.exit(1);
  }
});

server.listen(PORT, () => {
  console.log("\nOpening your browser to sign in to Google and authorize this app...");
  console.log("(Use the Google account that has access to your Search Console property.)");
  console.log(`If the browser doesn't open automatically, visit:\n${authUrl.toString()}\n`);
  open(authUrl.toString()).catch(() => {
    /* already printed the URL above as a fallback */
  });
});
