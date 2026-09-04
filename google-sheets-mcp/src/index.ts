#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerValueTools } from "./tools/values.js";
import { registerSpreadsheetTools } from "./tools/spreadsheets.js";

const server = new McpServer({
  name: "google-sheets-mcp",
  version: "1.0.0",
});

registerValueTools(server);
registerSpreadsheetTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-sheets-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-sheets-mcp:", error);
  process.exit(1);
});
