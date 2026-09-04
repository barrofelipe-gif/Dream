#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerAccountTools } from "./tools/accounts.js";
import { registerEntityTools } from "./tools/entities.js";
import { registerVersionTools } from "./tools/versions.js";

const server = new McpServer({
  name: "google-tag-manager-mcp",
  version: "1.0.0",
});

registerAccountTools(server);
registerEntityTools(server);
registerVersionTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-tag-manager-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-tag-manager-mcp:", error);
  process.exit(1);
});
