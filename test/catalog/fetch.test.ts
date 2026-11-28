// Fetch, cache and snapshot against a fake catalog host on 127.0.0.1, signed with the test key.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_FILE, CatalogCache, META_FILE, SIG_FILE } from "../../src/catalog/cache.ts";
import { fetchCatalog } from "../../src/catalog/fetch.ts";
import {
  CATALOG_NO_KEY,
  CATALOG_OFF,
  CatalogService,
  type CatalogServiceOptions,
} from "../../src/catalog/service.ts";
import type { SnapshotBytes } from "../../src/catalog/snapshot.ts";
import { CATALOG_MAX_BYTES } from "../../src/catalog/verify.ts";
import { TEST_CATALOG_PUBLIC_KEY } from "../fixtures/catalog-keys.ts";
import { signedSample } from "../fixtures/catalog-sample.ts";
import { type FakeCatalogServer, startFakeCatalog } from "../fixtures/catalog-server.ts";

const KEYS = [TEST_CATALOG_PUBLIC_KEY];
let dir: string;
let host: FakeCatalogServer;

async function serial(n: number, etag = `"s${n}"`) {
  const { bytes, sig } = await signedSample({ serial: n });
  return { bytes, sig, etag };
}

function service(over: Partial<CatalogServiceOptions> = {}): CatalogService {
  return new CatalogService({
    dir,
    enabled: () => true,
    url: host.url,
    sigUrl: host.sigUrl,
    keys: KEYS,
    keyIsPlaceholder: false,
    snapshot: async () => null,
    ...over,
  });
}

const snapshotOf = async (n: number): Promise<SnapshotBytes> => {
  const s = await signedSample({ serial: n });
  return { bytes: s.bytes, sig: s.sig };
};

beforeEach(async () => {
  dir = join(mkdtempSync(join(tmpdir(), "pmcpg-catalog-")), "catalog");
  host = startFakeCatalog(await serial(7));
});
afterEach(() => host.stop());

describe("refresh", () => {
  test("a good fetch is verified, cached and returned from the network", async () => {
    const svc = service();
    const v = await svc.refresh();
    expect(v.source).toBe("network");
    expect(v.serial).toBe(7);
    expect(v.entries.map((e) => e.name)).toEqual(["app.linear/linear", "io.github.example/grants-search"]);
    expect(v.presets).toHaveLength(1);
    expect(v.error).toBeUndefined();
    expect(v.fetchedAt).not.toBeNull();
    expect(readFileSync(join(dir, CATALOG_FILE))).toEqual(Buffer.from(host.state.bytes));
    expect(JSON.parse(readFileSync(join(dir, META_FILE), "utf8")).etag).toBe('"s7"');

    const again = await svc.view();
    expect(again.source).toBe("cache");
    expect(again.serial).toBe(7);
    expect(host.requests.map((r) => r.path)).toEqual(["/catalog.json", "/catalog.json.sig"]);
  });

  test("304 keeps the cache, updates fetchedAt and skips the signature", async () => {
    let clock = new Date("2026-11-20T00:00:00Z");
    const svc = service({ now: () => clock });
    await svc.refresh();
    clock = new Date("2026-11-21T00:00:00Z");
    host.requests.length = 0;
    const v = await svc.refresh();
    expect(host.requests).toEqual([{ path: "/catalog.json", ifNoneMatch: '"s7"' }]);
    expect(v.source).toBe("cache");
    expect(v.serial).toBe(7);
    expect(v.error).toBeUndefined();
    expect(v.fetchedAt).toBe("2026-11-21T00:00:00.000Z");
    expect(svc.cacheAgeMs()).toBe(0);
  });

  test("a bad signature is refused and nothing is cached", async () => {
    const other = await serial(8);
    host.state = { ...host.state, sig: other.sig };
    const v = await service().refresh();
    expect(v.serial).toBe(0);
    expect(v.entries).toEqual([]);
    expect(v.error).toContain("signature");
    expect(existsSync(join(dir, CATALOG_FILE))).toBe(false);
  });

  test("an unknown key is refused like a bad signature", async () => {
    const r = await fetchCatalog({
      url: host.url,
      sigUrl: host.sigUrl,
      keys: ["8AcqYznsSJFfIdprDQiXXagQ1Qb+KA5mkr/at67hwRk="],
    });
    expect(r).toMatchObject({ status: "error", code: "bad-signature" });
  });

  test("a lower serial than the cache is a rollback; the cache stays", async () => {
    const svc = service();
    await svc.refresh();
    host.state = await serial(5);
    const v = await svc.refresh();
    expect(v.serial).toBe(7);
    expect(v.source).toBe("cache");
    expect(v.error).toContain("serial 5");
    expect(v.error).toContain("Showing the last good catalog.");
  });

  test("the snapshot's serial also counts for rollback", async () => {
    host.state = await serial(5);
    const v = await service({ snapshot: () => snapshotOf(6) }).refresh();
    expect(v.source).toBe("snapshot");
    expect(v.serial).toBe(6);
    expect(v.error).toContain("older");
  });

  test("an oversize body is refused", async () => {
    host.state = { ...host.state, bytes: new Uint8Array(CATALOG_MAX_BYTES + 1) };
    const r = await fetchCatalog({ url: host.url, sigUrl: host.sigUrl, keys: KEYS });
    expect(r).toMatchObject({ status: "error", code: "too-large" });
    expect(host.requests.map((q) => q.path)).toEqual(["/catalog.json"]);
  });

  test("an HTTP error says the status, never the body", async () => {
    host.state = { ...host.state, status: 503 };
    const r = await fetchCatalog({ url: host.url, sigUrl: host.sigUrl, keys: KEYS });
    expect(r).toEqual({ status: "error", code: "http", message: "The catalog server answered 503." });
  });

  test("a redirect to another host is refused", async () => {
    const port = new URL(host.url).port;
    host.state = { ...host.state, redirect: `http://localhost:${port}/catalog.json` };
    const r = await fetchCatalog({ url: host.url, sigUrl: host.sigUrl, keys: KEYS });
    expect(r).toMatchObject({ status: "error", code: "refused" });
    expect(host.requests).toHaveLength(1);
  });

  test("plain http to a non-loopback host is refused before any request", async () => {
    const r = await fetchCatalog({ url: "http://example.com/catalog.json", keys: KEYS });
    expect(r).toMatchObject({ status: "error", code: "refused" });
  });

  test("offline: falls back to the cache, then the snapshot, then empty", async () => {
    const svc = service();
    await svc.refresh();
    host.stop();

    const fromCache = await svc.refresh();
    expect(fromCache.source).toBe("cache");
    expect(fromCache.serial).toBe(7);
    expect(fromCache.error).toBe("Could not reach the catalog server. Showing the last good catalog.");

    const fresh = join(mkdtempSync(join(tmpdir(), "pmcpg-catalog-")), "catalog");
    const fromSnap = await service({ dir: fresh, snapshot: () => snapshotOf(3) }).refresh();
    expect(fromSnap.source).toBe("snapshot");
    expect(fromSnap.serial).toBe(3);
    expect(fromSnap.error).toContain("Could not reach");

    const none = await service({ dir: fresh }).refresh();
    expect(none.serial).toBe(0);
    expect(none.error).toBe("Could not reach the catalog server.");
  });

  test("a slow server times out", async () => {
    const slow = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Promise<Response>((r) => setTimeout(() => r(new Response("{}")), 2000)),
    });
    try {
      const r = await fetchCatalog({
        url: `http://127.0.0.1:${slow.port}/catalog.json`,
        sigUrl: `http://127.0.0.1:${slow.port}/catalog.json.sig`,
        keys: KEYS,
        timeoutMs: 100,
      });
      expect(r).toMatchObject({ status: "error", code: "network" });
      if (r.status === "error") expect(r.message).toContain("did not answer within 0.1 s");
    } finally {
      slow.stop(true);
    }
  });

  test("concurrent refreshes share one fetch", async () => {
    const svc = service();
    const [a, b] = await Promise.all([svc.refresh(), svc.refresh()]);
    expect(a).toBe(b);
    expect(host.requests).toHaveLength(2);
  });
});

