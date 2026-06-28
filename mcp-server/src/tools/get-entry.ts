import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseEntryFile } from "../../../scripts/lib/parse-entry.js";
import { suggestSimilarPaths } from "../../../scripts/lib/levenshtein.js";
import type { Manifest } from "../../../scripts/lib/types.js";

export function handleGetEntry(manifest: Manifest, root: string, entryPath: string) {
  const knowledgeRoot = path.join(root, "knowledge");
  const absPath = path.join(knowledgeRoot, entryPath);
  if (!fs.existsSync(absPath)) {
    const suggestions = suggestSimilarPaths(entryPath, manifest.entries.map((e) => e.path));
    throw new Error(`Entry not found: ${entryPath}. Similar: ${suggestions.join(", ") || "none"}`);
  }
  const parsed = parseEntryFile(absPath, knowledgeRoot);
  const related_entries = (parsed.frontmatter.related ?? [])
    .map((rel) => manifest.entries.find((e) => e.path === rel))
    .filter(Boolean)
    .map((e) => ({ path: e!.path, title: e!.title, summary: e!.summary }));
  return { frontmatter: parsed.frontmatter, body: parsed.body, related_entries };
}

export function registerGetEntry(server: McpServer, manifest: Manifest, root: string): void {
  server.tool(
    "get_entry",
    "Get full knowledge entry by path relative to knowledge/",
    { path: z.string() },
    async ({ path: entryPath }) => ({
      content: [{ type: "text", text: JSON.stringify(handleGetEntry(manifest, root, entryPath), null, 2) }],
    })
  );
}
