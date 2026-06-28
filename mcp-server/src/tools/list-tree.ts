import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Manifest, ManifestEntry, ManifestTree } from "../../../scripts/lib/types.js";

export function handleListTree(
  manifest: Manifest,
  dirPath?: string
): { directories: string[]; entries: { path: string; title: string; summary: string }[] } {
  const prefix = dirPath ? dirPath.replace(/\/$/, "") + "/" : "";
  const node = dirPath ? getTreeNode(manifest.tree, dirPath) : manifest.tree;
  if (!node) return { directories: [], entries: [] };

  const directories: string[] = [];
  const fileNames: string[] = [];

  for (const [key, value] of Object.entries(node)) {
    if (Array.isArray(value)) fileNames.push(...value);
    else directories.push(key);
  }

  const entries = manifest.entries
    .filter((e) => {
      if (!prefix) return e.path.split("/").length === 1 || fileNames.some((f) => e.path.endsWith(`/${f}`) || e.path === f);
      return e.path.startsWith(prefix) && fileNames.some((f) => e.path === `${dirPath}/${f}`.replace(/\/+/g, "/"));
    })
    .map(toEntrySummary);

  return { directories: directories.sort(), entries };
}

function getTreeNode(tree: ManifestTree, dirPath: string): ManifestTree | null {
  let cursor: ManifestTree = tree;
  for (const seg of dirPath.split("/").filter(Boolean)) {
    const next = cursor[seg];
    if (!next || Array.isArray(next)) return null;
    cursor = next as ManifestTree;
  }
  return cursor;
}

function toEntrySummary(e: ManifestEntry) {
  return { path: e.path, title: e.title, summary: e.summary };
}

export function registerListTree(server: McpServer, manifest: Manifest): void {
  server.tool(
    "list_tree",
    "Browse knowledge base directory tree",
    { path: z.string().optional() },
    async ({ path: dirPath }) => ({
      content: [{ type: "text", text: JSON.stringify(handleListTree(manifest, dirPath), null, 2) }],
    })
  );
}
