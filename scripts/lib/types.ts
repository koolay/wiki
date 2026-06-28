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
