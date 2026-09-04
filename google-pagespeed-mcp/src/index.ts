#!/usr/bin/env node
import "dotenv/config";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

const API_KEY = process.env.GOOGLE_PAGESPEED_API_KEY;
const ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

const server = new McpServer({
  name: "google-pagespeed-mcp",
  version: "1.0.0",
});

server.registerTool(
  "pagespeed_analyze_url",
  {
    title: "Run a PageSpeed Insights audit on a URL",
    description:
      "Audits a public URL with Google PageSpeed Insights (the same engine behind Lighthouse and " +
      "Google Search Console's Core Web Vitals report). Returns scores (0-100) per category, the " +
      "Core Web Vitals field data when available (real-world data from Chrome users, not just a lab " +
      "simulation), and the top opportunities/diagnostics for improving performance. Use strategy " +
      "'mobile' for how Google actually ranks the page (mobile-first indexing) unless asked about desktop.",
    inputSchema: {
      url: z.string().describe("Full URL to audit, e.g. 'https://www.example.com/'."),
      strategy: z.enum(["mobile", "desktop"]).default("mobile"),
      categories: z
        .array(z.enum(["performance", "accessibility", "best-practices", "seo", "pwa"]))
        .default(["performance", "accessibility", "seo", "best-practices"]),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  },
  async ({ url, strategy, categories }) => {
    try {
      const apiUrl = new URL(ENDPOINT);
      apiUrl.searchParams.set("url", url);
      apiUrl.searchParams.set("strategy", strategy);
      categories.forEach((c) => apiUrl.searchParams.append("category", c));
      if (API_KEY) apiUrl.searchParams.set("key", API_KEY);

      const response = await fetch(apiUrl.toString());
      const data = (await response.json()) as any;

      if (!response.ok) {
        const message = data?.error?.message ?? `HTTP ${response.status}`;
        return {
          isError: true,
          content: [{ type: "text", text: `PageSpeed Insights request failed: ${message}` }],
        };
      }

      const lighthouse = data.lighthouseResult;
      const scores: Record<string, number | null> = {};
      for (const [key, cat] of Object.entries(lighthouse?.categories ?? {})) {
        scores[key] = (cat as any)?.score != null ? Math.round((cat as any).score * 100) : null;
      }

      const audits = lighthouse?.audits ?? {};
      const opportunities = Object.values(audits)
        .filter((a: any) => a.score != null && a.score < 0.9 && a.details?.type === "opportunity")
        .map((a: any) => ({ id: a.id, title: a.title, description: a.description, savingsMs: a.details?.overallSavingsMs }))
        .sort((a: any, b: any) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
        .slice(0, 10);

      const fieldMetrics = data.loadingExperience?.metrics ?? null;

      const result = {
        url: data.id,
        strategy,
        scores,
        core_web_vitals_field_data: fieldMetrics,
        top_opportunities: opportunities,
      };

      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        isError: true,
        content: [{ type: "text", text: `PageSpeed Insights request failed: ${message}` }],
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("google-pagespeed-mcp server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting google-pagespeed-mcp:", error);
  process.exit(1);
});
