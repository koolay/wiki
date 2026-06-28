# Agent Knowledge Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Git-backed, Agent-oriented knowledge base with Markdown articles, a build-index manifest, MCP read tools, and Cursor Skills for AI-assisted ingestion.

**Architecture:** Markdown files in `knowledge/` are the source of truth. `scripts/build-index.ts` scans articles, validates frontmatter against JSON Schema, and writes `index/manifest.json`. A TypeScript MCP server (stdio) reads the manifest for layered keyword search and reads files for full entry retrieval. ingest/reorganize Skills handle writes.

**Tech Stack:** TypeScript, Node.js 20+, Vitest, tsx, gray-matter, ajv, fast-glob, @modelcontextprotocol/sdk

## Global Constraints

- File naming: `{slug}.md`, kebab-case, English or pinyin
- Directory naming: kebab-case, AI-created organically (no fixed taxonomy)
- Article status: `draft` | `published`
- MCP is read-only; no write/update/delete tools
- `search_entries` excludes drafts by default (`include_drafts: false`)
- `search_entries` limit default 10, max 50
- Body sections required for published articles: 实践要点, 权衡与反模式
- Deferred: semantic search, Web UI, pre-commit hook, CI/CD, multi-user

---

## File Map

| File | Responsibility |
|------|----------------|
| `package.json` | Root scripts, dependencies, Vitest config |
| `tsconfig.json` | Shared TypeScript config |
| `.gitignore` | Ignore node_modules, dist |
| `schema/entry.schema.json` | Frontmatter JSON Schema |
| `scripts/lib/types.ts` | Shared TypeScript types |
| `scripts/lib/parse-entry.ts` | Parse Markdown + frontmatter |
| `scripts/lib/validate-entry.ts` | JSON Schema + related-path validation |
| `scripts/lib/build-manifest.ts` | Build entries array + tree |
| `scripts/lib/search.ts` | Keyword scoring for search_entries |
| `scripts/lib/levenshtein.ts` | Path similarity for get_entry errors |
| `scripts/build-index.ts` | CLI entry: scan → validate → write manifest |
| `mcp-server/src/index-reader.ts` | Load manifest, staleness check |
| `mcp-server/src/tools/search-entries.ts` | search_entries tool |
| `mcp-server/src/tools/get-entry.ts` | get_entry tool |
| `mcp-server/src/tools/list-tree.ts` | list_tree tool |
| `mcp-server/src/tools/get-stats.ts` | get_stats tool |
| `mcp-server/src/index.ts` | MCP server bootstrap |
| `mcp-server/package.json` | MCP server dependencies |
| `.cursor/skills/ingest/SKILL.md` | Ingestion Skill |
| `.cursor/skills/reorganize/SKILL.md` | Reorganization Skill |
| `AGENTS.md` | Agent usage guide |
| `README.md` | Human project README |
| `.cursor/mcp.json` | Cursor MCP config example |
| `knowledge/design-principles/separation-of-concerns.md` | Example published article |
| `tests/build-index.test.ts` | build-index unit tests |
| `tests/search.test.ts` | search scoring unit tests |
| `tests/mcp-tools.test.ts` | MCP tool integration tests |

---

### Task 1: Project Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`
- Create: `index/embeddings/.gitkeep`
- Create: `knowledge/.gitkeep`

**Interfaces:**
- Produces: npm scripts `build-index`, `test`, `typecheck`; directory layout per spec

- [ ] **Step 1: Create `.gitignore`**

```gitignore
node_modules/
dist/
*.log
.DS_Store
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "resolveJsonModule": true
  },
  "include": ["scripts/**/*.ts", "tests/**/*.ts", "mcp-server/src/**/*.ts"]
}
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "wiki-knowledge-base",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build-index": "tsx scripts/build-index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "mcp": "tsx mcp-server/src/index.ts"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "ajv": "^8.17.0",
    "ajv-formats": "^3.0.1",
    "fast-glob": "^3.3.2",
    "gray-matter": "^4.0.3",
    "zod": "^3.24.0"
  }
}
```

- [ ] **Step 4: Create placeholder directories**

```bash
mkdir -p knowledge index/embeddings schema scripts/lib mcp-server/src/tools tests .cursor/skills/ingest .cursor/skills/reorganize
touch index/embeddings/.gitkeep knowledge/.gitkeep
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: `node_modules/` created, no errors

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json .gitignore knowledge/.gitkeep index/embeddings/.gitkeep
git commit -m "chore: scaffold project structure and tooling"
```

