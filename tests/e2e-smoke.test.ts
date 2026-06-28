import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { loadManifest } from "../mcp-server/src/index-reader.js";
import { searchEntries } from "../scripts/lib/search.js";
import { parseEntryFile } from "../scripts/lib/parse-entry.js";

const ROOT = path.resolve(".");

describe("e2e smoke", () => {
  it("manifest exists with example entry", () => {
    const { manifest } = loadManifest(ROOT);
    expect(manifest.entries.some((e) => e.path === "design-principles/separation-of-concerns.md")).toBe(true);
  });

  it("search finds example by keyword", () => {
    const { manifest } = loadManifest(ROOT);
    const results = searchEntries(manifest.entries, { query: "separation" });
    expect(results.length).toBeGreaterThan(0);
  });

  it("example file parses with required sections", () => {
    const filePath = path.join(ROOT, "knowledge/design-principles/separation-of-concerns.md");
    const parsed = parseEntryFile(filePath, path.join(ROOT, "knowledge"));
    expect(parsed.body).toContain("## 实践要点");
    expect(parsed.body).toContain("## 权衡与反模式");
  });
});
