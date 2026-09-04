#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerQueryTools } from "./tools/query.js";
import { registerGenericMutateTool } from "./tools/mutate-generic.js";
import { registerCampaignTools } from "./tools/campaigns.js";
import { registerAdGroupTools } from "./tools/adgroups.js";

const server = new McpServer({
  name: "google-ads-mcp",
  version: "1.0.0",
});

registerQueryTools(server);
registerGenericMutateTool(server);
registerCampaignTools(server);
registerAdGroupTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-ads-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-ads-mcp:", error);
  process.exit(1);
});
