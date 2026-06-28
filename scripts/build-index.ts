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
