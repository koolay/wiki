import { describe, it, expect } from "vitest";
import { searchEntries } from "../scripts/lib/search.js";
import type { ManifestEntry } from "../scripts/lib/types.js";

const entries: ManifestEntry[] = [
  {
    path: "languages/rust/error-handling.md",
    title: "Rust 错误处理",
    date: "2026-06-28",
    summary: "Result and ? operator for recoverable errors",
    status: "published",
    tags: ["rust", "error-handling"],
    keywords: ["Result", "? operator"],
    applies_to: ["recoverable error handling"],
    related: [],
  },
  {
    path: "drafts/notes.md",
    title: "Draft note",
    date: "2026-06-28",
    summary: "wip",
    status: "draft",
    tags: ["rust"],
    keywords: [],
    applies_to: [],
    related: [],
  },
];

describe("searchEntries", () => {
  it("matches by keyword in title", () => {
    const results = searchEntries(entries, { query: "错误处理" });
    expect(results[0].path).toBe("languages/rust/error-handling.md");
    expect(results[0].score).toBeGreaterThan(0);
  });

  it("filters by path_prefix", () => {
    const results = searchEntries(entries, { query: "error", path_prefix: "languages/rust" });
    expect(results).toHaveLength(1);
  });

  it("excludes drafts by default", () => {
    const results = searchEntries(entries, { query: "rust" });
    expect(results.every((r) => r.path !== "drafts/notes.md")).toBe(true);
  });

  it("includes drafts when requested", () => {
    const results = searchEntries(entries, { query: "rust", include_drafts: true });
    expect(results.some((r) => r.path === "drafts/notes.md")).toBe(true);
  });
});