describe("gates", () => {
  test("enabled: false makes no request and explains why", async () => {
    const svc = service({ enabled: () => false, snapshot: () => snapshotOf(3) });
    for (const v of [await svc.view(), await svc.refresh()]) {
      expect(v.serial).toBe(0);
      expect(v.entries).toEqual([]);
      expect(v.error).toBe(CATALOG_OFF);
    }
    expect(host.requests).toEqual([]);
  });

  test("the placeholder key makes no request", async () => {
    const v = await service({ keyIsPlaceholder: true, snapshot: () => snapshotOf(3) }).refresh();
    expect(v.serial).toBe(3);
    expect(v.error).toBe(CATALOG_NO_KEY);
    expect(host.requests).toEqual([]);
  });

  test("view() never fetches", async () => {
    const v = await service().view();
    expect(v.serial).toBe(0);
    expect(v.error).toBeUndefined();
    expect(host.requests).toEqual([]);
  });
});

describe("cache and snapshot", () => {
  test("the higher serial wins; the cache wins a tie", async () => {
    await service().refresh();
    expect((await service({ snapshot: () => snapshotOf(9) }).view()).source).toBe("snapshot");
    expect((await service({ snapshot: () => snapshotOf(3) }).view()).source).toBe("cache");
    expect((await service({ snapshot: () => snapshotOf(7) }).view()).source).toBe("cache");
  });

  test("a snapshot's fetchedAt is its generatedAt", async () => {
    const v = await service({ snapshot: () => snapshotOf(3) }).view();
    expect(v.fetchedAt).toBe("2026-11-01T00:00:00Z");
  });

  test("an expired cache is still shown, marked in error", async () => {
    await service().refresh();
    const v = await service({ now: () => new Date("2027-02-01T00:00:00Z") }).view();
    expect(v.serial).toBe(7);
    expect(v.entries).toHaveLength(2);
    expect(v.error).toContain("expired on 2027-01-01T00:00:00Z");
  });

  test("a tampered cache is ignored", async () => {
    await service().refresh();
    const file = join(dir, CATALOG_FILE);
    writeFileSync(file, readFileSync(file, "utf8").replace("Linear", "Lineat"));
    const v = await service({ snapshot: () => snapshotOf(3) }).view();
    expect(v.source).toBe("snapshot");
    expect(v.serial).toBe(3);
  });

  test("a cache signed by an untrusted key is ignored", async () => {
    await service().refresh();
    expect(
      await new CatalogCache(dir).load(["8AcqYznsSJFfIdprDQiXXagQ1Qb+KA5mkr/at67hwRk="]),
    ).toBeUndefined();
    expect(existsSync(join(dir, SIG_FILE))).toBe(true);
  });

  test("a damaged meta.json counts as no cache", async () => {
    await service().refresh();
    writeFileSync(join(dir, META_FILE), "{not json");
    const svc = service();
    expect(svc.cacheAgeMs()).toBeUndefined();
    expect((await svc.view()).serial).toBe(0);
  });
});
