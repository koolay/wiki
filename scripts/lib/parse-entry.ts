import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { EntryFrontmatter, ParsedEntry } from "./types.js";

export function parseEntryFile(absPath: string, knowledgeRoot: string): ParsedEntry {
  const raw = fs.readFileSync(absPath, "utf-8");
  const { data, content } = matter(raw);
  const relPath = path.relative(knowledgeRoot, absPath).split(path.sep).join("/");
  const frontmatter = structuredClone(data) as EntryFrontmatter;
  if (frontmatter.date instanceof Date) {
    frontmatter.date = frontmatter.date.toISOString().slice(0, 10);
  }
  return {
    path: relPath,
    frontmatter,
    body: content.trim(),
  };
}
