#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerChannelTools } from "./tools/channel.js";
import { registerVideoTools } from "./tools/videos.js";
import { registerCommentTools } from "./tools/comments.js";
import { registerAnalyticsTools } from "./tools/analytics.js";

const server = new McpServer({
  name: "google-youtube-mcp",
  version: "1.0.0",
});

registerChannelTools(server);
registerVideoTools(server);
registerCommentTools(server);
registerAnalyticsTools(server);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-youtube-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-youtube-mcp:", error);
  process.exit(1);
});
