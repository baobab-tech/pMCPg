import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CATALOG_URL } from "../../src/catalog/key.ts";
import { CATALOG_NO_KEY, CATALOG_OFF, CatalogService } from "../../src/catalog/service.ts";
import {
  CATALOG_ENABLED,
  CATALOG_SOON,
  type CatalogCliDeps,
  catalogSearch,
  catalogShow,
} from "../../src/cli/commands-catalog.ts";
import { run } from "../../src/cli/main.ts";
import { TEST_CATALOG_PUBLIC_KEY } from "../fixtures/catalog-keys.ts";
import { signedSample } from "../fixtures/catalog-sample.ts";
import { type FakeCatalogServer, startFakeCatalog } from "../fixtures/catalog-server.ts";

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function direct(
  fn: typeof catalogSearch,
  positionals: string[],
  deps: CatalogCliDeps,
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await fn(
    { positionals, values: {} },
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    deps,
  );
  return { code, out: out.join("\n"), err: err.join("\n") };
}

let home: string;
let savedHome: string | undefined;
let host: FakeCatalogServer;

beforeAll(() => {
  savedHome = process.env.PMCPG_HOME;
});
afterAll(() => {
  process.env.PMCPG_HOME = savedHome;
});
beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), "pmcpg-cli-catalog-"));
  process.env.PMCPG_HOME = home;
  const { bytes, sig } = await signedSample();
  host = startFakeCatalog({ bytes, sig, etag: '"s7"' });
});
afterEach(() => host.stop());

const svc = (now?: () => Date) =>
  new CatalogService({
    dir: join(home, "catalog"),
    enabled: () => true,
    url: host.url,
    sigUrl: host.sigUrl,
    keys: [TEST_CATALOG_PUBLIC_KEY],
    keyIsPlaceholder: false,
    snapshot: async () => null,
    now,
  });

describe("catalog search", () => {
  test("is on in this release", () => {
    expect(CATALOG_ENABLED).toBe(true);
  });

  test("matches every word over name, title, description, categories and audience", async () => {
    const r = await direct(catalogSearch, ["social-impact", "grant"], { service: svc() });
    expect(r.code).toBe(0);
    expect(r.out.split("\n")).toHaveLength(1);
    expect(r.out).toContain("io.github.example/grants-search");
    expect(r.out).toContain("community");
    expect(r.out).toContain("header");
    expect(r.out).toContain("Search open grant data.");

    const byCategory = await direct(catalogSearch, ["PROJECT-management"], { service: svc() });
    expect(byCategory.out).toContain("app.linear/linear");
    expect(byCategory.out).toContain("oauth");
    expect(byCategory.out).toContain("Linear: Issues and projects in Linear.");
  });

  test("best tier first", async () => {
    const r = await direct(catalogSearch, ["e"], { service: svc() });
    expect(r.out.split("\n").map((l) => l.split(" ")[0])).toEqual([
      "app.linear/linear",
      "io.github.example/grants-search",
    ]);
  });

  test("fetches without a cache, then uses the cache for 24 hours", async () => {
    let clock = new Date("2026-11-20T00:00:00Z");
    await direct(catalogSearch, ["linear"], { service: svc(() => clock) });
    expect(host.requests).toHaveLength(2);

    clock = new Date("2026-11-20T23:00:00Z");
    await direct(catalogSearch, ["linear"], { service: svc(() => clock) });
    expect(host.requests).toHaveLength(2);

    clock = new Date("2026-11-21T01:00:00Z");
    await direct(catalogSearch, ["linear"], { service: svc(() => clock) });
    expect(host.requests).toHaveLength(3);
    expect(host.requests[2]?.ifNoneMatch).toBe('"s7"');
  });

  test("no match prints a note and exits 0", async () => {
    const r = await direct(catalogSearch, ["nothing-like-this"], { service: svc() });
    expect(r.code).toBe(0);
    expect(r.out).toBe("");
    expect(r.err).toContain("No catalog entries match");
  });

  test("an unreachable catalog with nothing held exits 1 with the reason", async () => {
    host.stop();
    const r = await direct(catalogSearch, ["linear"], { service: svc() });
    expect(r.code).toBe(1);
    expect(r.err).toBe("Could not reach the catalog server.");
  });

  test("the kill switch prints coming soon", async () => {
    const r = await direct(catalogSearch, ["x"], { enabled: false, service: svc() });
    expect(r.code).toBe(2);
    expect(r.err).toBe(CATALOG_SOON);
    expect(host.requests).toEqual([]);
  });
});

describe("catalog show", () => {
  test("prints the entry and the config it would add", async () => {
    const r = await direct(catalogShow, ["io.github.example/grants-search"], { service: svc() });
    expect(r.code).toBe(0);
    expect(r.out).toContain('"identifier": "@example/grants-mcp"');
    expect(r.out).toContain("As config.yaml:");
    expect(r.out).toContain("grants-search:");
    expect(r.out).toContain("@example/grants-mcp@0.4.2");
    expect(r.out).toContain("Needs a value for: GRANTS_API_KEY");
  });

  test("an unknown name suggests near entries", async () => {
    const r = await direct(catalogShow, ["grants-search"], { service: svc() });
    expect(r.code).toBe(1);
    expect(r.err).toContain("Did you mean: io.github.example/grants-search");
  });
});

describe("through the CLI", () => {
  const fetchSpy = spyOn(globalThis, "fetch");
  beforeEach(() => fetchSpy.mockClear());
  afterAll(() => fetchSpy.mockRestore());

  test("the shipped placeholder key makes no request", async () => {
    const r = await cli("catalog", "search", "grants", "funding");
    expect(r.code).toBe(1);
    expect(r.err).toBe(CATALOG_NO_KEY);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("catalog.enabled: false makes no request", async () => {
    writeFileSync(join(home, "config.yaml"), "catalog:\n  enabled: false\n");
    const r = await cli("catalog", "show", "app.linear/linear");
    expect(r.code).toBe(1);
    expect(r.err).toBe(CATALOG_OFF);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("help lists search and show", async () => {
    const r = await cli("catalog", "--help");
    expect(r.out).toContain("catalog search");
    expect(r.out).toContain("catalog show");
    expect(r.out).not.toContain("coming soon");
  });

  test("only src/catalog/key.ts holds a catalog or registry URL", () => {
    const src = join(import.meta.dir, "..", "..", "src");
    const files = readdirSync(src, { recursive: true, encoding: "utf8" }).filter((f) => f.endsWith(".ts"));
    const hits = files.filter((f) =>
      /https?:\/\/[^\s"'`]*(catalog|registry\.modelcontextprotocol)/i.test(
        readFileSync(join(src, f), "utf8"),
      ),
    );
    expect(hits).toEqual([join("catalog", "key.ts")]);
    expect(CATALOG_URL).toBe("https://pmcpg.io/catalog/v1/catalog.json");
  });
});
