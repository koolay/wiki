---
name: reorganize
description: >-
  Clean up draft knowledge base articles and publish them. Use when the user
  points to a draft file (status: draft), asks to reorganize a draft, or asks
  to reorganize all drafts in knowledge/.
---

# Reorganize Draft Articles

Transform `status: draft` entries in `knowledge/` into complete, published theme articles. This Skill handles frontmatter completion, body rewriting, file moves, related-link updates, and index rebuild.

**Read/write boundary:** MCP tools are read-only. All writes go through this Skill and Git — never use MCP write/update/delete tools.

## When to Use

Apply this Skill when:

- The user points to a specific draft file (e.g. `knowledge/drafts/my-note.md`)
- The user asks to reorganize, clean up, or publish a draft
- The user asks to reorganize **all** drafts (batch mode)

Do **not** use for new content from URLs, notes, or conversation — use the **ingest** Skill instead.

## Prerequisites

Before starting, read:

- `schema/entry.schema.json` — frontmatter constraints
- `docs/superpowers/specs/2026-06-28-agent-knowledge-base-design.md` — article conventions (if present)
- Target draft file(s) under `knowledge/`

Optionally read `index/manifest.json` to understand existing directories, tags, and related entries for placement decisions.

## Workflow Overview

```
Identify target(s) → Read draft → Complete frontmatter → Rewrite body
  → Move file if needed → Set status: published → Update related refs
  → Run build-index → Report summary
```

---

## Step 1: Identify Target Draft(s)

### Single draft

When the user specifies a file path, confirm it exists and has `status: draft` in frontmatter. If `status: published`, stop and tell the user the file is already published.

### All drafts (batch mode)

When the user asks to reorganize all drafts:

1. Scan `knowledge/**/*.md` for files with `status: draft`
2. Alternatively, read `index/manifest.json` and filter entries where `status === "draft"`
3. Process each draft one at a time; report progress after each file
4. If no drafts found, report that and stop

---

## Step 2: Read the Draft

Read the full file: YAML frontmatter and body.

Note what is already present vs. missing:

| Field | Draft minimum | Published requirement |
|-------|---------------|----------------------|
| `title` | required (may be placeholder) | 1–120 chars, descriptive |
| `date` | required | `YYYY-MM-DD` |
| `summary` | required (may be placeholder) | 1–300 chars, Agent-relevant |
| `status` | `draft` | `published` |
| `tags` | ≥1 (may be `uncategorized`) | ≥1, semantic kebab-case |
| `keywords` | may be `[]` | ≥1 item |
| `applies_to` | may be `[]` | ≥1 item |
| `source` | optional | optional; each item needs `url` + `type` |
| `related` | optional | optional; paths must exist |

Preserve useful existing content from the draft body — do not discard the author's notes unless they are redundant after rewriting.

---

## Step 3: Complete Frontmatter

Rewrite all frontmatter fields to meet published requirements:

```yaml
---
title: "Descriptive theme title"
date: 2026-06-28
summary: "One-sentence summary for Agent relevance checks (≤300 chars)."
status: published
tags:
  - semantic-tag
  - another-tag
keywords:
  - keyword one
  - keyword two
applies_to:
  - "When to apply this knowledge"
  - "Another applicable scenario"
source:
  - url: "https://example.com/original"
    type: article
related:
  - "path/to/related-article.md"
---
```

**Field guidance:**

- **title** — Clear theme title, not a filename or placeholder
- **date** — Keep original draft date or use today if unknown
- **summary** — Concise; answers "what is this about and why does it matter?"
- **tags** — kebab-case topic labels; replace `uncategorized` with meaningful tags
- **keywords** — Search terms an Agent would use (English or Chinese OK)
- **applies_to** — Concrete scenarios where this knowledge applies
- **source** — Add if the draft references external material; `type` is one of: `article`, `video`, `book`, `conversation`
- **related** — Paths relative to `knowledge/`; only reference **existing** articles (check manifest or filesystem)

Do **not** set `status: published` until Step 6 (after body rewrite and any file move).

---

## Step 4: Rewrite Body to Template

Replace or expand the draft body to match the fixed section template:

```markdown
## 背景

Context and motivation for this topic.

## 核心思想

The central idea or principle.

## 实践要点

Actionable guidance. Bullet list encouraged.

## 代码示例

Optional code snippets illustrating the idea. Omit section entirely if not applicable.

## 权衡与反模式

Trade-offs, pitfalls, and anti-patterns to avoid.

## 参考

External references, further reading, or attribution.
```

**Body rules:**

- Target length: ~800–1500 Chinese characters (or equivalent English)
- **Required sections for published articles:** `## 实践要点` and `## 权衡与反模式` (exact heading text)
- `## 代码示例` is optional — include only when code adds value
- Preserve and integrate useful content from the original draft
- Write for Agent consumption: clear structure, concrete guidance

