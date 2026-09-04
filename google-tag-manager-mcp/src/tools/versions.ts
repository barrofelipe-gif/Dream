import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tagmanager, resolveAccountId, formatGtmError } from "../client.js";

export function registerVersionTools(server: McpServer) {
  server.registerTool(
    "gtm_list_versions",
    {
      title: "List container versions (publish history)",
      description:
        "Lists every published (and, optionally, deleted/archived) version of a container — the " +
        "publish history you'd see under Versions in the GTM UI.",
      inputSchema: {
        account_id: z.string().optional().describe("Defaults to GOOGLE_TAG_MANAGER_ACCOUNT_ID."),
        container_id: z.string().describe("Numeric container id, from gtm_list_containers."),
        include_deleted: z.boolean().default(false),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ account_id, container_id, include_deleted }) => {
      try {
        const accountId = resolveAccountId(account_id);
        const { data } = await tagmanager.accounts.containers.version_headers.list({
          parent: `accounts/${accountId}/containers/${container_id}`,
          includeDeleted: include_deleted,
        });
        const versions = data.containerVersionHeader ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ versions }, null, 2) }],
          structuredContent: { versions },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list versions: ${formatGtmError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gtm_create_version",
    {
      title: "Create a container version from a workspace",
      description:
        "Snapshots the current state of a workspace (all its tag/trigger/variable changes) into a " +
        "new container version. This does NOT publish it live — call gtm_publish_version afterwards " +
        "with the returned version path to make it live. This is the GTM equivalent of 'Submit' in the UI.",
      inputSchema: {
        workspace_path: z
          .string()
          .describe("e.g. 'accounts/123/containers/456/workspaces/7', from gtm_list_workspaces."),
        name: z.string().optional().describe("Version name, shown in the version history."),
        notes: z.string().optional().describe("Version notes/changelog."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ workspace_path, name, notes }) => {
      try {
        const { data } = await tagmanager.accounts.containers.workspaces.create_version({
          path: workspace_path,
          requestBody: { name, notes },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to create version: ${formatGtmError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gtm_publish_version",
    {
      title: "Publish a container version live",
      description:
        "Publishes a container version so it goes live on the site/app — the equivalent of clicking " +
        "'Publish' in the GTM UI. This affects real traffic immediately; there is no staging step " +
        "after this. Get the version_path from the response of gtm_create_version or from gtm_list_versions.",
      inputSchema: {
        version_path: z
          .string()
          .describe("e.g. 'accounts/123/containers/456/versions/9', from gtm_create_version."),
        fingerprint: z
          .string()
          .optional()
          .describe("Optional optimistic-concurrency check — must match the version's current fingerprint if set."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ version_path, fingerprint }) => {
      try {
        const { data } = await tagmanager.accounts.containers.versions.publish({
          path: version_path,
          fingerprint,
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to publish version: ${formatGtmError(error)}` }],
        };
      }
    }
  );
}
