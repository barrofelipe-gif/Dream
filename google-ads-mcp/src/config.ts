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
  clientId: required("GOOGLE_ADS_CLIENT_ID"),
  clientSecret: required("GOOGLE_ADS_CLIENT_SECRET"),
  developerToken: required("GOOGLE_ADS_DEVELOPER_TOKEN"),
  refreshToken: required("GOOGLE_ADS_REFRESH_TOKEN"),
  defaultCustomerId: process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, "") || undefined,
  loginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, "") || undefined,
};
