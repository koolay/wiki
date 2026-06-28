import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import path from "node:path";
import { loadManifest } from "./index-reader.js";
import { registerSearchEntries } from "./tools/search-entries.js";
import { registerGetEntry } from "./tools/get-entry.js";
import { registerListTree } from "./tools/list-tree.js";
import { registerGetStats } from "./tools/get-stats.js";

const ROOT = path.resolve(import.meta.dirname, "../..");

async function main(): Promise<void> {
  const { manifest, stale } = loadManifest(ROOT);
  if (stale) console.error("[wiki-mcp] Warning: manifest may be stale. Run npm run build-index");

  const server = new McpServer({ name: "wiki-knowledge-base", version: "0.1.0" });
  registerSearchEntries(server, manifest);
  registerGetEntry(server, manifest, ROOT);
  registerListTree(server, manifest);
  registerGetStats(server, manifest, stale);

  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
