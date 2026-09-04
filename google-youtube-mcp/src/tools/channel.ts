import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { youtube, formatYoutubeError } from "../client.js";

export function registerChannelTools(server: McpServer) {
  server.registerTool(
    "yt_get_my_channel",
    {
      title: "Get the authenticated channel's info",
      description:
        "Returns the YouTube channel owned by the authenticated account: id, title, description, " +
        "subscriber/view/video counts, and the id of its 'uploads' playlist (feed that into " +
        "yt_list_channel_videos to list every video).",
      inputSchema: {},
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async () => {
      try {
        const { data } = await youtube.channels.list({
          part: ["snippet", "statistics", "contentDetails"],
          mine: true,
        });
        const channel = data.items?.[0];
        return {
          content: [{ type: "text", text: JSON.stringify(channel ?? null, null, 2) }],
          structuredContent: (channel as Record<string, unknown>) ?? {},
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get channel: ${formatYoutubeError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "yt_list_channel_videos",
    {
      title: "List videos from a channel's uploads",
      description:
        "Lists videos from a channel's 'uploads' playlist (most recent first) — the simple way to " +
        "enumerate every video a channel has published, without the search API's quota cost.",
      inputSchema: {
        uploads_playlist_id: z
          .string()
          .describe("From yt_get_my_channel's contentDetails.relatedPlaylists.uploads."),
        max_results: z.number().int().positive().max(50).default(50),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ uploads_playlist_id, max_results, page_token }) => {
      try {
        const { data } = await youtube.playlistItems.list({
          part: ["snippet", "contentDetails"],
          playlistId: uploads_playlist_id,
          maxResults: max_results,
          pageToken: page_token,
        });
        const videos = (data.items ?? []).map((item) => ({
          videoId: item.contentDetails?.videoId,
          title: item.snippet?.title,
          publishedAt: item.contentDetails?.videoPublishedAt,
        }));
        const result = { videos, next_page_token: data.nextPageToken };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list channel videos: ${formatYoutubeError(error)}` }],
        };
      }
    }
  );
}
