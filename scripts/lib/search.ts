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
