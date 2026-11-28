// Website prebuild: the committed catalog.json must match the sources (serial, generatedAt and expires
// aside), and catalog.json.sig must verify against CATALOG_PUBLIC_KEYS. While the key is a placeholder,
// signature and expiry problems only warn.
// Usage: bun scripts/check-catalog.ts
import { existsSync, readFileSync } from "node:fs";
import { CATALOG_KEY_IS_PLACEHOLDER, CATALOG_PUBLIC_KEYS } from "../../src/catalog/key.ts";
import { CatalogFile } from "../../src/catalog/schema.ts";
import { verifySignature } from "../../src/catalog/verify.ts";
import { buildCatalog, OUTPUT_FILE, readSources, SourceError, serialize } from "./catalog-lib.ts";

export interface CheckOptions {
  sourcesDir?: string;
  out?: string;
  keys?: readonly string[];
  placeholder?: boolean;
  now?: Date;
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

const REBUILD = "Run: bun scripts/build-catalog.ts";

export async function checkCatalog(opts: CheckOptions = {}): Promise<CheckResult> {
  const out = opts.out ?? OUTPUT_FILE;
  const keys = opts.keys ?? CATALOG_PUBLIC_KEYS;
  const placeholder = opts.placeholder ?? CATALOG_KEY_IS_PLACEHOLDER;
  const errors: string[] = [];
  const warnings: string[] = [];
  // Signature and freshness: errors once a real key ships, warnings before.
  const keyProblem = (m: string) => (placeholder ? warnings : errors).push(m);

  if (!existsSync(out)) return { errors: [`catalog.json is missing. ${REBUILD}`], warnings };
  const bytes = new Uint8Array(readFileSync(out));
  const text = new TextDecoder().decode(bytes);

  let committed: CatalogFile;
  try {
    committed = CatalogFile.parse(JSON.parse(text));
  } catch {
    return { errors: [`catalog.json does not match the catalog schema. ${REBUILD}`], warnings };
  }

  try {
    const expected = serialize(
      buildCatalog(readSources(opts.sourcesDir), {
        serial: committed.serial,
        generatedAt: committed.generatedAt,
        expires: committed.expires,
      }),
    );
    if (expected !== text) errors.push(`catalog.json does not match catalog/ sources. ${REBUILD}`);
  } catch (e) {
    errors.push(e instanceof SourceError ? e.message : String(e));
  }

  const sigFile = `${out}.sig`;
  if (!existsSync(sigFile)) {
    keyProblem("catalog.json.sig is missing. Sign with: bun ../scripts/catalog-sign.ts public/catalog/v1/catalog.json");
  } else if (!(await verifySignature(bytes, readFileSync(sigFile, "utf8"), keys))) {
    keyProblem("catalog.json.sig does not verify against CATALOG_PUBLIC_KEYS. Sign the current catalog.json again.");
  }

  if (Date.parse(committed.expires) <= (opts.now ?? new Date()).getTime())
    keyProblem(`catalog.json expired on ${committed.expires}. ${REBUILD} --force, then sign it.`);

  return { errors, warnings };
}

if (import.meta.main) {
  const { errors, warnings } = await checkCatalog();
  for (const w of warnings) console.warn(`catalog: warning: ${w}`);
  for (const e of errors) console.error(`catalog: error: ${e}`);
  if (errors.length) process.exit(1);
  console.log(`catalog: ok${CATALOG_KEY_IS_PLACEHOLDER ? " (signing key is a placeholder)" : ""}`);
}
