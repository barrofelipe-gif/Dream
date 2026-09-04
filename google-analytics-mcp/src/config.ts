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

/** Accepts either "419011003" or "properties/419011003" and normalizes to "properties/419011003". */
export function normalizePropertyId(id: string): string {
  return id.startsWith("properties/") ? id : `properties/${id}`;
}

export const config = {
  clientId: required("GOOGLE_ANALYTICS_CLIENT_ID"),
  clientSecret: required("GOOGLE_ANALYTICS_CLIENT_SECRET"),
  refreshToken: required("GOOGLE_ANALYTICS_REFRESH_TOKEN"),
  defaultPropertyId: process.env.GOOGLE_ANALYTICS_PROPERTY_ID
    ? normalizePropertyId(process.env.GOOGLE_ANALYTICS_PROPERTY_ID)
    : undefined,
};
