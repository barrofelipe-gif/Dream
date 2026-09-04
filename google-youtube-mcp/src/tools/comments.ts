import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { youtube, formatYoutubeError } from "../client.js";

export function registerCommentTools(server: McpServer) {
  server.registerTool(
    "yt_list_comments",
    {
      title: "List top-level comments on a video",
      description:
        "Lists comment threads (top-level comments + their reply count) on a video, newest or most " +
        "relevant first.",
      inputSchema: {
        video_id: z.string(),
        order: z.enum(["time", "relevance"]).default("time"),
        max_results: z.number().int().positive().max(100).default(20),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ video_id, order, max_results, page_token }) => {
      try {
        const { data } = await youtube.commentThreads.list({
          part: ["snippet"],
          videoId: video_id,
          order,
          maxResults: max_results,
          pageToken: page_token,
        });
        const comments = (data.items ?? []).map((item) => ({
          commentId: item.snippet?.topLevelComment?.id,
          author: item.snippet?.topLevelComment?.snippet?.authorDisplayName,
          text: item.snippet?.topLevelComment?.snippet?.textDisplay,
          likeCount: item.snippet?.topLevelComment?.snippet?.likeCount,
          publishedAt: item.snippet?.topLevelComment?.snippet?.publishedAt,
          replyCount: item.snippet?.totalReplyCount,
        }));
        const result = { comments, next_page_token: data.nextPageToken };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          structuredContent: result,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to list comments: ${formatYoutubeError(error)}` }],
        };
      }
    }
  );

  server.registerTool(
    "yt_reply_comment",
    {
      title: "Reply to a comment",
      description: "Posts a reply to an existing top-level comment, as the authenticated channel.",
      inputSchema: {
        parent_comment_id: z.string().describe("The top-level comment's id, from yt_list_comments."),
        text: z.string(),
      },
      annotations: { readOnlyHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ parent_comment_id, text }) => {
      try {
        const { data } = await youtube.comments.insert({
          part: ["snippet"],
          requestBody: { snippet: { parentId: parent_comment_id, textOriginal: text } },
        });
        return {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          structuredContent: data as Record<string, unknown>,
        };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text", text: `Failed to reply to comment: ${formatYoutubeError(error)}` }],
        };
      }
    }
  );
}
