import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { youtubeAnalytics, formatYoutubeError } from "../client.js";

export function registerAnalyticsTools(server: McpServer) {
  server.registerTool(
    "yt_get_analytics",
    {
      title: "Run a YouTube Analytics report",
      description:
        "Runs a YouTube Analytics query: any combination of metrics (e.g. 'views', 'estimatedMinutesWatched', " +
        "'averageViewDuration', 'subscribersGained', 'likes', 'comments', 'shares', 'estimatedRevenue') " +
        "and dimensions (e.g. 'day', 'video', 'country', 'trafficSourceType', 'deviceType') over a " +
        "date range, for the channel or a specific video. Covers essentially every 'how is my channel " +
        "doing' question. Full metric/dimension catalog: " +
        "https://developers.google.com/youtube/analytics/metrics",
      inputSchema: {
        metrics: z.array(z.string()).min(1).describe("e.g. ['views', 'estimatedMinutesWatched', 'subscribersGained']."),
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
        dimensions: z.array(z.string()).default([]).describe("e.g. ['day'] or ['video'] or ['country']."),
        filters: z
          .string()
          .optional()
          .describe("e.g. 'video==dMH0bHeiRNg' to scope to one video, or 'country==BR'."),
        sort: z.string().optional().describe("e.g. '-views' for descending by views."),
        max_results: z.number().int().positive().max(10000).optional(),
        channel_id: z
          .string()
          .optional()
          .describe("Defaults to 'MINE' (the authenticated channel). Pass an explicit id to target another channel you manage."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ metrics, start_date, end_date, dimensions, filters, sort, max_results, channel_id }) => {
      try {
        const { data } = await youtubeAnalytics.reports.query({
          ids: channel_id ? `channel==${channel_id}` : "channel==MINE",
          startDate: start_date,
          endDate: end_date,
          metrics: metrics.join(","),
          dimensions: dimensions.length ? dimensions.join(",") : undefined,
          filters,
          sort,
          maxResults: max_results,
        });
        const columns = (data.columnHeaders ?? []).map((h) => h.name);
        const rows = (data.rows ?? []).map((row) => {
          const obj: Record<string, unknown> = {};
          row.forEach((value, i) => (obj[columns[i]!] = value));
          return obj;
        });
        const result = { row_count: rows.length, rows };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `YouTube Analytics query failed: ${formatYoutubeError(error)}` }],
        };
      }
    }
  );
}
