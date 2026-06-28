# Agent Usage Guide

This repository is a Git-backed, Agent-oriented knowledge base. Markdown articles in `knowledge/` are the source of truth; `index/manifest.json` is a derived index for fast retrieval. Agents should prefer MCP tools for discovery and full-text reads, and use Cursor Skills for writes.

## Purpose

Curate theme articles (~800–1500 characters) about computer program design: principles, patterns, trade-offs, and actionable guidance. Content is structured for Agent consumption — rich frontmatter, fixed body sections, and keyword search over the manifest.

**Read path:** MCP (`search_entries` / `list_tree`) → manifest → MCP (`get_entry`) → full article

**Write path:** ingest or reorganize Skill → `knowledge/*.md` → `npm run build-index` → updated manifest

MCP is **read-only**. Never use MCP to create, update, or delete files.

---

## Retrieval via MCP

Configure the MCP server per `.cursor/mcp.json` (see README). After setup, use these tools:

### Recommended flow

1. **`search_entries`** — Find candidates by keyword with optional filters
2. **`get_entry`** — Load full frontmatter, body, and resolved `related_entries`
3. **`list_tree`** — Browse directory structure when exploring without a query
4. **`get_stats`** — Check entry counts, top-level dirs, and whether the manifest is stale

### `search_entries`

Search published entries by keyword with layered scoring (title > keywords > tags > applies_to > summary).

| Parameter | Default | Notes |
|-----------|---------|-------|
| `query` | (required) | Space-separated keywords; case-insensitive |
| `path_prefix` | — | Limit to paths under a directory (e.g. `design-principles`) |
| `tags` | — | All listed tags must match |
| `applies_to` | — | Substring match on applies_to values |
| `include_drafts` | `false` | Set `true` to include `status: draft` entries |
| `limit` | `10` | Max `50` |

Example: search for separation of concerns in design principles:

```
search_entries({ query: "separation modularity", path_prefix: "design-principles" })
```

### `get_entry`

Returns `{ frontmatter, body, related_entries }` for a path relative to `knowledge/` (e.g. `design-principles/separation-of-concerns.md`).

If the path is missing, the tool throws with up to three similar path suggestions.

### `list_tree`

Browse the knowledge tree. Optional `path` argument scopes to a subdirectory (e.g. `design-principles`). Returns `{ directories, entries }` where `entries` include path, title, and summary.

### `get_stats`

Returns `{ total_entries, published, drafts, top_level_dirs, last_indexed, stale }`.

If `stale` is `true`, run `npm run build-index` — one or more markdown files are newer than the manifest.

### Stale manifest

The MCP server logs a warning when the manifest may be stale. Agents should run `npm run build-index` after any write, or when `get_stats` reports `stale: true`.

---

## Ingestion: ingest Skill

**When:** User provides a URL, notes, or conversation context to archive as a new theme article.

**Skill path:** `.cursor/skills/ingest/SKILL.md`

**Summary:**

1. Identify input type (URL / notes / conversation)
2. Extract and synthesize a single theme article
3. Dedup against `index/manifest.json` — ask user **update / new / cancel** on strong overlap
4. Choose directory and `{slug}.md` (kebab-case, prefer existing nearby dirs)
5. Write frontmatter per schema with `status: published`
6. Write body with six sections (see conventions below)
7. Run `npm run build-index`
8. Report path, title, tags

Never write via MCP. Never skip index rebuild.

---

## Draft cleanup: reorganize Skill

**When:** User points to a draft file or asks to reorganize all drafts.

**Skill path:** `.cursor/skills/reorganize/SKILL.md`

**Summary:**

1. Identify target draft(s) (`status: draft`)
2. Complete frontmatter (keywords, applies_to, tags, etc.)
3. Rewrite body to the six-section template
4. Move file with `git mv` if path/slug is wrong; update inbound `related` links
5. Set `status: published`
6. Run `npm run build-index`
7. Report path, title, tags, move status

Use **ingest** for new external content; use **reorganize** only for existing drafts.

---

## Article conventions

### Paths and naming

| Item | Rule |
|------|------|
| Filename | `{slug}.md`, kebab-case, English or pinyin |
| Directory | kebab-case, semantic, created organically (no fixed taxonomy) |
| Full path | `knowledge/{directory}/{slug}.md` |
| Status | `draft` (pending cleanup) or `published` (archived) |

### Frontmatter (required fields)

Schema: `schema/entry.schema.json`

| Field | Published requirement |
|-------|----------------------|
| `title` | 1–120 characters |
| `date` | `YYYY-MM-DD` |
| `summary` | 1–300 characters |
| `status` | `draft` or `published` |
| `tags` | min 1 item |
| `keywords` | min 1 item when published |
| `applies_to` | min 1 item when published |
| `source` | optional; `{ url, type }` where type is `article` \| `video` \| `book` \| `conversation` |
| `related` | optional; paths relative to `knowledge/`; every path must exist |

No extra fields allowed (`additionalProperties: false`).

### Body sections (fixed order)

```markdown
## 背景
## 核心思想
## 实践要点
## 代码示例
## 权衡与反模式
## 参考
```

**Published entries must contain** the exact headings `## 实践要点` and `## 权衡与反模式`. `## 代码示例` is optional when not applicable.

---

## Index rebuild

After any change under `knowledge/`, run from the repository root:

```bash
npm run build-index
```

This scans all `knowledge/**/*.md`, validates frontmatter against JSON Schema, checks required body sections and `related` paths, and writes `index/manifest.json`.

- **Success:** `Wrote N entries to index/manifest.json`
- **Failure:** Fix reported errors in the markdown files and re-run

For tests or alternate knowledge roots: `KNOWLEDGE_DIR=/path/to/knowledge npm run build-index`

---

## Quick reference

| Task | Action |
|------|--------|
| Find articles | MCP `search_entries` |
| Read full article | MCP `get_entry` |
| Browse structure | MCP `list_tree` |
| Check index health | MCP `get_stats` |
| Add new content | ingest Skill |
| Publish drafts | reorganize Skill |
| Rebuild index | `npm run build-index` |
| Schema | `schema/entry.schema.json` |
| Design spec | `docs/superpowers/specs/2026-06-28-agent-knowledge-base-design.md` |
