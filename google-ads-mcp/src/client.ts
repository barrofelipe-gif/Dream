import { GoogleAdsApi, type Customer } from "google-ads-api";
import { config } from "./config.js";

const api = new GoogleAdsApi({
  client_id: config.clientId,
  client_secret: config.clientSecret,
  developer_token: config.developerToken,
});

/**
 * Returns a Customer client for the given customer id, falling back to
 * GOOGLE_ADS_CUSTOMER_ID from the environment. Throws a clear error if
 * neither is available.
 */
export function getCustomer(customerIdInput?: string): Customer {
  const customerId = (customerIdInput ?? config.defaultCustomerId)?.replace(/-/g, "");
  if (!customerId) {
    throw new Error(
      "No customer_id provided and GOOGLE_ADS_CUSTOMER_ID is not set in the environment. " +
        "Pass customer_id explicitly, or call list_accessible_customers to find one."
    );
  }
  return api.Customer({
    customer_id: customerId,
    login_customer_id: config.loginCustomerId,
    refresh_token: config.refreshToken,
  });
}

export function listAccessibleCustomers() {
  return api.listAccessibleCustomers(config.refreshToken);
}

/** Formats a Google Ads API error (or any thrown error) into a readable message for the LLM. */
export function formatGoogleAdsError(error: unknown): string {
  const err = error as any;
  const failure = err?.errors ?? err?.details?.errors;
  if (Array.isArray(failure) && failure.length > 0) {
    return failure
      .map((e: any) => {
        const code = e?.error_code ? JSON.stringify(e.error_code) : "UNKNOWN_ERROR";
        const msg = e?.message ?? "No message";
        const field = e?.location?.field_path_elements
          ?.map((f: any) => f.field_name)
          .join(".");
        return `[${code}] ${msg}${field ? ` (field: ${field})` : ""}`;
      })
      .join("\n");
  }
  return err?.message ?? String(error);
}
