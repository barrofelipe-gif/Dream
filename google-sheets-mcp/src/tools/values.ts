import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { sheets, formatSheetsError } from "../client.js";

export function registerValueTools(server: McpServer) {
  server.registerTool(
    "sheets_get_values",
    {
      title: "Read a range of cells",
      description: "Reads cell values from a range (A1 notation, e.g. 'Sheet1!A1:D20' or just 'Sheet1').",
      inputSchema: {
        spreadsheet_id: z.string().describe("From the sheet's URL: docs.google.com/spreadsheets/d/<this>/edit."),
        range: z.string(),
        value_render_option: z.enum(["FORMATTED_VALUE", "UNFORMATTED_VALUE", "FORMULA"]).default("FORMATTED_VALUE"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ spreadsheet_id, range, value_render_option }) => {
      try {
        const { data } = await sheets.spreadsheets.values.get({
          spreadsheetId: spreadsheet_id,
          range,
          valueRenderOption: value_render_option,
        });
        const result = { range: data.range, values: data.values ?? [] };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to read range: ${formatSheetsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "sheets_update_values",
    {
      title: "Write values into a range",
      description:
        "Overwrites a range with the given 2D array of values (row-major: values[0] is row 1, " +
        "values[0][0] is the first cell). Existing cells outside the written range are untouched.",
      inputSchema: {
        spreadsheet_id: z.string(),
        range: z.string().describe("Top-left cell of where to start writing, e.g. 'Sheet1!A1'."),
        values: z.array(z.array(z.any())).describe("Row-major 2D array of cell values."),
        value_input_option: z
          .enum(["RAW", "USER_ENTERED"])
          .default("USER_ENTERED")
          .describe("USER_ENTERED parses formulas/dates/numbers like typing in the UI; RAW stores literal strings."),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ spreadsheet_id, range, values, value_input_option }) => {
      try {
        const { data } = await sheets.spreadsheets.values.update({
          spreadsheetId: spreadsheet_id,
          range,
          valueInputOption: value_input_option,
          requestBody: { values },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to write range: ${formatSheetsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "sheets_append_values",
    {
      title: "Append rows to the end of a table",
      description:
        "Finds the last row of data in the given range's table and appends new rows right after it — " +
        "the right tool for adding new records without overwriting anything (e.g. a log, a report row).",
      inputSchema: {
        spreadsheet_id: z.string(),
        range: z.string().describe("A range identifying the table to append to, e.g. 'Sheet1!A:D' or 'Sheet1'."),
        values: z.array(z.array(z.any())).describe("Row-major 2D array of rows to append."),
        value_input_option: z.enum(["RAW", "USER_ENTERED"]).default("USER_ENTERED"),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ spreadsheet_id, range, values, value_input_option }) => {
      try {
        const { data } = await sheets.spreadsheets.values.append({
          spreadsheetId: spreadsheet_id,
          range,
          valueInputOption: value_input_option,
          insertDataOption: "INSERT_ROWS",
          requestBody: { values },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to append rows: ${formatSheetsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "sheets_clear_values",
    {
      title: "Clear a range's contents",
      description: "Clears all values in a range, leaving formatting untouched. There is no undo.",
      inputSchema: {
        spreadsheet_id: z.string(),
        range: z.string(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ spreadsheet_id, range }) => {
      try {
        const { data } = await sheets.spreadsheets.values.clear({
          spreadsheetId: spreadsheet_id,
          range,
          requestBody: {},
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to clear range: ${formatSheetsError(error)}` }],
        };
      }
    }
  );
}
