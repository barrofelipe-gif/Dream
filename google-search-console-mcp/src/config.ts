import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env, fill it in ` +
        `(see README.md), and restart the server.`
    );
  }
  return value;
}

export const config = {
  clientId: required("GOOGLE_SEARCH_CONSOLE_CLIENT_ID"),
  clientSecret: required("GOOGLE_SEARCH_CONSOLE_CLIENT_SECRET"),
  refreshToken: required("GOOGLE_SEARCH_CONSOLE_REFRESH_TOKEN"),
  defaultSiteUrl: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL || undefined,
};
