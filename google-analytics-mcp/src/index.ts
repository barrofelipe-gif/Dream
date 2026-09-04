#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerReportTools } from "./tools/reports.js";

const server = new McpServer({
  name: "google-analytics-mcp",
  version: "1.0.0",
});

registerReportTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-analytics-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-analytics-mcp:", error);
  process.exit(1);
});
