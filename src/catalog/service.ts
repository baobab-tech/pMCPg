// What GatewayHandle.catalog() and refreshCatalog() return. view() reads cache and bundled snapshot and
// never fetches; refresh() fetches once, keeps the result only when it verifies, and falls back otherwise.
import type { FetchLike } from "../connectors/guarded-fetch.ts";
import { CatalogCache, type Verified } from "./cache.ts";
import { fetchCatalog } from "./fetch.ts";
import { CATALOG_KEY_IS_PLACEHOLDER, CATALOG_PUBLIC_KEYS, CATALOG_SIG_URL, CATALOG_URL } from "./key.ts";
import type { CatalogView } from "./schema.ts";
import { embeddedSnapshot, loadSnapshot, type SnapshotBytes } from "./snapshot.ts";
import { emptyCatalogView } from "./view.ts";

export const CATALOG_OFF =
  "The catalog is turned off (catalog.enabled: false in config.yaml). pMCPg does not contact it.";
export const CATALOG_NO_KEY =
  "This build has no catalog signing key yet, so no catalog can be verified. Nothing was fetched.";

export interface CatalogServiceOptions {
  /** <data dir>/catalog */
  dir: string;
  /** Read on every call, so a config reload applies at once. */
  enabled: () => boolean;
  url?: string;
  sigUrl?: string;
  keys?: readonly string[];
  /** True skips every fetch. Default: the shipped key is still the placeholder. */
  keyIsPlaceholder?: boolean;
  fetch?: FetchLike;
  timeoutMs?: number;
  /** Bundled snapshot. Default: the module scripts/embed-catalog.ts generates. */
  snapshot?: () => Promise<SnapshotBytes | null>;
  now?: () => Date;
}

type Held = Verified & { source: "cache" | "snapshot"; fetchedAt: string | null };

function toView(h: Held | undefined, source?: CatalogView["source"], error?: string): CatalogView {
  if (!h) return { ...emptyCatalogView(), ...(error ? { error } : {}) };
  const stale = h.stale
    ? `This catalog expired on ${h.file.expires}. It stays shown until a newer one is fetched.`
    : undefined;
  const why = [error, stale].filter(Boolean).join(" ");
  return {
    entries: h.file.servers,
    presets: h.file.presets,
    serial: h.file.serial,
    fetchedAt: h.fetchedAt,
    source: source ?? h.source,
    ...(why ? { error: why } : {}),
  };
}

export class CatalogService {
  readonly cache: CatalogCache;
  private readonly keys: readonly string[];
  private snapshotLoaded?: Promise<Verified | undefined>;
  private inflight?: Promise<CatalogView>;

  constructor(private readonly opts: CatalogServiceOptions) {
    this.cache = new CatalogCache(opts.dir);
    this.keys = opts.keys ?? CATALOG_PUBLIC_KEYS;
  }

  private now(): Date {
    return this.opts.now?.() ?? new Date();
  }

  private placeholder(): boolean {
    return this.opts.keyIsPlaceholder ?? (CATALOG_KEY_IS_PLACEHOLDER && this.keys === CATALOG_PUBLIC_KEYS);
  }

  private snapshot(): Promise<Verified | undefined> {
    this.snapshotLoaded ??= loadSnapshot(this.opts.snapshot ?? embeddedSnapshot, this.keys, this.now());
    return this.snapshotLoaded;
  }

  /** Cache and snapshot, both verified. The higher serial wins; the cache wins a tie. */
  private async held(): Promise<{ best?: Held; lastSerial?: number; etag?: string }> {
    const [cache, snap] = await Promise.all([this.cache.load(this.keys, this.now()), this.snapshot()]);
    const fromCache: Held | undefined = cache && { ...cache, source: "cache" };
    const fromSnap: Held | undefined = snap && {
      ...snap,
      source: "snapshot",
      fetchedAt: snap.file.generatedAt,
    };
    const best =
      fromCache && fromSnap
        ? fromSnap.file.serial > fromCache.file.serial
          ? fromSnap
          : fromCache
        : (fromCache ?? fromSnap);
    const serials = [cache?.file.serial, snap?.file.serial].filter((s) => s !== undefined);
    return {
      best,
      lastSerial: serials.length ? Math.max(...serials) : undefined,
      etag: cache?.etag,
    };
  }

  /** The catalog on disk or in the binary. Never fetches. */
  async view(): Promise<CatalogView> {
    if (!this.opts.enabled()) return toView(undefined, undefined, CATALOG_OFF);
    return toView((await this.held()).best);
  }

  /** Fetch now. On any failure: the held view with `error`. Concurrent calls share one fetch. */
  refresh(): Promise<CatalogView> {
    this.inflight ??= this.doRefresh().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  /** Milliseconds since the cache was last fetched or confirmed; undefined without a cache. */
  cacheAgeMs(): number | undefined {
    const at = this.cache.fetchedAt();
    return at ? this.now().getTime() - Date.parse(at) : undefined;
  }

  private async doRefresh(): Promise<CatalogView> {
    if (!this.opts.enabled()) return toView(undefined, undefined, CATALOG_OFF);
    const { best, lastSerial, etag } = await this.held();
    if (this.placeholder()) return toView(best, undefined, CATALOG_NO_KEY);

    const r = await fetchCatalog({
      url: this.opts.url ?? CATALOG_URL,
      sigUrl: this.opts.sigUrl ?? CATALOG_SIG_URL,
      keys: this.keys,
      lastSerial,
      etag,
      fetch: this.opts.fetch,
      timeoutMs: this.opts.timeoutMs,
      now: this.now(),
    });
    const at = this.now().toISOString();
    if (r.status === "error")
      return toView(best, undefined, best ? `${r.message} Showing the last good catalog.` : r.message);
    if (r.status === "not-modified") {
      this.cache.touch(at);
      return toView((await this.held()).best);
    }
    this.cache.save(r.bytes, r.sig, r.etag, at);
    return toView({ file: r.file, stale: false, source: "cache", fetchedAt: at }, "network");
  }
}
