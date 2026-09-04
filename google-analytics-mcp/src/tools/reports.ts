import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyticsData, analyticsAdmin, resolvePropertyId, formatAnalyticsError } from "../client.js";

const dimensionOrMetric = z.union([z.string(), z.object({ name: z.string() })]);

function toNamedList(values: (string | { name: string })[] | undefined) {
  return (values ?? []).map((v) => (typeof v === "string" ? { name: v } : v));
}

export function registerReportTools(server: McpServer) {
  server.registerTool(
    "google_analytics_list_properties",
    {
      title: "List accessible GA4 accounts and properties",
      description:
        "Lists every Google Analytics 4 account and property (with numeric property id) that the " +
        "authenticated refresh token can access. Call this first if you don't already know which " +
        "property_id to use.",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const { data } = await analyticsAdmin.accountSummaries.list({ pageSize: 200 });
        const accounts = (data.accountSummaries ?? []).map((a) => ({
          account: a.account,
          displayName: a.displayName,
          properties: (a.propertySummaries ?? []).map((p) => ({
            property: p.property,
            propertyId: p.property?.replace("properties/", ""),
            displayName: p.displayName,
          })),
        }));
        return {
          content: [{ type: "text", text: JSON.stringify({ accounts }, null, 2) }],
          structuredContent: { accounts },
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list GA4 properties: ${formatAnalyticsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "google_analytics_run_report",
    {
      title: "Run a GA4 report (Data API runReport)",
      description:
        "Runs a Google Analytics 4 report: any combination of dimensions (e.g. 'date', 'city', " +
        "'sessionDefaultChannelGroup', 'pagePath', 'deviceCategory') and metrics (e.g. 'activeUsers', " +
        "'sessions', 'conversions', 'totalRevenue', 'screenPageViews', 'bounceRate', 'averageSessionDuration'), " +
        "over one or more date ranges. Covers traffic, engagement, conversions, revenue and e-commerce " +
        "reporting — this is the general-purpose GA4 read tool. Full dimension/metric catalog: " +
        "https://developers.google.com/analytics/devguides/reporting/data/v1/api-schema",
      inputSchema: {
        dimensions: z
          .array(z.string())
          .default([])
          .describe("GA4 dimension names, e.g. ['date', 'sessionDefaultChannelGroup']."),
        metrics: z
          .array(z.string())
          .min(1)
          .describe("GA4 metric names, e.g. ['activeUsers', 'sessions', 'conversions']."),
        date_ranges: z
          .array(z.object({ startDate: z.string(), endDate: z.string(), name: z.string().optional() }))
          .default([{ startDate: "28daysAgo", endDate: "today" }])
          .describe(
            "One or more {startDate, endDate} pairs. Dates accept 'YYYY-MM-DD', 'today', 'yesterday', " +
              "or 'NdaysAgo'."
          ),
        dimension_filter: z
          .record(z.any())
          .optional()
          .describe("Raw GA4 FilterExpression object for dimensionFilter, if you need to filter rows."),
        limit: z.number().int().positive().max(100000).default(10000),
        order_bys: z
          .array(z.record(z.any()))
          .optional()
          .describe("Raw GA4 OrderBy objects, e.g. [{desc: true, metric: {metricName: 'sessions'}}]."),
        property_id: z
          .string()
          .optional()
          .describe("GA4 property id, digits only or 'properties/<id>'. Defaults to GOOGLE_ANALYTICS_PROPERTY_ID."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ dimensions, metrics, date_ranges, dimension_filter, limit, order_bys, property_id }) => {
      try {
        const property = resolvePropertyId(property_id);
        const { data } = await analyticsData.properties.runReport({
          property,
          requestBody: {
            dimensions: toNamedList(dimensions),
            metrics: toNamedList(metrics),
            dateRanges: date_ranges,
            dimensionFilter: dimension_filter as any,
            limit: String(limit),
            orderBys: order_bys as any,
          },
        });
        const dimHeaders = (data.dimensionHeaders ?? []).map((h) => h.name);
        const metHeaders = (data.metricHeaders ?? []).map((h) => h.name);
        const rows = (data.rows ?? []).map((row) => {
          const obj: Record<string, string> = {};
          row.dimensionValues?.forEach((v, i) => (obj[dimHeaders[i]!] = v.value ?? ""));
          row.metricValues?.forEach((v, i) => (obj[metHeaders[i]!] = v.value ?? ""));
          return obj;
        });
        const result = { row_count: data.rowCount ?? rows.length, rows };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `GA4 runReport failed: ${formatAnalyticsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "google_analytics_run_realtime_report",
    {
      title: "Run a GA4 realtime report",
      description:
        "Runs a Google Analytics 4 realtime report (last ~30 minutes of activity): dimensions like " +
        "'unifiedScreenName', 'country', 'deviceCategory' and metrics like 'activeUsers', 'screenPageViews', " +
        "'eventCount'. Use this for 'what's happening right now' questions, not historical reporting.",
      inputSchema: {
        dimensions: z.array(z.string()).default(["unifiedScreenName"]),
        metrics: z.array(z.string()).min(1).default(["activeUsers"]),
        limit: z.number().int().positive().max(100000).default(1000),
        property_id: z.string().optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ dimensions, metrics, limit, property_id }) => {
      try {
        const property = resolvePropertyId(property_id);
        const { data } = await analyticsData.properties.runRealtimeReport({
          property,
          requestBody: {
            dimensions: toNamedList(dimensions),
            metrics: toNamedList(metrics),
            limit: String(limit),
          },
        });
        const dimHeaders = (data.dimensionHeaders ?? []).map((h) => h.name);
        const metHeaders = (data.metricHeaders ?? []).map((h) => h.name);
        const rows = (data.rows ?? []).map((row) => {
          const obj: Record<string, string> = {};
          row.dimensionValues?.forEach((v, i) => (obj[dimHeaders[i]!] = v.value ?? ""));
          row.metricValues?.forEach((v, i) => (obj[metHeaders[i]!] = v.value ?? ""));
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
          content: [{ type: "text", text: `GA4 runRealtimeReport failed: ${formatAnalyticsError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "google_analytics_get_metadata",
    {
      title: "List available GA4 dimensions and metrics for a property",
      description:
        "Returns every dimension and metric name available for a property, with descriptions — use this " +
        "when unsure what's queryable before calling google_analytics_run_report.",
      inputSchema: {
        property_id: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ property_id }) => {
      try {
        const property = resolvePropertyId(property_id);
        const { data } = await analyticsData.properties.getMetadata({ name: `${property}/metadata` });
        const result = {
          dimensions: (data.dimensions ?? []).map((d) => ({ name: d.apiName, description: d.description })),
          metrics: (data.metrics ?? []).map((m) => ({ name: m.apiName, description: m.description })),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `GA4 getMetadata failed: ${formatAnalyticsError(error)}` }],
        };
      }
    }
  );
}
