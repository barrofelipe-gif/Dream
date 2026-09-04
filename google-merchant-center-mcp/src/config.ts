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
  clientId: required("GOOGLE_MERCHANT_CENTER_CLIENT_ID"),
  clientSecret: required("GOOGLE_MERCHANT_CENTER_CLIENT_SECRET"),
  refreshToken: required("GOOGLE_MERCHANT_CENTER_REFRESH_TOKEN"),
  defaultMerchantId: process.env.GOOGLE_MERCHANT_CENTER_MERCHANT_ID || undefined,
};
