import Ajv from "ajv";
import addFormats from "ajv-formats";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ParsedEntry } from "./types.js";

const schemaPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../schema/entry.schema.json");
const schema = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));
const ajv = new Ajv({ allErrors: true, strict: false, validateSchema: false });
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
