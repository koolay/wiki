import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchEntries } from "../../../scripts/lib/search.js";
import type { Manifest } from "../../../scripts/lib/types.js";

export function handleSearchEntries(
  manifest: Manifest,
  params: {
    query: string;
    path_prefix?: string;
    tags?: string[];
    applies_to?: string;
    include_drafts?: boolean;
    limit?: number;
  }
) {
  return searchEntries(manifest.entries, params);
}

export function registerSearchEntries(server: McpServer, manifest: Manifest): void {
  server.tool(
    "search_entries",
    "Search knowledge base entries by keyword with optional filters",
    {
      query: z.string(),
      path_prefix: z.string().optional(),
      tags: z.array(z.string()).optional(),
      applies_to: z.string().optional(),
      include_drafts: z.boolean().optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (params) => ({
      content: [{ type: "text", text: JSON.stringify(handleSearchEntries(manifest, params), null, 2) }],
    })
  );
}