---

### Task 2: Frontmatter Schema and Shared Types

**Files:**
- Create: `schema/entry.schema.json`
- Create: `scripts/lib/types.ts`

**Interfaces:**
- Produces: `EntryFrontmatter` type, `ManifestEntry` type, `Manifest` type, JSON Schema at `schema/entry.schema.json`
- Consumed by: Task 3 (validate-entry), Task 4 (MCP tools)

- [ ] **Step 1: Create `schema/entry.schema.json`**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://wiki.local/schema/entry.schema.json",
  "type": "object",
  "required": ["title", "date", "summary", "status", "tags", "keywords", "applies_to"],
  "additionalProperties": false,
  "properties": {
    "title": { "type": "string", "minLength": 1, "maxLength": 120 },
    "date": { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
    "summary": { "type": "string", "minLength": 1, "maxLength": 300 },
    "status": { "type": "string", "enum": ["draft", "published"] },
    "tags": { "type": "array", "items": { "type": "string", "minLength": 1 }, "minItems": 1 },
    "keywords": { "type": "array", "items": { "type": "string" } },
    "applies_to": { "type": "array", "items": { "type": "string" } },
    "source": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["url", "type"],
        "additionalProperties": false,
        "properties": {
          "url": { "type": "string", "minLength": 1 },
          "type": { "type": "string", "enum": ["article", "video", "book", "conversation"] }
        }
      }
    },
    "related": {
      "type": "array",
      "items": { "type": "string", "minLength": 1 }
    }
  },
  "allOf": [
    {
      "if": { "properties": { "status": { "const": "published" } } },
      "then": {
        "properties": {
          "keywords": { "minItems": 1 },
          "applies_to": { "minItems": 1 }
        }
      }
    }
  ]
}
```

- [ ] **Step 2: Create `scripts/lib/types.ts`**

```typescript
export type EntryStatus = "draft" | "published";

export type SourceType = "article" | "video" | "book" | "conversation";

export interface SourceRef {
  url: string;
  type: SourceType;
}

export interface EntryFrontmatter {
  title: string;
  date: string;
  summary: string;
  status: EntryStatus;
  tags: string[];
  keywords: string[];
  applies_to: string[];
  source?: SourceRef[];
  related?: string[];
}

export interface ManifestEntry {
  path: string;
  title: string;
  date: string;
  summary: string;
  status: EntryStatus;
  tags: string[];
  keywords: string[];
  applies_to: string[];
  related: string[];
}

export interface ManifestTree {
  [segment: string]: ManifestTree | string[];
}

export interface Manifest {
  version: 1;
  generated_at: string;
  entries: ManifestEntry[];
  tree: ManifestTree;
}

export interface ParsedEntry {
  path: string;
  frontmatter: EntryFrontmatter;
  body: string;
}

export interface SearchResult {
  path: string;
  title: string;
  summary: string;
  score: number;
  matched_fields: string[];
}
```

- [ ] **Step 3: Run typecheck (should pass with no errors beyond missing files)**

Run: `npm run typecheck`
Expected: PASS (or only errors from not-yet-created files — types.ts alone should be fine)

- [ ] **Step 4: Commit**

```bash
git add schema/entry.schema.json scripts/lib/types.ts
git commit -m "feat: add frontmatter JSON Schema and shared types"
```

---

### Task 3: build-index Script

**Files:**
- Create: `scripts/lib/parse-entry.ts`
- Create: `scripts/lib/validate-entry.ts`
- Create: `scripts/lib/build-manifest.ts`
- Create: `scripts/build-index.ts`
- Create: `tests/fixtures/valid-entry.md`
- Create: `tests/fixtures/draft-entry.md`
- Create: `tests/build-index.test.ts`

**Interfaces:**
- Consumes: `EntryFrontmatter`, `Manifest`, `ParsedEntry` from `scripts/lib/types.ts`
- Produces:
  - `parseEntryFile(absPath: string, knowledgeRoot: string): ParsedEntry`
  - `validateEntry(parsed: ParsedEntry, allPaths: Set<string>): string[]` → error messages
  - `buildManifest(entries: ParsedEntry[]): Manifest`
  - CLI writes `index/manifest.json`

- [ ] **Step 1: Create test fixtures**

`tests/fixtures/valid-entry.md`:

```markdown
---
title: "Separation of Concerns"
date: 2026-06-28
summary: "Divide programs into distinct sections handling distinct concerns."
status: published
tags:
  - design-principles
  - architecture
