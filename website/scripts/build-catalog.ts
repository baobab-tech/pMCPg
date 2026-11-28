// Maintainer command, run before commit (never on Vercel): validate the sources and write
// public/catalog/v1/catalog.json with the next serial, generatedAt now and expires in 90 days.
// Usage: bun scripts/build-catalog.ts [--force]
// Then sign it: bun ../scripts/catalog-sign.ts public/catalog/v1/catalog.json
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { buildCatalog, freshMeta, OUTPUT_FILE, readSources, SourceError, serialize } from "./catalog-lib.ts";

export interface BuildResult {
  changed: boolean;
  serial: number;
  servers: number;
  presets: number;
}

/** Previous serial and content bytes (built with the previous metadata), or none. */
function previous(out: string): { serial: number; json: Record<string, unknown> } | undefined {
  if (!existsSync(out)) return undefined;
  const json = JSON.parse(readFileSync(out, "utf8")) as Record<string, unknown>;
  return typeof json.serial === "number" ? { serial: json.serial, json } : undefined;
}

export function build(opts: { sourcesDir?: string; out?: string; force?: boolean; now?: Date } = {}): BuildResult {
  const out = opts.out ?? OUTPUT_FILE;
  const sources = readSources(opts.sourcesDir);
  const prev = previous(out);

  if (prev && !opts.force) {
    const same = buildCatalog(sources, {
      serial: prev.serial,
      generatedAt: String(prev.json.generatedAt),
      expires: String(prev.json.expires),
    });
    if (serialize(same) === readFileSync(out, "utf8"))
      return { changed: false, serial: prev.serial, servers: same.servers.length, presets: same.presets.length };
  }

  const file = buildCatalog(sources, freshMeta((prev?.serial ?? 0) + 1, opts.now));
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, serialize(file));
  // The old signature covers the old bytes; leaving it would only fail the build check.
  rmSync(`${out}.sig`, { force: true });
  return { changed: true, serial: file.serial, servers: file.servers.length, presets: file.presets.length };
}

if (import.meta.main) {
  try {
    const r = build({ force: process.argv.includes("--force") });
    const rel = relative(process.cwd(), OUTPUT_FILE);
    if (!r.changed) {
      console.log(`No change: ${rel} already matches the sources (serial ${r.serial}). Pass --force to rebuild.`);
    } else {
      console.log(`Wrote ${rel}: serial ${r.serial}, ${r.servers} servers, ${r.presets} presets.`);
      console.log(`Sign it, then commit both files:\n  bun ${relative(process.cwd(), `${import.meta.dirname}/../../scripts/catalog-sign.ts`)} ${rel}`);
    }
  } catch (e) {
    console.error(e instanceof SourceError ? e.message : e);
    process.exit(1);
  }
}
