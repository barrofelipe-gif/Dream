#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerDiagnosticsTools } from "./tools/diagnostics.js";

const server = new McpServer({
  name: "google-merchant-center-mcp",
  version: "1.0.0",
});

registerDiagnosticsTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-merchant-center-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-merchant-center-mcp:", error);
  process.exit(1);
});
