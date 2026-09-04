import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toMicros } from "google-ads-api";
import { getCustomer, formatGoogleAdsError } from "../client.js";

const STATUS = ["ENABLED", "PAUSED", "REMOVED"] as const;
const MATCH_TYPE = ["EXACT", "PHRASE", "BROAD"] as const;

export function registerAdGroupTools(server: McpServer) {
  server.registerTool(
    "google_ads_create_ad_group",
    {
      title: "Create an ad group",
      description: "Creates an ad group inside an existing campaign.",
      inputSchema: {
        campaign_resource_name: z.string(),
        name: z.string(),
        status: z.enum(STATUS).default("ENABLED"),
        cpc_bid: z.number().positive().optional().describe("Default max CPC for this ad group, in account currency (only meaningful under Manual CPC bidding)."),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaign_resource_name, name, status, cpc_bid, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const resource: Record<string, unknown> = { campaign: campaign_resource_name, name, status, type: "SEARCH_STANDARD" };
        if (cpc_bid) resource.cpc_bid_micros = toMicros(cpc_bid);
        const result = await customer.mutateResources([{ entity: "ad_group", operation: "create", resource }]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to create ad group: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_update_ad_group",
    {
      title: "Update an ad group (status, name, or default CPC bid)",
      description: "Partially updates an ad group. Only the fields you pass are changed.",
      inputSchema: {
        ad_group_resource_name: z.string().describe("e.g. 'customers/123/adGroups/456'."),
        status: z.enum(STATUS).optional(),
        name: z.string().optional(),
        cpc_bid: z.number().positive().optional(),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ ad_group_resource_name, status, name, cpc_bid, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const resource: Record<string, unknown> = { resource_name: ad_group_resource_name };
        if (status) resource.status = status;
        if (name) resource.name = name;
        if (cpc_bid) resource.cpc_bid_micros = toMicros(cpc_bid);
        const result = await customer.mutateResources([{ entity: "ad_group", operation: "update", resource } as any]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to update ad group: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_add_keywords",
    {
      title: "Add keywords (positive or negative) to an ad group",
      description:
        "Adds one or more keyword criteria to an ad group. Set negative=true for a negative keyword " +
        "(blocks matching searches instead of targeting them).",
      inputSchema: {
        ad_group_resource_name: z.string(),
        keywords: z
          .array(
            z.object({
              text: z.string(),
              match_type: z.enum(MATCH_TYPE).default("EXACT"),
              negative: z.boolean().default(false),
              cpc_bid: z.number().positive().optional().describe("Keyword-level max CPC override, in account currency."),
            })
          )
          .min(1),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ ad_group_resource_name, keywords, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const operations = keywords.map((k) => {
          const resource: Record<string, unknown> = {
            ad_group: ad_group_resource_name,
            keyword: { text: k.text, match_type: k.match_type },
            negative: k.negative,
          };
          if (k.cpc_bid && !k.negative) resource.cpc_bid_micros = toMicros(k.cpc_bid);
          return { entity: "ad_group_criterion", operation: "create" as const, resource };
        });
        const result = await customer.mutateResources(operations as any);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to add keywords: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_update_keyword",
    {
      title: "Pause, enable, remove, or re-bid a keyword",
      description: "Updates status and/or CPC bid of an existing ad_group_criterion (keyword).",
      inputSchema: {
        criterion_resource_name: z.string().describe("e.g. 'customers/123/adGroupCriteria/456~789'."),
        status: z.enum(STATUS).optional(),
        cpc_bid: z.number().positive().optional(),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ criterion_resource_name, status, cpc_bid, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const resource: Record<string, unknown> = { resource_name: criterion_resource_name };
        if (status) resource.status = status;
        if (cpc_bid) resource.cpc_bid_micros = toMicros(cpc_bid);
        const result = await customer.mutateResources([{ entity: "ad_group_criterion", operation: "update", resource } as any]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to update keyword: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_create_responsive_search_ad",
    {
      title: "Create a Responsive Search Ad",
      description:
        "Creates an RSA in an ad group. Needs 3-15 headlines (<=30 chars each) and 2-4 descriptions " +
        "(<=90 chars each). Starts PAUSED unless status is ENABLED.",
      inputSchema: {
        ad_group_resource_name: z.string(),
        final_urls: z.array(z.string().url()).min(1),
        headlines: z.array(z.string().max(30)).min(3).max(15),
        descriptions: z.array(z.string().max(90)).min(2).max(4),
        path1: z.string().max(15).optional().describe("First display-path segment shown after the domain."),
        path2: z.string().max(15).optional(),
        status: z.enum(STATUS).default("PAUSED"),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ ad_group_resource_name, final_urls, headlines, descriptions, path1, path2, status, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const resource: Record<string, unknown> = {
          ad_group: ad_group_resource_name,
          status,
          ad: {
            final_urls,
            responsive_search_ad: {
              headlines: headlines.map((text) => ({ text })),
              descriptions: descriptions.map((text) => ({ text })),
              path1,
              path2,
            },
          },
        };
        const result = await customer.mutateResources([{ entity: "ad_group_ad", operation: "create", resource }]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to create ad: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_update_ad_status",
    {
      title: "Pause, enable, or remove an ad",
      description: "Changes an ad_group_ad's status.",
      inputSchema: {
        ad_group_ad_resource_name: z.string().describe("e.g. 'customers/123/adGroupAds/456~789'."),
        status: z.enum(STATUS),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ ad_group_ad_resource_name, status, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources([
          { entity: "ad_group_ad", operation: "update", resource: { resource_name: ad_group_ad_resource_name, status } } as any,
        ]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to update ad status: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );
}
