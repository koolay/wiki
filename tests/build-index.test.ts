import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { parseEntryFile } from "../scripts/lib/parse-entry.js";
import { validateEntry } from "../scripts/lib/validate-entry.js";
import { buildManifest } from "../scripts/lib/build-manifest.js";

const FIXTURES = path.resolve("tests/fixtures");
const VALID = path.join(FIXTURES, "valid-entry.md");
const DRAFT = path.join(FIXTURES, "draft-entry.md");

describe("parseEntryFile", () => {
  it("parses frontmatter and body", () => {
    const parsed = parseEntryFile(VALID, FIXTURES);
    expect(parsed.path).toBe("valid-entry.md");
    expect(parsed.frontmatter.title).toBe("Separation of Concerns");
    expect(parsed.frontmatter.status).toBe("published");
    expect(parsed.body).toContain("## 背景");
  });
});

describe("validateEntry", () => {
  it("returns no errors for valid published entry", () => {
    const parsed = parseEntryFile(VALID, FIXTURES);
    const errors = validateEntry(parsed, new Set(["valid-entry.md"]));
    expect(errors).toEqual([]);
  });

  it("returns errors for invalid draft with empty keywords on published", () => {
    const bad = parseEntryFile(DRAFT, FIXTURES);
    const published = { ...bad, frontmatter: { ...bad.frontmatter, status: "published" as const } };
    const errors = validateEntry(published, new Set(["draft-entry.md"]));
    expect(errors.length).toBeGreaterThan(0);
  });

  it("returns error for missing related path", () => {
    const parsed = parseEntryFile(VALID, FIXTURES);
    parsed.frontmatter.related = ["missing.md"];
    const errors = validateEntry(parsed, new Set(["valid-entry.md"]));
    expect(errors.some((e) => e.includes("missing.md"))).toBe(true);
  });
});

describe("buildManifest", () => {
  it("builds entries and tree", () => {
    const entries = [parseEntryFile(VALID, FIXTURES)];
    const manifest = buildManifest(entries);
    expect(manifest.version).toBe(1);
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0].path).toBe("valid-entry.md");
    expect(manifest.tree).toHaveProperty("valid-entry.md");
  });
});

describe("build-index CLI", () => {
  const tmpKnowledge = path.resolve("tests/tmp-knowledge");
  const manifestPath = path.resolve("index/manifest.json");

  beforeAll(async () => {
    await fs.mkdir(tmpKnowledge, { recursive: true });
    await fs.mkdir(path.join(tmpKnowledge, "design-principles"), { recursive: true });
    await fs.copyFile(VALID, path.join(tmpKnowledge, "design-principles/separation-of-concerns.md"));
  });

  afterAll(async () => {
    await fs.rm(tmpKnowledge, { recursive: true, force: true });
  });

  it("writes manifest.json", async () => {
    process.env.KNOWLEDGE_DIR = tmpKnowledge;
    const { main } = await import("../scripts/build-index.ts");
    await main();
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.entries.some((e: { path: string }) =>
      e.path === "design-principles/separation-of-concerns.md"
    )).toBe(true);
  });
});
