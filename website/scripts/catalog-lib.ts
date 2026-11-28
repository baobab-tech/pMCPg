// Shared by build-catalog.ts (maintainer, before commit) and check-catalog.ts (website prebuild).
// Sources: catalog/servers/<slug>.json (one Entry each) and catalog/presets/<id>.json (one Preset each).
// Output: public/catalog/v1/catalog.json, served at CATALOG_URL. Schema: src/catalog/schema.ts.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { z } from "zod";
import { CATALOG_FORMAT, CatalogFile, Entry, Preset } from "../../src/catalog/schema.ts";

export const WEBSITE_DIR = join(import.meta.dirname, "..");
export const SOURCES_DIR = join(WEBSITE_DIR, "catalog");
export const OUTPUT_FILE = join(WEBSITE_DIR, "public", "catalog", "v1", "catalog.json");
export const EXPIRES_DAYS = 90;

const FILE_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?\.json$/;

export interface Sources {
  servers: Entry[];
  presets: Preset[];
}

export interface Meta {
  serial: number;
  generatedAt: string;
  expires: string;
}

/** Every problem found, one line each, so a maintainer fixes them in one pass. */
export class SourceError extends Error {
  constructor(readonly problems: string[]) {
    super(`${problems.length} problem(s) in catalog sources:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "SourceError";
  }
}

/** Paths of string values starting with "TODO": catalog-import.ts drafts carry them until reviewed. */
function todoPaths(value: unknown, path = ""): string[] {
  if (typeof value === "string") return /^TODO\b/.test(value) ? [path || "(root)"] : [];
  if (Array.isArray(value)) return value.flatMap((v, i) => todoPaths(v, `${path}[${i}]`));
  if (value && typeof value === "object")
    return Object.entries(value).flatMap(([k, v]) => todoPaths(v, path ? `${path}.${k}` : k));
  return [];
}

function readDir<T>(
  dir: string,
  schema: z.ZodType<T, unknown>,
  problems: string[],
): { file: string; data: T }[] {
  if (!existsSync(dir)) return [];
  const out: { file: string; data: T }[] = [];
  for (const file of readdirSync(dir).sort()) {
    if (!file.endsWith(".json")) continue;
    const rel = `${basename(dir)}/${file}`;
    if (!FILE_SLUG.test(file)) {
      problems.push(`${rel}: file name must be a lowercase slug ending in .json`);
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch (e) {
      problems.push(`${rel}: not valid JSON (${(e as Error).message})`);
      continue;
    }
    const todos = todoPaths(json);
    if (todos.length) {
      problems.push(`${rel}: still has TODO at ${todos.join(", ")}`);
      continue;
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      for (const i of parsed.error.issues) problems.push(`${rel}: ${i.path.join(".") || "(root)"}: ${i.message}`);
      continue;
    }
    out.push({ file, data: parsed.data });
  }
  return out;
}

/** Read and validate every source file. Throws SourceError listing all problems. */
export function readSources(root = SOURCES_DIR): Sources {
  const problems: string[] = [];
  const servers = readDir(join(root, "servers"), Entry, problems);
  const presets = readDir(join(root, "presets"), Preset, problems);
  for (const p of presets)
    if (p.file !== `${p.data.id}.json`) problems.push(`presets/${p.file}: file name must be ${p.data.id}.json`);
  if (problems.length) throw new SourceError(problems);
  return { servers: servers.map((s) => s.data), presets: presets.map((p) => p.data) };
}

/** Sorted, validated catalog file. Cross-file checks (duplicate names, unknown preset servers) run here. */
export function buildCatalog(sources: Sources, meta: Meta): CatalogFile {
  const file = {
    format: CATALOG_FORMAT,
    serial: meta.serial,
    generatedAt: meta.generatedAt,
    expires: meta.expires,
    servers: [...sources.servers].sort((a, b) => a.name.localeCompare(b.name, "en")),
    presets: [...sources.presets].sort((a, b) => a.id.localeCompare(b.id, "en")),
  };
  const parsed = CatalogFile.safeParse(file);
  if (!parsed.success)
    throw new SourceError(parsed.error.issues.map((i) => `catalog: ${i.path.join(".")}: ${i.message}`));
  return parsed.data;
}

/** The exact bytes written to OUTPUT_FILE and signed. */
export function serialize(file: CatalogFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** generatedAt and expires for a build at `now`, to the second. */
export function freshMeta(serial: number, now = new Date()): Meta {
  const at = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const expires = new Date(at.getTime() + EXPIRES_DAYS * 86_400_000);
  return { serial, generatedAt: at.toISOString(), expires: expires.toISOString() };
}