---

## Step 5: Move File if Needed

Decide whether the current path is semantically appropriate.

### Naming conventions

| Item | Rule |
|------|------|
| Filename | `{slug}.md`, kebab-case, English or pinyin |
| Directory | kebab-case, AI-created based on content semantics |
| Full path | Relative to `knowledge/`, e.g. `languages/rust/error-handling.md` |

### When to move

Move when:

- Draft sits in a catch-all directory (e.g. `drafts/`, `uncategorized/`) and belongs elsewhere
- Filename slug does not match the finalized title/topic
- A better semantic directory already exists nearby (prefer existing directories over creating new top-level ones when reasonable)

### How to move

**Always use `git mv`** to preserve history:

```bash
git mv knowledge/old/path/draft-slug.md knowledge/new/path/final-slug.md
```

If the file is untracked (not yet in Git), a regular `mv` is acceptable, then `git add` the new path.

Record the old path and new path — you need the old path for related-link updates.

### Do not move when

The current path is already semantic and the slug matches the topic. Updating content in place is fine.

---

## Step 6: Set `status: published`

After frontmatter is complete, body matches the template, and any move is done:

1. Set `status: published` in frontmatter
2. Write the final file content

Order matters: do not publish before required fields and body sections are satisfied.

---

## Step 7: Update Related References

### Outbound `related` (this article)

Ensure every path in this article's `related` array:

- Is relative to `knowledge/` (e.g. `design-principles/separation-of-concerns.md`)
- Points to an **existing** file
- Uses the correct path after any moves by other articles

### Inbound `related` (other articles pointing here)

If the file path changed in Step 5, update **all other articles** whose `related` frontmatter contains the old path:

1. Search for the old path across `knowledge/**/*.md`:

   ```bash
   rg -l 'old/path/draft-slug.md' knowledge/
   ```

2. In each matching file, replace the old path with the new path in the `related` array
3. Preserve YAML formatting

If no path changed, skip inbound updates.

---

## Step 8: Run build-index

After all edits and moves:

```bash
npm run build-index
```

**Must pass with zero errors.** If validation fails:

1. Read the error output (file path + field/section details)
2. Fix the offending file(s)
3. Re-run `npm run build-index` until it succeeds

Do not report success to the user until build-index passes.

---

## Step 9: Report Summary

After a successful build-index, report:

| Field | Value |
|-------|-------|
| Path | Final path relative to `knowledge/` |
| Title | From frontmatter |
| Tags | From frontmatter |
| Moved | Yes/No; if yes, old → new path |
| Related updated | Count of inbound files updated |
| Status | `published` |

For batch mode, provide a table or list covering every processed draft.

---

## Validation Requirements

Published entries must pass **all** checks enforced by `npm run build-index`:

### JSON Schema (`schema/entry.schema.json`)

| Field | Rule |
|-------|------|
| `title` | string, 1–120 chars |
| `date` | `YYYY-MM-DD` |
| `summary` | string, 1–300 chars |
| `status` | `draft` \| `published` |
| `tags` | array, min 1 item |
| `keywords` | array, **min 1 item when published** |
| `applies_to` | array, **min 1 item when published** |
| `source` | optional; each item requires `url` + `type` |
| `related` | optional; each path must reference an existing article |
| Extra fields | Not allowed (`additionalProperties: false`) |

### Body sections (published only)

The body **must** contain these exact headings:

- `## 实践要点`
- `## 权衡与反模式`

Missing either heading causes build-index to fail.

### Related path integrity

Every path in `related` must match an existing file under `knowledge/`. After moves, verify both outbound and inbound references.

---

## Batch Mode Notes

When reorganizing all drafts:

1. List all drafts upfront and confirm with the user if count > 5
2. Process sequentially to avoid conflicting moves or related-link races
3. Run `npm run build-index` once after **all** drafts are processed (not after each file), unless an intermediate build helps debug a single failure
4. If one draft cannot be completed (insufficient content), leave it as `draft`, explain why, and continue with the rest

---

## Anti-Patterns

- **Do not** set `status: published` while `keywords` or `applies_to` are empty
- **Do not** use plain `mv` for tracked files — use `git mv`
- **Do not** skip inbound related-link updates after a path change
- **Do not** skip `npm run build-index` before reporting completion
- **Do not** use MCP tools to write or modify files
- **Do not** invent `related` paths to articles that do not exist

---

## Quick Reference

```bash
# Find all drafts via manifest
node -e "const m=require('./index/manifest.json'); console.log(m.entries.filter(e=>e.status==='draft').map(e=>e.path).join('\n'))"

# Find inbound related links after a move
rg -l 'old/path/file.md' knowledge/

# Move with history
git mv knowledge/old/path/file.md knowledge/new/path/file.md

# Validate and rebuild index
npm run build-index
```
