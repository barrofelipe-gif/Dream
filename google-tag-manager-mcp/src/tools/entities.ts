import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ENTITY_TYPES, ENTITY_TYPE_NAMES, formatGtmError, type EntityType } from "../client.js";

const entityTypeSchema = z
  .enum(ENTITY_TYPE_NAMES as [EntityType, ...EntityType[]])
  .describe(`Workspace entity type: ${ENTITY_TYPE_NAMES.join(", ")}.`);

function getEntity(entityType: EntityType) {
  // Cast to any: the 7 GTM entity resources share an identical {list/get/create/update/delete}
  // shape (parent/path/requestBody/fingerprint), but each has its own generated TS overloads
  // keyed to its own Schema$* type — a real union type here buys nothing but friction.
  return ENTITY_TYPES[entityType] as unknown as {
    resource: any;
    listField: string;
  };
}

export function registerEntityTools(server: McpServer) {
  server.registerTool(
    "gtm_list_entities",
    {
      title: "List tags, triggers, variables, folders, clients, zones or templates in a workspace",
      description:
        "Lists every entity of one type in a GTM workspace — tags, triggers, variables, folders, " +
        "clients (server-side containers), zones, or custom templates. Call gtm_list_workspaces first " +
        "to get the workspace_path.",
      inputSchema: {
        entity_type: entityTypeSchema,
        workspace_path: z
          .string()
          .describe("e.g. 'accounts/123/containers/456/workspaces/7', from gtm_list_workspaces."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ entity_type, workspace_path }) => {
      try {
        const { resource, listField } = getEntity(entity_type);
        const { data } = await resource.list({ parent: workspace_path });
        const items = data[listField] ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ [listField + "s"]: items }, null, 2) }],
          structuredContent: { items },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list ${entity_type}: ${formatGtmError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gtm_get_entity",
    {
      title: "Get one tag, trigger, variable, folder, client, zone or template",
      description: "Fetches the full definition of a single workspace entity by its API path.",
      inputSchema: {
        entity_type: entityTypeSchema,
        path: z
          .string()
          .describe(
            "e.g. 'accounts/123/containers/456/workspaces/7/tags/8', from gtm_list_entities."
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ entity_type, path }) => {
      try {
        const { resource } = getEntity(entity_type);
        const { data } = await resource.get({ path });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get ${entity_type}: ${formatGtmError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gtm_create_entity",
    {
      title: "Create a tag, trigger, variable, folder, client, zone or template",
      description:
        "Creates a new entity in a workspace. `body` is the raw GTM API resource object for that " +
        "entity type (e.g. for a tag: {name, type, parameter: [...], firingTriggerId: [...]}) — see " +
        "https://developers.google.com/tag-platform/tag-manager/api/v2/reference for the full schema " +
        "per type. Tip: read an existing similar entity with gtm_get_entity first to see the exact " +
        "shape expected, then adapt it.",
      inputSchema: {
        entity_type: entityTypeSchema,
        workspace_path: z.string(),
        body: z.record(z.any()).describe("Raw entity resource body (without accountId/containerId/etc.)."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ entity_type, workspace_path, body }) => {
      try {
        const { resource } = getEntity(entity_type);
        const { data } = await resource.create({ parent: workspace_path, requestBody: body });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to create ${entity_type}: ${formatGtmError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gtm_update_entity",
    {
      title: "Update a tag, trigger, variable, folder, client, zone or template",
      description:
        "Replaces an existing entity's definition. `body` must be the full entity object (partial " +
        "updates aren't supported by the GTM API) — read it first with gtm_get_entity, edit the " +
        "fields you want changed, and pass the whole thing back.",
      inputSchema: {
        entity_type: entityTypeSchema,
        path: z.string(),
        body: z.record(z.any()),
        fingerprint: z
          .string()
          .optional()
          .describe("Optional optimistic-concurrency check — must match the entity's current fingerprint if set."),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ entity_type, path, body, fingerprint }) => {
      try {
        const { resource } = getEntity(entity_type);
        const { data } = await resource.update({ path, requestBody: body, fingerprint });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to update ${entity_type}: ${formatGtmError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "gtm_delete_entity",
    {
      title: "Delete a tag, trigger, variable, folder, client, zone or template",
      description:
        "Permanently deletes an entity from a workspace. There is no undo — double-check the path first.",
      inputSchema: {
        entity_type: entityTypeSchema,
        path: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ entity_type, path }) => {
      try {
        const { resource } = getEntity(entity_type);
        await resource.delete({ path });
        const result = { deleted: path };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to delete ${entity_type}: ${formatGtmError(error)}` }],
        };
      }
    }
  );
}
