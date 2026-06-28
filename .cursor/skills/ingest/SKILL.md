---
name: ingest
description: >-
  Ingest external knowledge into the wiki knowledge base. Use when the user
  provides a URL, notes, or conversation context to archive as a theme article,
  asks to save or ingest learning material, or wants to add a new published
  entry to knowledge/.
---

# Ingest Knowledge

Turn a URL, raw notes, or conversation context into a published theme article under `knowledge/`, then rebuild the index.

**Write path:** input → this Skill → `knowledge/{path}/{slug}.md` → `npm run build-index` → `index/manifest.json`

**Read path (dedup only):** read `index/manifest.json` or MCP read tools — never write via MCP.

## When to Use

Apply this skill when any of the following is true:

| Trigger | Examples |
|---------|----------|
| **URL** | User shares a link and asks to ingest, save, or summarize it into the knowledge base |
| **Notes** | User pastes bullet points, excerpts, or unstructured notes to turn into an article |
| **Conversation** | User refers to prior chat context ("save what we discussed", "archive this thread") and wants it persisted |

Do **not** use this skill for:

- Reorganizing existing `status: draft` files → use the **reorganize** skill instead
- Read-only lookup of existing articles → use MCP `search_entries` / `get_entry` or read files directly
- Bulk directory moves or link repair → use the **reorganize** skill

## Constraints

- **Never use MCP write tools.** This repository's MCP server is read-only. All writes use workspace file tools (Write, StrReplace) or shell — not MCP create/update/delete APIs.
- **Never skip `npm run build-index`** after writing a file. The manifest must stay in sync with `knowledge/`.
- **Completed ingest = `status: published`.** Do not leave a finished ingest as `draft`; drafts are for manual stubs awaiting reorganize.
- **Validate before finishing.** If `build-index` fails, fix frontmatter/body errors and re-run until it passes.

## Workflow

Follow these steps in order. Do not write the file until dedup is resolved.

### Step 1: Identify input type

Classify the user's input:

| Type | How to obtain content |
|------|----------------------|
| **URL** | Fetch or browse the page. Extract the main technical content; ignore nav, ads, and comment sections. Record the URL for `source`. |
| **Notes** | Use the pasted text as primary material. Ask the user for a source URL only if they mention one. |
| **Conversation** | Synthesize the relevant technical points from the chat. Set `source[].type` to `conversation` and use a descriptive placeholder URL (e.g. `conversation://cursor/2026-06-28`) or omit `source` if no external reference exists. |

If the input is ambiguous (e.g. a URL plus long notes), treat notes as primary and attach the URL in `source`.

### Step 2: Extract and synthesize

From the source material, distill a **theme article** — not a transcript or link dump:

- One clear topic per file (~800–1500 Chinese characters, or equivalent English length)
- Focus on program design knowledge: principles, patterns, trade-offs, actionable guidance
- Pull out concrete keywords, tags, and `applies_to` scenarios for Agent retrieval

### Step 3: Dedup check

Read `index/manifest.json` (create it first with `npm run build-index` if missing). Compare the planned article against existing `entries`:

**Strong overlap signals** (any one may trigger dedup):

- **Title similarity** — same topic phrasing, shared distinctive terms, or translation of the same concept
- **Tag overlap** — two or more tags match an existing entry **and** the subject matter is the same theme
- **Keyword overlap** — multiple keywords match **and** summaries describe the same problem space
- **Same source URL** — `source[].url` already appears on another entry

When overlap is strong, **stop and ask the user** before writing:

```
A similar entry already exists:
  Path:  {existing.path}
  Title: {existing.title}

Options:
  1. **update** — revise the existing file instead of creating a new one
  2. **new**     — create a separate article (explain why it differs)
  3. **cancel**  — abort ingestion
```

- **update**: open the existing file under `knowledge/`, merge new insights, refresh `date` if substantially revised, then run `build-index`
- **new**: proceed only if the user confirms; ensure title/tags clearly distinguish the article
- **cancel**: stop without writing

If `index/manifest.json` is empty or no overlap is found, continue.

### Step 4: Choose directory and slug

**Directory rules:**

- Use **kebab-case** segments (e.g. `design-principles`, `languages/rust`)
- Choose semantics from content, not a fixed taxonomy — directories are created organically
- **Prefer existing nearby directories** when the topic fits (browse `manifest.json` `tree` or list `knowledge/`)
- Create new subdirectories only when no existing path fits; keep depth reasonable (typically 1–3 levels)

**File rules:**

- Filename: `{slug}.md` in kebab-case, English or pinyin
- Full path: `knowledge/{directory}/{slug}.md`
- Slug should be short, descriptive, and unique among siblings