keywords:
  - separation of concerns
  - modularity
applies_to:
  - "structuring large codebases"
  - "reducing coupling"
---

## 背景

Programs grow complex quickly.

## 核心思想

Each module should address a separate concern.

## 实践要点

- Split UI, business logic, and data access
- Avoid cross-layer imports

## 权衡与反模式

Over-separation creates unnecessary indirection.

## 参考

- Dijkstra, 1974
```

`tests/fixtures/draft-entry.md`:

```markdown
---
title: "临时标题"
date: 2026-06-28
summary: "待整理"
status: draft
tags:
  - uncategorized
keywords: []
applies_to: []
---

草稿正文。
```

- [ ] **Step 2: Write failing tests**

`tests/build-index.test.ts`:

```typescript
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
    await import("../scripts/build-index.ts");
    const raw = await fs.readFile(manifestPath, "utf-8");
    const manifest = JSON.parse(raw);
    expect(manifest.entries.some((e: { path: string }) =>
      e.path === "design-principles/separation-of-concerns.md"
    )).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — modules not found

- [ ] **Step 4: Implement `scripts/lib/parse-entry.ts`**

```typescript
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import type { EntryFrontmatter, ParsedEntry } from "./types.js";

export function parseEntryFile(absPath: string, knowledgeRoot: string): ParsedEntry {
  const raw = fs.readFileSync(absPath, "utf-8");
  const { data, content } = matter(raw);
  const relPath = path.relative(knowledgeRoot, absPath).split(path.sep).join("/");
  return {
    path: relPath,
    frontmatter: data as EntryFrontmatter,
    body: content.trim(),
  };
}
```

- [ ] **Step 5: Implement `scripts/lib/validate-entry.ts`**

```typescript
import Ajv from "ajv";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedEntry } from "./types.js";

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schema/entry.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validateSchema = ajv.compile(schema);

const REQUIRED_SECTIONS = ["## 实践要点", "## 权衡与反模式"];

export function validateEntry(parsed: ParsedEntry, allPaths: Set<string>): string[] {
  const errors: string[] = [];
  const { path: entryPath, frontmatter, body } = parsed;

  if (!validateSchema(frontmatter)) {
    for (const err of validateSchema.errors ?? []) {
      errors.push(`${entryPath}: ${err.instancePath} ${err.message}`);
    }
  }

  if (frontmatter.related) {
    for (const rel of frontmatter.related) {
      if (!allPaths.has(rel)) {
        errors.push(`${entryPath}: related path not found: ${rel}`);
      }
    }
  }

  if (frontmatter.status === "published") {
    for (const section of REQUIRED_SECTIONS) {
      if (!body.includes(section)) {
        errors.push(`${entryPath}: published entry missing section: ${section}`);
      }
    }
  }

  return errors;
}
```

- [ ] **Step 6: Implement `scripts/lib/build-manifest.ts`**

```typescript
import type { Manifest, ManifestEntry, ManifestTree, ParsedEntry } from "./types.js";

export function buildManifest(parsedEntries: ParsedEntry[]): Manifest {
  const entries: ManifestEntry[] = parsedEntries.map(({ path, frontmatter }) => ({
    path,
    title: frontmatter.title,
    date: frontmatter.date,
    summary: frontmatter.summary,
    status: frontmatter.status,
    tags: frontmatter.tags,
    keywords: frontmatter.keywords,
    applies_to: frontmatter.applies_to,
    related: frontmatter.related ?? [],
  }));

  entries.sort((a, b) => a.path.localeCompare(b.path));

  return {
    version: 1,
    generated_at: new Date().toISOString(),
    entries,
    tree: buildTree(entries.map((e) => e.path)),
  };
}

function buildTree(paths: string[]): ManifestTree {
  const tree: ManifestTree = {};
  for (const entryPath of paths.sort()) {
    const segments = entryPath.split("/");
    const fileName = segments.pop()!;
    if (segments.length === 0) {
      tree[fileName] = [fileName];
      continue;
    }
    let cursor: ManifestTree = tree;
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLast = i === segments.length - 1;
      if (!(seg in cursor)) {
        cursor[seg] = isLast ? [] : {};
      }
      const next = cursor[seg];
      if (isLast) {
        if (!Array.isArray(next)) throw new Error(`Path conflict at ${seg}`);
        next.push(fileName);
      } else {
        if (Array.isArray(next)) throw new Error(`Path conflict at ${seg}`);
        cursor = next as ManifestTree;
      }
    }
  }
  return tree;
}
```

