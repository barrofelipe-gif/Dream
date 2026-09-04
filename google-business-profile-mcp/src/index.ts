#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerPerformanceTools } from "./tools/performance.js";

const server = new McpServer({
  name: "google-business-profile-mcp",
  version: "1.0.0",
});

registerAccountTools(server);
registerPerformanceTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-business-profile-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-business-profile-mcp:", error);
  process.exit(1);
});
