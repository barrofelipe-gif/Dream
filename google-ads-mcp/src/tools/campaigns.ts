import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { toMicros } from "google-ads-api";
import { getCustomer, formatGoogleAdsError } from "../client.js";

const CHANNEL_TYPES = ["SEARCH", "DISPLAY", "SHOPPING", "VIDEO", "PERFORMANCE_MAX", "LOCAL", "SMART"] as const;
const CAMPAIGN_STATUS = ["ENABLED", "PAUSED", "REMOVED"] as const;

export function registerCampaignTools(server: McpServer) {
  server.registerTool(
    "google_ads_create_campaign_budget",
    {
      title: "Create a campaign budget",
      description:
        "Creates a standalone campaign budget. Returns its resource_name — pass that into " +
        "google_ads_create_campaign's budget_resource_name.",
      inputSchema: {
        name: z.string(),
        daily_amount: z.number().positive().describe("Daily budget in the account's currency (e.g. 50.00 for R$50/day)."),
        shared: z.boolean().optional().describe("If true, this budget can be shared across multiple campaigns. Defaults to false."),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, daily_amount, shared, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources([
          {
            entity: "campaign_budget",
            operation: "create",
            resource: {
              name,
              amount_micros: toMicros(daily_amount),
              explicitly_shared: shared ?? false,
            },
          },
        ]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to create budget: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_update_campaign_budget",
    {
      title: "Update a campaign budget's daily amount",
      description: "Changes the daily amount of an existing campaign budget.",
      inputSchema: {
        budget_resource_name: z.string().describe("e.g. 'customers/123/campaignBudgets/456'."),
        daily_amount: z.number().positive().describe("New daily budget in the account's currency."),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ budget_resource_name, daily_amount, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources([
          {
            entity: "campaign_budget",
            operation: "update",
            resource: { resource_name: budget_resource_name, amount_micros: toMicros(daily_amount) },
          } as any,
        ]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to update budget: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_create_campaign",
    {
      title: "Create a campaign",
      description:
        "Creates a campaign linked to an existing campaign budget (create one first with " +
        "google_ads_create_campaign_budget). Starts PAUSED unless status is set to ENABLED. " +
        "For SEARCH campaigns, network settings default to Google Search + Search Partners.",
      inputSchema: {
        name: z.string(),
        budget_resource_name: z.string().describe("Resource name from google_ads_create_campaign_budget."),
        advertising_channel_type: z.enum(CHANNEL_TYPES).default("SEARCH"),
        status: z.enum(CAMPAIGN_STATUS).default("PAUSED"),
        target_cpa_micros: z.number().positive().optional().describe("Optional Target CPA bidding strategy, in micros of the account currency (e.g. 10000000 = 10.00)."),
        manual_cpc: z.boolean().optional().describe("If true (and target_cpa_micros is not set), use Manual CPC bidding. Defaults to true when no other strategy is given."),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ name, budget_resource_name, advertising_channel_type, status, target_cpa_micros, manual_cpc, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const resource: Record<string, unknown> = {
          name,
          campaign_budget: budget_resource_name,
          advertising_channel_type,
          status,
        };
        if (target_cpa_micros) {
          resource.target_cpa = { target_cpa_micros };
        } else if (manual_cpc ?? true) {
          resource.manual_cpc = {};
        }
        if (advertising_channel_type === "SEARCH") {
          resource.network_settings = {
            target_google_search: true,
            target_search_network: true,
            target_content_network: false,
            target_partner_search_network: false,
          };
        }
        const result = await customer.mutateResources([{ entity: "campaign", operation: "create", resource }]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to create campaign: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_update_campaign_status",
    {
      title: "Pause, enable, or remove a campaign",
      description: "Changes a campaign's status. REMOVED is permanent (Google Ads does not support un-removing a campaign).",
      inputSchema: {
        campaign_resource_name: z.string().describe("e.g. 'customers/123/campaigns/456'."),
        status: z.enum(CAMPAIGN_STATUS),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ campaign_resource_name, status, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources([
          {
            entity: "campaign",
            operation: "update",
            resource: { resource_name: campaign_resource_name, status },
          } as any,
        ]);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to update campaign status: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );

  server.registerTool(
    "google_ads_add_campaign_criteria",
    {
      title: "Add targeting or negative keywords to a campaign",
      description:
        "Adds campaign-level criteria: geographic targeting (location constant ids), languages, device " +
        "bid modifiers, or negative keywords. Get location/language constant ids by querying " +
        "geo_target_constant / language_constant with google_ads_query first.",
      inputSchema: {
        campaign_resource_name: z.string(),
        criteria: z
          .array(
            z.union([
              z.object({ type: z.literal("location"), geo_target_constant_resource_name: z.string() }),
              z.object({ type: z.literal("language"), language_constant_resource_name: z.string() }),
              z.object({
                type: z.literal("negative_keyword"),
                text: z.string(),
                match_type: z.enum(["EXACT", "PHRASE", "BROAD"]).default("BROAD"),
              }),
              z.object({
                type: z.literal("device"),
                device: z.enum(["MOBILE", "DESKTOP", "TABLET", "CONNECTED_TV"]),
                bid_modifier: z.number().min(0).max(10).describe("e.g. 1.2 for +20%, 0.8 for -20%."),
              }),
            ])
          )
          .min(1),
        customer_id: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ campaign_resource_name, criteria, customer_id }) => {
      try {
        const customer = getCustomer(customer_id);
        const operations = criteria.map((c) => {
          const base: Record<string, unknown> = { campaign: campaign_resource_name };
          if (c.type === "location") {
            base.location = { geo_target_constant: c.geo_target_constant_resource_name };
          } else if (c.type === "language") {
            base.language = { language_constant: c.language_constant_resource_name };
          } else if (c.type === "negative_keyword") {
            base.negative = true;
            base.keyword = { text: c.text, match_type: c.match_type };
          } else if (c.type === "device") {
            base.device = { type: c.device };
            base.bid_modifier = c.bid_modifier;
          }
          return { entity: "campaign_criterion", operation: "create" as const, resource: base };
        });
        const result = await customer.mutateResources(operations as any);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }], structuredContent: result as any };
      } catch (error) {
        return { isError: true, content: [{ type: "text", text: `Failed to add campaign criteria: ${formatGoogleAdsError(error)}` }] };
      }
    }
  );
}