Examples:

- Rust error handling → `knowledge/languages/rust/error-handling.md`
- Separation of concerns → `knowledge/design-principles/separation-of-concerns.md`

### Step 5: Write frontmatter

Every ingested published article needs YAML frontmatter conforming to `schema/entry.schema.json`.

**Required fields** (all must be present):

| Field | Rules |
|-------|-------|
| `title` | string, 1–120 characters; specific and searchable |
| `date` | `YYYY-MM-DD` (use today's date for new ingest) |
| `summary` | string, 1–300 characters; one-sentence Agent relevance hook |
| `status` | `published` for completed ingest |
| `tags` | array, min 1; kebab-case or short tokens (e.g. `rust`, `error-handling`) |
| `keywords` | array, min 1 for published; terms Agents might search |
| `applies_to` | array, min 1 for published; problem contexts / when to apply this knowledge |

**Optional fields:**

| Field | Rules |
|-------|-------|
| `source` | array of `{ url, type }`; `type` is `article` \| `video` \| `book` \| `conversation` |
| `related` | array of paths relative to `knowledge/`; **every path must already exist** |

**Frontmatter example:**

```yaml
---
title: "Rust 错误处理：Result 与 ? 运算符"
date: 2026-06-28
summary: "Rust 用 Result<T,E> 显式处理可恢复错误，? 运算符简化传播链。"
status: published
tags:
  - rust
  - error-handling
keywords:
  - Result
  - "? operator"
  - error propagation
applies_to:
  - "可恢复错误的显式处理"
  - "库/API 的错误返回设计"
source:
  - url: "https://doc.rust-lang.org/book/ch09-00-error-handling.html"
    type: article
related:
  - "languages/rust/ownership-and-borrowing.md"
---
```

Do not add fields outside the schema (`additionalProperties: false`).

Only include `related` entries whose target files exist under `knowledge/`. If no related articles exist yet, omit the field.

### Step 6: Write body (six sections)

Use exactly these level-2 headings in order. Content language is free (Chinese or English); heading names stay as shown:

```markdown
## 背景

Why this topic matters; problem context and motivation.

## 核心思想

The central concept, pattern, or principle in clear prose.

## 实践要点

Actionable guidance — bullet lists or numbered steps. **Required for published entries.**

## 代码示例

Optional illustrative code or pseudocode. Use "(无)" or "Not applicable" if the topic has no code angle.

## 权衡与反模式

Trade-offs, costs, and anti-patterns to avoid. **Required for published entries.**

## 参考

Links, papers, or citations (including the source URL when applicable).
```

Validation notes:

- `build-index` checks that published bodies contain `## 实践要点` and `## 权衡与反模式` as literal substrings
- Target length: ~800–1500 Chinese characters total (or equivalent)
- Write substantive content in each section; do not leave placeholder headings empty

### Step 7: Write the file

Create or update `knowledge/{directory}/{slug}.md` with frontmatter + body using workspace file tools.

- Use the **Write** tool for new files
- Use **StrReplace** or **Write** for updates when the user chose **update** in dedup
- Do not write to `index/` manually — `build-index` generates `manifest.json`

### Step 8: Rebuild index

From the repository root, run:

```bash
npm run build-index
```

- **Success:** note the entry count in the output (e.g. `Wrote N entries to index/manifest.json`)
- **Failure:** read error messages (schema violations, missing sections, invalid `related` paths), fix the markdown file, and re-run until clean

### Step 9: Report to user

Summarize what was ingested:

```
Ingested:
  Path:  knowledge/{directory}/{slug}.md
  Title: {title}
  Tags:  {comma-separated tags}
  Index: rebuilt ({N} entries)
```

If the user chose **update**, report the updated path and what changed at a high level.

## Quick Reference

| Item | Rule |
|------|------|
| File naming | `{slug}.md`, kebab-case |
| Directory naming | kebab-case, semantic, prefer existing dirs |
| Ingest status | `published` |
| MCP | read-only — never write via MCP |
| After write | always `npm run build-index` |
| Required body sections | `## 实践要点`, `## 权衡与反模式` |
| Body template sections | 背景 → 核心思想 → 实践要点 → 代码示例 → 权衡与反模式 → 参考 |
| Schema | `schema/entry.schema.json` |
| Dedup | strong title/tag overlap → ask update / new / cancel |

## Related

- Draft cleanup and path moves: `.cursor/skills/reorganize/SKILL.md`
- Agent conventions: `AGENTS.md` (when present)
- Design spec: `docs/superpowers/specs/2026-06-28-agent-knowledge-base-design.md`
