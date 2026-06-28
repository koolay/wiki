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
