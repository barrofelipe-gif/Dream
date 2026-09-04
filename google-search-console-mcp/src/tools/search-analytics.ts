import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { webmasters, searchConsole, resolveSiteUrl, formatSearchConsoleError } from "../client.js";

export function registerSearchConsoleTools(server: McpServer) {
  server.registerTool(
    "google_search_console_list_sites",
    {
      title: "List Search Console sites/properties",
      description:
        "Lists every site (domain or URL-prefix property) that the authenticated refresh token has " +
        "access to, with permission level. Call this first if you don't already know which site_url to use.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const { data } = await webmasters.sites.list();
        const sites = data.siteEntry ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ sites }, null, 2) }],
          structuredContent: { sites },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list sites: ${formatSearchConsoleError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "google_search_console_query",
    {
      title: "Query Search Console search analytics",
      description:
        "Runs a Search Analytics query: clicks, impressions, CTR and average position, broken down by any " +
        "combination of dimensions ('query', 'page', 'country', 'device', 'date', 'searchAppearance'), over a " +
        "date range. Covers basically every organic search question — top queries, top pages, CTR by country, " +
        "position trend over time, etc. Note: Search Console data usually lags 1-3 days.",
      inputSchema: {
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
        dimensions: z
          .array(z.enum(["query", "page", "country", "device", "date", "searchAppearance"]))
          .default(["query"]),
        row_limit: z.number().int().positive().max(25000).default(1000),
        start_row: z.number().int().min(0).default(0),
        dimension_filter_groups: z
          .array(z.record(z.any()))
          .optional()
          .describe(
            "Raw dimensionFilterGroups, e.g. [{filters: [{dimension: 'page', operator: 'contains', " +
              "expression: '/blog/'}]}]."
          ),
        search_type: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).default("web"),
        site_url: z
          .string()
          .optional()
          .describe(
            "Exact site as registered in Search Console, e.g. 'https://www.example.com/' or " +
              "'sc-domain:example.com'. Defaults to GOOGLE_SEARCH_CONSOLE_SITE_URL."
          ),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({
      start_date,
      end_date,
      dimensions,
      row_limit,
      start_row,
      dimension_filter_groups,
      search_type,
      site_url,
    }) => {
      try {
        const siteUrl = resolveSiteUrl(site_url);
        const { data } = await webmasters.searchanalytics.query({
          siteUrl,
          requestBody: {
            startDate: start_date,
            endDate: end_date,
            dimensions,
            rowLimit: row_limit,
            startRow: start_row,
            dimensionFilterGroups: dimension_filter_groups as any,
            searchType: search_type,
          },
        });
        const rows = (data.rows ?? []).map((row: NonNullable<typeof data.rows>[number]) => ({
          keys: row.keys,
          clicks: row.clicks,
          impressions: row.impressions,
          ctr: row.ctr,
          position: row.position,
        }));
        const result = { row_count: rows.length, rows };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Search analytics query failed: ${formatSearchConsoleError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "google_search_console_list_sitemaps",
    {
      title: "List submitted sitemaps",
      description:
        "Lists the sitemaps submitted for a site, with last submission/download date, warnings and errors, " +
        "and how many URLs were indexed from each.",
      inputSchema: {
        site_url: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ site_url }) => {
      try {
        const siteUrl = resolveSiteUrl(site_url);
        const { data } = await webmasters.sitemaps.list({ siteUrl });
        const sitemaps = data.sitemap ?? [];
        return {
          content: [{ type: "text", text: JSON.stringify({ sitemaps }, null, 2) }],
          structuredContent: { sitemaps },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list sitemaps: ${formatSearchConsoleError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "google_search_console_submit_sitemap",
    {
      title: "Submit (or resubmit) a sitemap",
      description: "Submits a sitemap URL to Search Console, or resubmits an existing one to force a re-crawl.",
      inputSchema: {
        feedpath: z.string().describe("Full URL to the sitemap XML, e.g. 'https://www.example.com/sitemap.xml'."),
        site_url: z.string().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ feedpath, site_url }) => {
      try {
        const siteUrl = resolveSiteUrl(site_url);
        await webmasters.sitemaps.submit({ siteUrl, feedpath });
        const result = { submitted: feedpath };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to submit sitemap: ${formatSearchConsoleError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "google_search_console_inspect_url",
    {
      title: "Inspect a URL's indexing status",
      description:
        "Runs the URL Inspection tool for a single URL: whether it's indexed, coverage state, canonical " +
        "chosen by Google, mobile usability, and any indexing issues found. Use this to debug 'why isn't my " +
        "page showing up in Google' questions.",
      inputSchema: {
        inspection_url: z.string().describe("Full URL to inspect, e.g. 'https://www.example.com/blog/post'."),
        site_url: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ inspection_url, site_url }) => {
      try {
        const siteUrl = resolveSiteUrl(site_url);
        const { data } = await searchConsole.urlInspection.index.inspect({
          requestBody: { inspectionUrl: inspection_url, siteUrl },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as any,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `URL inspection failed: ${formatSearchConsoleError(error)}` }],
        };
      }
    }
  );
}
