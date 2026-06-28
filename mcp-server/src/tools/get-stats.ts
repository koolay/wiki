import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Manifest } from "../../../scripts/lib/types.js";

export function handleGetStats(manifest: Manifest, stale: boolean) {
  const published = manifest.entries.filter((e) => e.status === "published").length;
  const drafts = manifest.entries.filter((e) => e.status === "draft").length;
  const top_level_dirs = Object.keys(manifest.tree).filter((k) => {
    const v = manifest.tree[k];
    return v && !Array.isArray(v);
  });
  return {
    total_entries: manifest.entries.length,
    published,
    drafts,
    top_level_dirs,
    last_indexed: manifest.generated_at,
    stale,
  };
}

export function registerGetStats(server: McpServer, manifest: Manifest, stale: boolean): void {
  server.tool(
    "get_stats",
    "Get knowledge base statistics",
    {},
    async () => ({
      content: [{ type: "text", text: JSON.stringify(handleGetStats(manifest, stale), null, 2) }],
    })
  );
}