- [ ] **Step 7: Implement `scripts/build-index.ts`**

```typescript
import fg from "fast-glob";
import fs from "node:fs/promises";
import path from "node:path";
import { parseEntryFile } from "./lib/parse-entry.js";
import { validateEntry } from "./lib/validate-entry.js";
import { buildManifest } from "./lib/build-manifest.js";

const ROOT = path.resolve(import.meta.dirname, "..");
const KNOWLEDGE_DIR = process.env.KNOWLEDGE_DIR ?? path.join(ROOT, "knowledge");
const MANIFEST_PATH = path.join(ROOT, "index/manifest.json");

async function main(): Promise<void> {
  const pattern = path.join(KNOWLEDGE_DIR, "**/*.md").replace(/\\/g, "/");
  const files = await fg(pattern, { onlyFiles: true });
  const parsed = files.map((f) => parseEntryFile(f, KNOWLEDGE_DIR));
  const allPaths = new Set(parsed.map((p) => p.path));

  const allErrors: string[] = [];
  for (const entry of parsed) {
    allErrors.push(...validateEntry(entry, allPaths));
  }

  if (allErrors.length > 0) {
    console.error("build-index failed:\n" + allErrors.join("\n"));
    process.exit(1);
  }

  const manifest = buildManifest(parsed);
  await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
  await fs.writeFile(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Wrote ${manifest.entries.length} entries to index/manifest.json`);
}

const isDirectRun = process.argv[1]?.includes("build-index");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

export { main };
```

- [ ] **Step 8: Run tests**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/ tests/
git commit -m "feat: add build-index with frontmatter validation"
```

---

### Task 4: Search Library and MCP Server

**Files:**
- Create: `scripts/lib/search.ts`
- Create: `scripts/lib/levenshtein.ts`
- Create: `mcp-server/src/index-reader.ts`
- Create: `mcp-server/src/tools/search-entries.ts`
- Create: `mcp-server/src/tools/get-entry.ts`
- Create: `mcp-server/src/tools/list-tree.ts`
- Create: `mcp-server/src/tools/get-stats.ts`
- Create: `mcp-server/src/index.ts`
- Create: `tests/search.test.ts`
- Create: `tests/mcp-tools.test.ts`

**Interfaces:**
- Consumes: `Manifest`, `ManifestEntry`, `SearchResult` from `scripts/lib/types.ts`
- Produces:
  - `searchEntries(entries: ManifestEntry[], params: SearchParams): SearchResult[]`
  - `loadManifest(root: string): { manifest: Manifest; stale: boolean }`
  - MCP tools: `search_entries`, `get_entry`, `list_tree`, `get_stats`

- [ ] **Step 1: Write failing search tests**

`tests/search.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test tests/search.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `scripts/lib/search.ts`**

```typescript
import type { ManifestEntry, SearchResult } from "./types.js";

export interface SearchParams {
  query: string;
  path_prefix?: string;
  tags?: string[];
  applies_to?: string;
  include_drafts?: boolean;
  limit?: number;
}

const FIELD_WEIGHTS: Record<string, number> = {
  title: 5,
  keywords: 4,
  tags: 3,
  applies_to: 2,
  summary: 1,
};

