import { google, tagmanager_v2 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { config } from "./config.js";

const oauth2Client = new OAuth2Client(config.clientId, config.clientSecret);
oauth2Client.setCredentials({ refresh_token: config.refreshToken });

export const tagmanager = google.tagmanager({ version: "v2", auth: oauth2Client });

export function resolveAccountId(accountIdInput?: string): string {
  const accountId = accountIdInput ?? config.defaultAccountId;
  if (!accountId) {
    throw new Error(
      "No account_id provided and GOOGLE_TAG_MANAGER_ACCOUNT_ID is not set. Pass account_id " +
        "explicitly, or call gtm_list_accounts to find one."
    );
  }
  return accountId;
}

export function resolveContainerPath(accountIdInput?: string, containerIdInput?: string): string {
  const accountId = resolveAccountId(accountIdInput);
  const containerId = containerIdInput ?? config.defaultContainerId;
  if (!containerId) {
    throw new Error(
      "No container_id provided and GOOGLE_TAG_MANAGER_CONTAINER_ID is not set. Pass " +
        "container_id explicitly, or call gtm_list_containers to find one."
    );
  }
  return `accounts/${accountId}/containers/${containerId}`;
}

/**
 * Workspace entity types this server exposes generic CRUD for. Each maps to the equivalent
 * `tagmanager.accounts.containers.workspaces.<resource>` client and the field name the List
 * response uses for its array of items — both differ per entity type but every entity otherwise
 * shares the same {parent, path, requestBody, fingerprint} shape.
 */
export const ENTITY_TYPES = {
  tags: { resource: tagmanager.accounts.containers.workspaces.tags, listField: "tag" },
  triggers: { resource: tagmanager.accounts.containers.workspaces.triggers, listField: "trigger" },
  variables: { resource: tagmanager.accounts.containers.workspaces.variables, listField: "variable" },
  folders: { resource: tagmanager.accounts.containers.workspaces.folders, listField: "folder" },
  clients: { resource: tagmanager.accounts.containers.workspaces.clients, listField: "client" },
  zones: { resource: tagmanager.accounts.containers.workspaces.zones, listField: "zone" },
  templates: { resource: tagmanager.accounts.containers.workspaces.templates, listField: "template" },
} as const;

export type EntityType = keyof typeof ENTITY_TYPES;
export const ENTITY_TYPE_NAMES = Object.keys(ENTITY_TYPES) as EntityType[];

/** Formats a Google API client error into a readable message for the LLM. */
export function formatGtmError(error: unknown): string {
  const err = error as any;
  const message = err?.response?.data?.error?.message ?? err?.errors?.[0]?.message ?? err?.message;
  return message ?? String(error);
}

export type { tagmanager_v2 };
