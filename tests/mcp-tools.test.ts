import { describe, it, expect } from "vitest";
import path from "node:path";
import { loadManifest } from "../mcp-server/src/index-reader.js";
import { handleSearchEntries } from "../mcp-server/src/tools/search-entries.js";
import { handleGetEntry } from "../mcp-server/src/tools/get-entry.js";
import { handleListTree } from "../mcp-server/src/tools/list-tree.js";
import { handleGetStats } from "../mcp-server/src/tools/get-stats.js";

const ROOT = path.resolve(".");

describe("MCP tool handlers", () => {
  it("search_entries returns results", () => {
    const { manifest } = loadManifest(ROOT);
    const results = handleSearchEntries(manifest, { query: "separation" });
    expect(Array.isArray(results)).toBe(true);
  });

  it("get_entry throws with suggestions for missing path", () => {
    const { manifest } = loadManifest(ROOT);
    expect(() => handleGetEntry(manifest, ROOT, "no/such/file.md")).toThrow(/Entry not found/);
  });

  it("list_tree returns directories at root", () => {
    const { manifest } = loadManifest(ROOT);
    const tree = handleListTree(manifest);
    expect(tree).toHaveProperty("directories");
    expect(tree).toHaveProperty("entries");
  });

  it("get_stats returns counts", () => {
    const { manifest, stale } = loadManifest(ROOT);
    const stats = handleGetStats(manifest, stale);
    expect(stats.total_entries).toBeGreaterThanOrEqual(0);
    expect(typeof stats.stale).toBe("boolean");
  });
});
