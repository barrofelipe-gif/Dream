#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerSearchConsoleTools } from "./tools/search-analytics.js";

const server = new McpServer({
  name: "google-search-console-mcp",
  version: "1.0.0",
});

registerSearchConsoleTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-search-console-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-search-console-mcp:", error);
  process.exit(1);
});
