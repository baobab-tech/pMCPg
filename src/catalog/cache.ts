// The last verified catalog, in <data dir>/catalog/: the exact bytes, the .sig and meta.json
// (ETag, fetchedAt). Every load verifies signature and schema again; an expired file still loads, marked stale.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CatalogFile } from "./schema.ts";
import { CatalogError, verifyCatalog } from "./verify.ts";

export const CATALOG_FILE = "catalog.json";
export const SIG_FILE = "catalog.json.sig";
export const META_FILE = "meta.json";

const Meta = z.object({ etag: z.string().max(200).optional(), fetchedAt: z.iso.datetime() });
type Meta = z.infer<typeof Meta>;

export interface Verified {
  file: CatalogFile;
  /** `expires` has passed. Still shown until a newer file arrives. */
  stale: boolean;
}

/** Signature and schema must pass; an expired file comes back with `stale`. Undefined when it does not verify. */
export async function verifyStored(
  bytes: Uint8Array<ArrayBuffer>,
  sig: string,
  keys: readonly string[],
  now?: Date,
): Promise<Verified | undefined> {
  try {
    return { file: await verifyCatalog(bytes, sig, { keys, now }), stale: false };
  } catch (err) {
    if (!(err instanceof CatalogError) || err.code !== "expired") return undefined;
  }
  // Signature and schema already passed; only the clock failed. Re-run with a clock before any expiry.
  try {
    return { file: await verifyCatalog(bytes, sig, { keys, now: new Date(0) }), stale: true };
  } catch {
    return undefined;
  }
}

export interface CachedCatalog extends Verified {
  etag?: string;
  fetchedAt: string;
}

export class CatalogCache {
  constructor(readonly dir: string) {}

  /** The cached file when it verifies; undefined when missing, damaged or signed by an unknown key. */
  async load(keys: readonly string[], now?: Date): Promise<CachedCatalog | undefined> {
    const meta = this.meta();
    if (!meta) return undefined;
    let bytes: Uint8Array<ArrayBuffer>;
    let sig: string;
    try {
      bytes = new Uint8Array(readFileSync(join(this.dir, CATALOG_FILE)));
      sig = readFileSync(join(this.dir, SIG_FILE), "utf8");
    } catch {
      return undefined;
    }
    const v = await verifyStored(bytes, sig, keys, now);
    return v && { ...v, etag: meta.etag, fetchedAt: meta.fetchedAt };
  }

  /** fetchedAt of the cache, without verifying. Undefined when there is none. */
  fetchedAt(): string | undefined {
    return this.meta()?.fetchedAt;
  }

  /** Store a file fetchCatalog already verified. */
  save(bytes: Uint8Array<ArrayBuffer>, sig: string, etag: string | undefined, fetchedAt: string): void {
    mkdirSync(this.dir, { recursive: true });
    this.write(CATALOG_FILE, bytes);
    this.write(SIG_FILE, sig);
    this.writeMeta({ etag, fetchedAt });
  }

  /** The server answered 304: the cache is current as of `fetchedAt`. */
  touch(fetchedAt: string): void {
    const meta = this.meta();
    if (meta) this.writeMeta({ ...meta, fetchedAt });
  }

  private meta(): Meta | undefined {
    const file = join(this.dir, META_FILE);
    if (!existsSync(file)) return undefined;
    try {
      const parsed = Meta.safeParse(JSON.parse(readFileSync(file, "utf8")));
      return parsed.success ? parsed.data : undefined;
    } catch {
      return undefined;
    }
  }

  private writeMeta(meta: Meta): void {
    this.write(META_FILE, `${JSON.stringify(meta)}\n`);
  }

  /** Write to a temp name, then rename, so a reader never sees half a file. */
  private write(name: string, data: string | Uint8Array): void {
    const tmp = join(this.dir, `.${name}.${process.pid}.tmp`);
    writeFileSync(tmp, data);
    renameSync(tmp, join(this.dir, name));
  }
}
