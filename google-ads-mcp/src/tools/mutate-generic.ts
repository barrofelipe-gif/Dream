import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCustomer, formatGoogleAdsError } from "../client.js";

const operationSchema = z.object({
  entity: z
    .string()
    .describe(
      "Google Ads resource type in snake_case, e.g. 'campaign', 'campaign_budget', 'ad_group', " +
        "'ad_group_ad', 'ad_group_criterion', 'campaign_criterion', 'shared_set', " +
        "'shared_criterion', 'conversion_action', 'customer_negative_criterion', 'asset', " +
        "'asset_group', 'campaign_asset', 'bidding_strategy', 'label', 'campaign_label', " +
        "'ad_group_label'. Any mutable Google Ads resource is valid here — this tool is a direct " +
        "passthrough to the API's mutate call."
    ),
  operation: z.enum(["create", "update", "remove"]),
  resource: z
    .record(z.any())
    .optional()
    .describe(
      "The resource fields (snake_case, matching the Google Ads API resource proto) for 'create' or " +
        "'update'. Not needed for 'remove'. For 'create', use ResourceNames-style temp resource_names " +
        "(e.g. 'customers/123/campaigns/-1') if you need to reference this new resource from another " +
        "operation in the SAME call; otherwise omit resource_name and Google assigns a real id. For " +
        "'update', you MUST include the real resource_name of the entity being updated."
    ),
  resource_name: z
    .string()
    .optional()
    .describe("For 'remove', the full resource_name of the entity to remove, e.g. 'customers/123/campaigns/456'."),
});

export function registerGenericMutateTool(server: McpServer) {
  server.registerTool(
    "google_ads_mutate",
    {
      title: "Run raw Google Ads mutate operations (full API write access)",
      description:
        "Direct passthrough to the Google Ads API's mutate call. Use this for ANY write the dedicated " +
        "tools (create_campaign, update_campaign_budget, add_keywords, etc.) don't cover — shared sets, " +
        "conversion actions, customer-level negative lists, labels, Performance Max asset groups and " +
        "assets, bidding strategies, experiments, and any other mutable resource. " +
        "Accepts a batch of operations, each {entity, operation, resource | resource_name}, applied " +
        "atomically in one request. Prefer the dedicated tools for common tasks (they're safer and " +
        "simpler); use this when you need full API coverage. " +
        "Tip: run with validate_only=true first to check for errors without making changes.",
      inputSchema: {
        operations: z.array(operationSchema).min(1),
        customer_id: z.string().optional().describe("Defaults to GOOGLE_ADS_CUSTOMER_ID if omitted."),
        validate_only: z
          .boolean()
          .optional()
          .describe("If true, validates the operations without actually applying them. Defaults to false."),
        partial_failure: z
          .boolean()
          .optional()
          .describe(
            "If true, valid operations succeed even if others in the batch fail. Defaults to false " +
              "(all-or-nothing)."
          ),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ operations, customer_id, validate_only, partial_failure }) => {
      try {
        const customer = getCustomer(customer_id);
        const result = await customer.mutateResources(operations as any, {
          validate_only: validate_only ?? false,
          partial_failure: partial_failure ?? false,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result as any,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Mutate failed: ${formatGoogleAdsError(error)}` }],
        };
      }
    }
  );
}
