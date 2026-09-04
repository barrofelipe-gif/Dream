import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCustomer, listAccessibleCustomers, formatGoogleAdsError } from "../client.js";

export function registerQueryTools(server: McpServer) {
  server.registerTool(
    "google_ads_list_accessible_customers",
    {
      title: "List accessible Google Ads customer IDs",
      description:
        "Lists every Google Ads customer id (account and manager/MCC ids) that the authenticated " +
        "refresh token can access. Call this first if you don't already know which customer_id to use.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const resourceNames = await listAccessibleCustomers();
        const ids = resourceNames.resource_names.map((rn) => rn.split("/")[1]);
        return {
          content: [{ type: "text", text: JSON.stringify({ customer_ids: ids }, null, 2) }],
          structuredContent: { customer_ids: ids },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list accessible customers: ${formatGoogleAdsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "google_ads_query",
    {
      title: "Run a GAQL query against Google Ads",
      description:
        "Runs a raw Google Ads Query Language (GAQL) query against a customer account and returns the " +
        "matching rows as JSON. This covers essentially any read: campaigns, ad groups, ads, keywords, " +
        "search terms, audiences, budgets, bidding strategies, conversions, change history, recommendations, " +
        "billing, and every performance metric, at any date range or segmentation. " +
        "Example: SELECT campaign.id, campaign.name, campaign.status, metrics.clicks, metrics.cost_micros, " +
        "metrics.conversions FROM campaign WHERE segments.date DURING LAST_7_DAYS ORDER BY metrics.cost_micros DESC. " +
        "If you're unsure of field/resource names, query the metadata: " +
        "SELECT name, category, data_type FROM google_ads_field WHERE name LIKE '%campaign%'. " +
        "Cost fields (e.g. metrics.cost_micros, campaign_budget.amount_micros) are in micros: divide by 1,000,000 " +
        "for the currency amount.",
      inputSchema: {
        query: z.string().describe("A valid GAQL query string."),
        customer_id: z
          .string()
          .optional()
          .describe(
            "Google Ads customer id to query, digits only (e.g. '1234567890'). Defaults to " +
              "GOOGLE_ADS_CUSTOMER_ID from the environment if omitted."
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ query, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const rows = await customer.query(query);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ row_count: rows.length, rows }, null, 2),
            },
          ],
          structuredContent: { row_count: rows.length, rows },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `GAQL query failed: ${formatGoogleAdsError(error)}` }],
        };
      }
    }
  );
}
