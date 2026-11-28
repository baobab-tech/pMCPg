// Fetch the catalog and its signature, then verify. One GET each, only when the user browses
// (docs/catalog.md, "Fetching"). Nothing from either body reaches a log, an event or an error message.
import { type FetchLike, GuardedFetchError, guardedFetch } from "../connectors/guarded-fetch.ts";
import { CATALOG_PUBLIC_KEYS, CATALOG_SIG_URL, CATALOG_URL } from "./key.ts";
import type { CatalogFile } from "./schema.ts";
import { CATALOG_MAX_BYTES, CatalogError, type CatalogErrorCode, verifyCatalog } from "./verify.ts";

export const CATALOG_TIMEOUT_MS = 10_000;
/** A .sig file is about 90 bytes. */
const SIG_MAX_BYTES = 1024;

export interface FetchCatalogOptions {
  url?: string;
  sigUrl?: string;
  keys?: readonly string[];
  /** Highest serial accepted before. A lower one is refused as a rollback. */
  lastSerial?: number;
  /** ETag of the cached file. A 304 answer means the cache is current. */
  etag?: string;
  /** Underlying fetch (tests). The guard wraps it. */
  fetch?: FetchLike;
  timeoutMs?: number;
  now?: Date;
}

export type FetchErrorCode = CatalogErrorCode | "network" | "http" | "refused";

export type FetchCatalogResult =
  | { status: "ok"; file: CatalogFile; bytes: Uint8Array<ArrayBuffer>; sig: string; etag?: string }
  | { status: "not-modified" }
  | { status: "error"; code: FetchErrorCode; message: string };

/** The guard follows redirects to any https host; the catalog may only redirect within its own host. */
function sameHostOnly(base: FetchLike, host: string): FetchLike {
  return (input, init) => {
    if (new URL(String(input)).host !== host)
      throw new GuardedFetchError("The catalog server redirected to another host.");
    return base(input, init);
  };
}

function failure(err: unknown, timeoutMs: number): FetchCatalogResult {
  if (err instanceof CatalogError) return { status: "error", code: err.code, message: err.message };
  if (err instanceof GuardedFetchError) {
    return /larger than/.test(err.message)
      ? {
          status: "error",
          code: "too-large",
          message: `The catalog is larger than ${CATALOG_MAX_BYTES} bytes.`,
        }
      : { status: "error", code: "refused", message: err.message };
  }
  if (err instanceof DOMException && (err.name === "TimeoutError" || err.name === "AbortError"))
    return {
      status: "error",
      code: "network",
      message: `The catalog server did not answer within ${timeoutMs / 1000} s.`,
    };
  return { status: "error", code: "network", message: "Could not reach the catalog server." };
}

export async function fetchCatalog(opts: FetchCatalogOptions = {}): Promise<FetchCatalogResult> {
  const url = opts.url ?? CATALOG_URL;
  const sigUrl = opts.sigUrl ?? CATALOG_SIG_URL;
  const timeoutMs = opts.timeoutMs ?? CATALOG_TIMEOUT_MS;
  try {
    const host = new URL(url).host;
    const base = sameHostOnly(opts.fetch ?? fetch, host);
    const get = (maxBytes: number) => guardedFetch({ fetch: base, timeoutMs, maxBytes, maxRedirects: 3 });

    const headers: Record<string, string> = { accept: "application/json" };
    if (opts.etag) headers["if-none-match"] = opts.etag;
    const res = await get(CATALOG_MAX_BYTES)(url, { headers });
    if (res.status === 304 && opts.etag) {
      void res.body?.cancel().catch(() => {});
      return { status: "not-modified" };
    }
    if (res.status !== 200) {
      void res.body?.cancel().catch(() => {});
      return { status: "error", code: "http", message: `The catalog server answered ${res.status}.` };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const etag = res.headers.get("etag") ?? undefined;

    if (new URL(sigUrl).host !== host)
      return {
        status: "error",
        code: "refused",
        message: "The signature must come from the catalog's host.",
      };
    const sigRes = await get(SIG_MAX_BYTES)(sigUrl, { headers: { "cache-control": "no-cache" } });
    if (sigRes.status !== 200) {
      void sigRes.body?.cancel().catch(() => {});
      return {
        status: "error",
        code: "http",
        message: `The catalog server answered ${sigRes.status} for the signature.`,
      };
    }
    const sig = await sigRes.text();

    const file = await verifyCatalog(bytes, sig, {
      keys: opts.keys ?? CATALOG_PUBLIC_KEYS,
      lastSerial: opts.lastSerial,
      now: opts.now,
    });
    return { status: "ok", file, bytes, sig, etag };
  } catch (err) {
    return failure(err, timeoutMs);
  }
}
