import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { content, resolveMerchantId, formatMerchantCenterError } from "../client.js";

export function registerDiagnosticsTools(server: McpServer) {
  server.registerTool(
    "gmc_get_account_status",
    {
      title: "Get Merchant Center account status",
      description:
        "Returns account-level diagnostics: overall standing, and issues affecting the whole " +
        "account (e.g. suspended, misrepresentation, policy violations) rather than a single " +
        "product. Start here for 'why is my account/Shopping ads not working' questions.",
      inputSchema: {
        merchant_id: z.string().optional().describe("Defaults to GOOGLE_MERCHANT_CENTER_MERCHANT_ID."),
        destinations: z
          .array(z.string())
          .optional()
          .describe("Limit issues to these destinations (e.g. ['Shopping']). Defaults to Shopping."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ merchant_id, destinations }) => {
      try {
        const merchantId = resolveMerchantId(merchant_id);
        const { data } = await content.accountstatuses.get({
          merchantId,
          accountId: merchantId,
          destinations,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get account status: ${formatMerchantCenterError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gmc_list_product_statuses",
    {
      title: "List product statuses (approval/disapproval + issues)",
      description:
        "Lists every product in the account with its approval status per destination and the " +
        "specific issues found (disapproval reasons, warnings, data quality problems). This is the " +
        "direct answer to 'why isn't this product showing up in Google Shopping'. Paginate with " +
        "page_token from a previous response's nextPageToken.",
      inputSchema: {
        merchant_id: z.string().optional().describe("Defaults to GOOGLE_MERCHANT_CENTER_MERCHANT_ID."),
        destinations: z.array(z.string()).optional().describe("Defaults to Shopping."),
        max_results: z.number().int().positive().max(250).default(250),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ merchant_id, destinations, max_results, page_token }) => {
      try {
        const merchantId = resolveMerchantId(merchant_id);
        const { data } = await content.productstatuses.list({
          merchantId,
          destinations,
          maxResults: max_results,
          pageToken: page_token,
        });
        const result = {
          resources: data.resources ?? [],
          next_page_token: data.nextPageToken,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list product statuses: ${formatMerchantCenterError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gmc_get_product_status",
    {
      title: "Get one product's status and issues",
      description: "Fetches the approval status and issues for a single product by its REST id.",
      inputSchema: {
        merchant_id: z.string().optional().describe("Defaults to GOOGLE_MERCHANT_CENTER_MERCHANT_ID."),
        product_id: z
          .string()
          .describe("REST product id, e.g. 'online:en:BR:sku123' (channel:language:country:offerId)."),
        destinations: z.array(z.string()).optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ merchant_id, product_id, destinations }) => {
      try {
        const merchantId = resolveMerchantId(merchant_id);
        const { data } = await content.productstatuses.get({
          merchantId,
          productId: product_id,
          destinations,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get product status: ${formatMerchantCenterError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gmc_list_products",
    {
      title: "List products in the feed",
      description:
        "Lists the raw product data submitted to Merchant Center (title, price, availability, " +
        "GTIN, image, etc.) — not their approval status. Use gmc_list_product_statuses instead when " +
        "the question is about why a product isn't showing up.",
      inputSchema: {
        merchant_id: z.string().optional().describe("Defaults to GOOGLE_MERCHANT_CENTER_MERCHANT_ID."),
        max_results: z.number().int().positive().max(250).default(250),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ merchant_id, max_results, page_token }) => {
      try {
        const merchantId = resolveMerchantId(merchant_id);
        const { data } = await content.products.list({
          merchantId,
          maxResults: max_results,
          pageToken: page_token,
        });
        const result = {
          resources: data.resources ?? [],
          next_page_token: data.nextPageToken,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list products: ${formatMerchantCenterError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gmc_get_product",
    {
      title: "Get one product's raw feed data",
      description: "Fetches the full submitted data for a single product by its REST id.",
      inputSchema: {
        merchant_id: z.string().optional().describe("Defaults to GOOGLE_MERCHANT_CENTER_MERCHANT_ID."),
        product_id: z
          .string()
          .describe("REST product id, e.g. 'online:en:BR:sku123' (channel:language:country:offerId)."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ merchant_id, product_id }) => {
      try {
        const merchantId = resolveMerchantId(merchant_id);
        const { data } = await content.products.get({ merchantId, productId: product_id });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get product: ${formatMerchantCenterError(error)}` }],
        };
      }
    }
  );
}
