import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { youtube, formatYoutubeError } from "../client.js";

export function registerVideoTools(server: McpServer) {
  server.registerTool(
    "yt_get_video",
    {
      title: "Get a video's details and stats",
      description:
        "Fetches a video's snippet (title, description, tags), statistics (views, likes, comment " +
        "count) and status (privacy, made-for-kids) by id.",
      inputSchema: {
        video_id: z.string().describe("The 11-character id from the video's URL."),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ video_id }) => {
      try {
        const { data } = await youtube.videos.list({
          part: ["snippet", "statistics", "status", "contentDetails"],
          id: [video_id],
        });
        const video = data.items?.[0];
        return {
          content: [{ type: "text", text: JSON.stringify(video ?? null, null, 2) }],
          structuredContent: (video as Record<string, unknown>) ?? {},
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to get video: ${formatYoutubeError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "yt_update_video",
    {
      title: "Update a video's title, description, tags, category or privacy",
      description:
        "Updates a video's metadata. `snippet` (title/description/tags/categoryId) and `status` " +
        "(privacyStatus: public/unlisted/private, selfDeclaredMadeForKids) are each optional but, " +
        "when given, must contain ALL fields you want kept — the API replaces the whole part, not " +
        "just the fields you send. Read the video first with yt_get_video to copy the fields you're " +
        "not changing.",
      inputSchema: {
        video_id: z.string(),
        snippet: z
          .object({
            title: z.string(),
            description: z.string().optional(),
            tags: z.array(z.string()).optional(),
            categoryId: z.string().optional(),
          })
          .optional(),
        status: z
          .object({
            privacyStatus: z.enum(["public", "unlisted", "private"]).optional(),
            selfDeclaredMadeForKids: z.boolean().optional(),
          })
          .optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ video_id, snippet, status }) => {
      try {
        const part: string[] = ["id"];
        if (snippet) part.push("snippet");
        if (status) part.push("status");
        const { data } = await youtube.videos.update({
          part,
          requestBody: { id: video_id, snippet, status },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to update video: ${formatYoutubeError(error)}` }],
        };
      }
    }
  );
}
