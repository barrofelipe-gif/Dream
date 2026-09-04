import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sheets, formatSheetsError } from "../client.js";

export function registerSpreadsheetTools(server: McpServer) {
  server.registerTool(
    "sheets_get_metadata",
    {
      title: "Get spreadsheet metadata (title, sheet names/ids)",
      description:
        "Returns the spreadsheet's title and the list of individual sheets (tabs) inside it, with " +
        "each one's numeric sheetId, title, row/column count and index. Call this first if you don't " +
        "know the exact sheet/tab name to use in a range.",
      inputSchema: {
        spreadsheet_id: z.string(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ spreadsheet_id }) => {
      try {
        const { data } = await sheets.spreadsheets.get({ spreadsheetId: spreadsheet_id });
        const result = {
          title: data.properties?.title,
          spreadsheet_url: data.spreadsheetUrl,
          sheets: (data.sheets ?? []).map((s) => ({
            sheetId: s.properties?.sheetId,
            title: s.properties?.title,
            index: s.properties?.index,
            rowCount: s.properties?.gridProperties?.rowCount,
            columnCount: s.properties?.gridProperties?.columnCount,
          })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get spreadsheet metadata: ${formatSheetsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "sheets_create_spreadsheet",
    {
      title: "Create a new spreadsheet",
      description:
        "Creates a brand new Google Sheets spreadsheet, owned by the authenticated account, and " +
        "returns its id and URL. Optionally names the initial sheet tabs.",
      inputSchema: {
        title: z.string().describe("Spreadsheet title."),
        sheet_titles: z
          .array(z.string())
          .optional()
          .describe("Names for the initial tabs, e.g. ['Resumo', 'Dados']. Defaults to a single 'Sheet1'."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ title, sheet_titles }) => {
      try {
        const { data } = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title },
            sheets: sheet_titles?.map((t) => ({ properties: { title: t } })),
          },
        });
        const result = { spreadsheet_id: data.spreadsheetId, spreadsheet_url: data.spreadsheetUrl };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to create spreadsheet: ${formatSheetsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "sheets_add_sheet",
    {
      title: "Add a new tab to an existing spreadsheet",
      description: "Adds a new sheet (tab) to an existing spreadsheet and returns its new sheetId.",
      inputSchema: {
        spreadsheet_id: z.string(),
        title: z.string().describe("Name for the new tab."),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ spreadsheet_id, title }) => {
      try {
        const { data } = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheet_id,
          requestBody: { requests: [{ addSheet: { properties: { title } } }] },
        });
        const addedSheet = data.replies?.[0]?.addSheet?.properties;
        const result = { sheetId: addedSheet?.sheetId, title: addedSheet?.title };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to add sheet: ${formatSheetsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "sheets_batch_update",
    {
      title: "Apply raw batchUpdate requests (formatting, rows/columns, sorting, etc.)",
      description:
        "Passthrough for any Sheets API batchUpdate request the ergonomic tools above don't cover — " +
        "cell formatting, conditional formatting, merging cells, inserting/deleting rows or columns, " +
        "sorting, data validation, charts, etc. `requests` is the raw array of Request objects from " +
        "https://developers.google.com/sheets/api/reference/rest/v4/spreadsheets/request",
      inputSchema: {
        spreadsheet_id: z.string(),
        requests: z.array(z.record(z.any())),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ spreadsheet_id, requests }) => {
      try {
        const { data } = await sheets.spreadsheets.batchUpdate({
          spreadsheetId: spreadsheet_id,
          requestBody: { requests },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `batchUpdate failed: ${formatSheetsError(error)}` }],
        };
      }
    }
  );
}