export function searchEntries(entries: ManifestEntry[], params: SearchParams): SearchResult[] {
  const limit = Math.min(params.limit ?? 10, 50);
  const terms = params.query.toLowerCase().split(/\s+/).filter(Boolean);

  let filtered = entries;

  if (!params.include_drafts) {
    filtered = filtered.filter((e) => e.status === "published");
  }
  if (params.path_prefix) {
    const prefix = params.path_prefix.replace(/\/$/, "");
    filtered = filtered.filter((e) => e.path.startsWith(prefix));
  }
  if (params.tags?.length) {
    filtered = filtered.filter((e) => params.tags!.every((t) => e.tags.includes(t)));
  }
  if (params.applies_to) {
    const needle = params.applies_to.toLowerCase();
    filtered = filtered.filter((e) =>
      e.applies_to.some((a) => a.toLowerCase().includes(needle))
    );
  }

  const results: SearchResult[] = [];
  for (const entry of filtered) {
    const matched_fields: string[] = [];
    let score = 0;

    for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
      const values: string[] =
        field === "tags" || field === "keywords" || field === "applies_to"
          ? (entry[field as keyof ManifestEntry] as string[])
          : [entry[field as keyof ManifestEntry] as string];

      const haystack = values.join(" ").toLowerCase();
      if (terms.some((t) => haystack.includes(t))) {
        matched_fields.push(field);
        score += weight * terms.filter((t) => haystack.includes(t)).length;
      }
    }

    if (score > 0) {
      results.push({ path: entry.path, title: entry.title, summary: entry.summary, score, matched_fields });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}
```

- [ ] **Step 4: Implement `scripts/lib/levenshtein.ts`**

```typescript
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

export function suggestSimilarPaths(target: string, paths: string[], max = 3): string[] {
  return paths
    .map((p) => ({ p, d: levenshtein(target.toLowerCase(), p.toLowerCase()) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.p);
}
```

- [ ] **Step 5: Implement MCP tool modules**

`mcp-server/src/index-reader.ts`:

```typescript
import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
import type { Manifest } from "../../scripts/lib/types.js";

export function loadManifest(root: string): { manifest: Manifest; stale: boolean } {
  const manifestPath = path.join(root, "index/manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error("manifest.json not found. Run: npm run build-index");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as Manifest;
  const manifestMtime = fs.statSync(manifestPath).mtimeMs;
  const knowledgeDir = path.join(root, "knowledge");
  const files = fg.sync(path.join(knowledgeDir, "**/*.md").replace(/\\/g, "/"));
  const stale = files.some((f) => fs.statSync(f).mtimeMs > manifestMtime);
  return { manifest, stale };
}
```

`mcp-server/src/tools/search-entries.ts`:

```typescript
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
```

`mcp-server/src/tools/get-entry.ts`:

```typescript
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
```

`mcp-server/src/tools/list-tree.ts`:

```typescript
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
```

`mcp-server/src/tools/get-stats.ts`:

```typescript
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
```

- [ ] **Step 6: Implement `mcp-server/src/index.ts`**

```typescript
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
```

Add `@modelcontextprotocol/sdk` and `zod` to root `package.json` dependencies (see Task 1).

- [ ] **Step 7: Write MCP tool tests**

`tests/mcp-tools.test.ts`:

```typescript
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
```

Note: Task 8 adds the example article before these tests pass against real data. Run Task 8 before expecting non-empty search results.

- [ ] **Step 8: Run all tests (after Task 8 example article exists)**

Run: `npm test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add scripts/lib/search.ts scripts/lib/levenshtein.ts mcp-server/ tests/ package.json
git commit -m "feat: add search library and MCP server tools"
```

---

### Task 5: ingest Skill

**Files:**
- Create: `.cursor/skills/ingest/SKILL.md`

**Interfaces:**
- Consumes: frontmatter schema, article template, `npm run build-index`
- Produces: Skill instructions for Agent-driven ingestion

- [ ] **Step 1: Create `.cursor/skills/ingest/SKILL.md`**

Include:
- Trigger: user provides URL, notes, or conversation context to ingest
- Steps: identify input type → extract content → dedup via reading `index/manifest.json` → choose directory/slug → write file with full frontmatter + 6-section body → run `npm run build-index` → report path/title/tags
- Dedup rule: if title or tags overlap strongly with existing entry, ask user: update / new / cancel
- Directory rule: kebab-case, semantic, prefer existing nearby directories
- Frontmatter: all required fields per schema; `status: published` for completed ingest
- Body template: 背景 / 核心思想 / 实践要点 / 代码示例 / 权衡与反模式 / 参考
- Never use MCP write tools

- [ ] **Step 2: Commit**

```bash
git add .cursor/skills/ingest/SKILL.md
git commit -m "feat: add ingest Skill for knowledge base"
```

---

### Task 6: reorganize Skill

**Files:**
- Create: `.cursor/skills/reorganize/SKILL.md`

**Interfaces:**
- Consumes: draft entries (`status: draft`), schema, article template, `npm run build-index`
- Produces: Skill instructions for draft cleanup

- [ ] **Step 1: Create `.cursor/skills/reorganize/SKILL.md`**

Include:
- Trigger: user points to draft file or asks to reorganize all drafts
- Steps: read draft → complete frontmatter → rewrite body sections → move file if needed → set `status: published` → update any `related` references → run `npm run build-index`
- Move rule: use `git mv` or equivalent; update inbound `related` links in other files if path changes
- Validation: published entries must pass schema + required sections

- [ ] **Step 2: Commit**

```bash
git add .cursor/skills/reorganize/SKILL.md
git commit -m "feat: add reorganize Skill for draft articles"
```

---

### Task 7: Documentation and MCP Config

**Files:**
- Create: `README.md`
- Create: `AGENTS.md`
- Create: `.cursor/mcp.json`

**Interfaces:**
- Produces: human README, Agent guide, MCP wiring example

- [ ] **Step 1: Create `AGENTS.md`**

Content:
- Purpose of repo
- Retrieval: use MCP `search_entries` → `get_entry`; browse with `list_tree`
- Ingestion: use ingest Skill
- Draft cleanup: use reorganize Skill
- Article conventions: frontmatter fields, body sections, kebab-case paths
- Index rebuild: `npm run build-index`

- [ ] **Step 2: Create `README.md`**

Content:
- Project overview (Chinese OK)
- Quick start: `npm install`, add article to `knowledge/`, `npm run build-index`
- MCP setup: copy `.cursor/mcp.json` config
- Skills: ingest / reorganize usage summary
- Link to design spec

- [ ] **Step 3: Create `.cursor/mcp.json`**

```json
{
  "mcpServers": {
    "wiki-knowledge-base": {
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "${workspaceFolder}"
    }
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add README.md AGENTS.md .cursor/mcp.json
git commit -m "docs: add README, AGENTS guide, and MCP config"
```

---

### Task 8: Example Article and End-to-End Smoke Test

**Files:**
- Create: `knowledge/design-principles/separation-of-concerns.md`
- Create: `tests/e2e-smoke.test.ts`

**Interfaces:**
- Consumes: entire stack from Tasks 1–7
- Produces: one published example article; passing e2e test

- [ ] **Step 1: Add example article**

Copy content from `tests/fixtures/valid-entry.md` into `knowledge/design-principles/separation-of-concerns.md`, updating path-appropriate frontmatter if needed.

- [ ] **Step 2: Build index**

Run: `npm run build-index`
Expected: `Wrote 1 entries to index/manifest.json`

- [ ] **Step 3: Write e2e smoke test**

`tests/e2e-smoke.test.ts`:

```typescript
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
```

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: all PASS

- [ ] **Step 5: Manual MCP smoke (optional)**

Run: `npm run mcp` — server starts without error (Ctrl+C to stop)

- [ ] **Step 6: Commit**

```bash
git add knowledge/ index/manifest.json tests/e2e-smoke.test.ts
git commit -m "feat: add example article and e2e smoke test"
```

---

## Spec Coverage Check

| Spec Requirement | Task |
|------------------|------|
| Repository structure | Task 1 |
| Frontmatter JSON Schema | Task 2 |
| build-index with validation | Task 3 |
| manifest.json format | Task 3 |
| MCP 4 tools | Task 4 |
| Layered keyword search | Task 4 |
| Draft exclusion default | Task 4 |
| Stale manifest warning | Task 4 |
| get_entry 404 + suggestions | Task 4 |
| ingest Skill | Task 5 |
| reorganize Skill | Task 6 |
| AGENTS.md + README | Task 7 |
| Example published article | Task 8 |
| Vitest tests | Tasks 3, 4, 8 |
| Semantic search (deferred) | Not in plan |
| pre-commit hook (deferred) | Not in plan |

## Self-Review Notes

- `buildTree` leaf nodes are `string[]` per design spec; `list_tree` distinguishes directories (object values) from file lists (array values)
- CLI test calls `main()` export from build-index; `isDirectRun` guard prevents double execution on import
- Draft entries allow empty `keywords`/`applies_to`; published entries require minItems 1 via schema + section checks
- MCP SDK and zod in root `package.json` (single package — no nested mcp-server/package.json)
- Task 8 must run before MCP handler tests expect non-empty search results
