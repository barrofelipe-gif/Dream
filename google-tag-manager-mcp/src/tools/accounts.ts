import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tagmanager, resolveAccountId, formatGtmError } from "../client.js";

export function registerAccountTools(server: McpServer) {
  server.registerTool(
    "gtm_list_accounts",
    {
      title: "List Google Tag Manager accounts",
      description:
        "Lists every GTM account the authenticated refresh token can access. Call this first if " +
        "you don't already know which account_id to use.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const { data } = await tagmanager.accounts.list();
        const accounts = data.account ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ accounts }, null, 2) }],
          structuredContent: { accounts },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list accounts: ${formatGtmError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gtm_list_containers",
    {
      title: "List containers in a GTM account",
      description: "Lists every container (web, AMP, iOS, Android, server) in a GTM account.",
      inputSchema: {
        account_id: z.string().optional().describe("Defaults to GOOGLE_TAG_MANAGER_ACCOUNT_ID."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ account_id }) => {
      try {
        const accountId = resolveAccountId(account_id);
        const { data } = await tagmanager.accounts.containers.list({ parent: `accounts/${accountId}` });
        const containers = data.container ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ containers }, null, 2) }],
          structuredContent: { containers },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list containers: ${formatGtmError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gtm_list_workspaces",
    {
      title: "List workspaces in a GTM container",
      description:
        "Lists every workspace (draft/staging area) in a container. All entity reads/writes " +
        "(tags, triggers, variables, etc.) happen inside a specific workspace — get its numeric id " +
        "from here to build a workspace_path like " +
        "'accounts/{account_id}/containers/{container_id}/workspaces/{workspace_id}'.",
      inputSchema: {
        account_id: z.string().optional().describe("Defaults to GOOGLE_TAG_MANAGER_ACCOUNT_ID."),
        container_id: z.string().describe("Numeric container id, from gtm_list_containers."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ account_id, container_id }) => {
      try {
        const accountId = resolveAccountId(account_id);
        const { data } = await tagmanager.accounts.containers.workspaces.list({
          parent: `accounts/${accountId}/containers/${container_id}`,
        });
        const workspaces = data.workspace ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ workspaces }, null, 2) }],
          structuredContent: { workspaces },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list workspaces: ${formatGtmError(error)}` }],
        };
      }
    }
  );
}
