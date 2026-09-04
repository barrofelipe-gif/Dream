import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { accountManagement, businessInformation, formatBusinessProfileError } from "../client.js";

const DEFAULT_READ_MASK =
  "name,title,storeCode,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,specialHours,serviceArea,labels,latlng,openInfo,metadata,profile";

export function registerAccountTools(server: McpServer) {
  server.registerTool(
    "gbp_list_accounts",
    {
      title: "List Google Business Profile accounts",
      description:
        "Lists every Business Profile account (personal or organization) the authenticated " +
        "refresh token can access. Call this first if you don't already know which account to use.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const { data } = await accountManagement.accounts.list({});
        const accounts = data.accounts ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ accounts }, null, 2) }],
          structuredContent: { accounts },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list accounts: ${formatBusinessProfileError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gbp_list_locations",
    {
      title: "List business locations in an account",
      description:
        "Lists every location (physical store/branch) under a Business Profile account, with basic " +
        "info (title, address, phone, category). Use gbp_get_location for a location's full details.",
      inputSchema: {
        account_name: z.string().describe("From gbp_list_accounts, e.g. 'accounts/123456789'."),
        page_size: z.number().int().positive().max(100).default(100),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ account_name, page_size, page_token }) => {
      try {
        const { data } = await businessInformation.accounts.locations.list({
          parent: account_name,
          pageSize: page_size,
          pageToken: page_token,
          readMask: DEFAULT_READ_MASK,
        });
        const result = { locations: data.locations ?? [], next_page_token: data.nextPageToken };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list locations: ${formatBusinessProfileError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gbp_get_location",
    {
      title: "Get full details of one business location",
      description:
        "Fetches the complete profile of a single location: hours (regular and special), address, " +
        "phone numbers, categories, website, service area, labels and metadata.",
      inputSchema: {
        location_name: z.string().describe("From gbp_list_locations, e.g. 'locations/987654321'."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ location_name }) => {
      try {
        const { data } = await businessInformation.locations.get({
          name: location_name,
          readMask: DEFAULT_READ_MASK,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get location: ${formatBusinessProfileError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gbp_update_location",
    {
      title: "Update a business location's info",
      description:
        "Updates one or more fields of a location (e.g. hours, phone number, website). `body` must " +
        "contain only the fields being changed, and `update_mask` must list their field paths " +
        "(comma-separated, e.g. 'phoneNumbers,regularHours') — read the location first with " +
        "gbp_get_location to see the current shape of what you're editing.",
      inputSchema: {
        location_name: z.string().describe("e.g. 'locations/987654321'."),
        update_mask: z.string().describe("Comma-separated field paths being updated, e.g. 'phoneNumbers,websiteUri'."),
        body: z.record(z.any()).describe("Partial Location object containing only the fields in update_mask."),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ location_name, update_mask, body }) => {
      try {
        const { data } = await businessInformation.locations.patch({
          name: location_name,
          updateMask: update_mask,
          requestBody: body,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to update location: ${formatBusinessProfileError(error)}` }],
        };
      }
    }
  );
}
