import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { performance, formatBusinessProfileError, toApiDate } from "../client.js";

const DAILY_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_DIRECTION_REQUESTS",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
] as const;

export function registerPerformanceTools(server: McpServer) {
  server.registerTool(
    "gbp_get_performance",
    {
      title: "Get daily performance metrics for a location",
      description:
        "Returns a daily time series for one metric — views (by surface: maps/search, desktop/mobile), " +
        "calls, website clicks, direction requests, messages/conversations, bookings, food orders — " +
        "over a date range. This is the 'Insights'/'Performance' tab data. Note: recent days may be " +
        "missing while Google finishes processing them.",
      inputSchema: {
        location_name: z.string().describe("e.g. 'locations/987654321', from gbp_list_locations."),
        daily_metric: z.enum(DAILY_METRICS),
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().describe("YYYY-MM-DD"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ location_name, daily_metric, start_date, end_date }) => {
      try {
        const start = toApiDate(start_date);
        const end = toApiDate(end_date);
        const { data } = await performance.locations.getDailyMetricsTimeSeries({
          name: location_name,
          dailyMetric: daily_metric,
          "dailyRange.startDate.year": start.year,
          "dailyRange.startDate.month": start.month,
          "dailyRange.startDate.day": start.day,
          "dailyRange.endDate.year": end.year,
          "dailyRange.endDate.month": end.month,
          "dailyRange.endDate.day": end.day,
        });
        const datedValues = (data.timeSeries?.datedValues ?? []).map((dv) => ({
          date: dv.date ? `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}-${String(dv.date.day).padStart(2, "0")}` : null,
          value: dv.value ?? "0",
        }));
        const result = { metric: daily_metric, values: datedValues };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get performance metrics: ${formatBusinessProfileError(error)}` }],
        };
      }
    }
  );
}
