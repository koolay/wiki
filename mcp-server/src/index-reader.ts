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
