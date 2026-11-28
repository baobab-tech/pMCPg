import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { curation } from "../../src/catalog/schema.ts";
import { verifyCatalog } from "../../src/catalog/verify.ts";
import { build } from "../../website/scripts/build-catalog.ts";
import { draftEntry, registryUrl } from "../../website/scripts/catalog-import.ts";
import {
  buildCatalog,
  freshMeta,
  readSources,
  SOURCES_DIR,
  SourceError,
} from "../../website/scripts/catalog-lib.ts";
import { checkCatalog } from "../../website/scripts/check-catalog.ts";
import { signWithTestKey, TEST_CATALOG_PUBLIC_KEY } from "../fixtures/catalog-keys.ts";

const tmp = () => mkdtempSync(join(tmpdir(), "pmcpg-website-"));

/** A copy of the real sources plus an output path, so tests can change both. */
function workspace() {
  const dir = tmp();
  cpSync(SOURCES_DIR, join(dir, "catalog"), { recursive: true });
  return { sourcesDir: join(dir, "catalog"), out: join(dir, "out", "catalog.json") };
}

describe("catalog sources", () => {
  const sources = readSources();

  test("every source validates and the presets resolve", () => {
    expect(sources.servers.length).toBeGreaterThan(20);
    expect(sources.presets.map((p) => p.id).sort()).toEqual([
      "communications",
      "fundraising-donors",
      "grants-research",
      "me-reporting",
      "program-data",
    ]);
    expect(() => buildCatalog(sources, freshMeta(1))).not.toThrow();
  });

  test("every entry cites a source and DevExplorer is baobab-built", () => {
    for (const e of sources.servers) expect(curation(e).source).toStartWith("https://");
    const dev = sources.servers.find((e) => e.name === "ai.devexplorer/devexplorer");
    expect(dev && curation(dev).tier).toBe("baobab-built");
  });

  test("the committed catalog.json matches the sources", async () => {
    const { errors } = await checkCatalog({ placeholder: true });
    expect(errors).toEqual([]);
  });

  test("no source names Cursor", () => {
    expect(JSON.stringify(sources)).not.toMatch(/cursor/i);
  });
});

describe("build-catalog", () => {
  test("bumps serial, sets a 90-day expiry, and skips an unchanged rebuild", () => {
    const ws = workspace();
    const now = new Date("2026-11-27T12:00:00.500Z");
    const first = build({ ...ws, now });
    expect(first).toMatchObject({ changed: true, serial: 1 });
    const file = JSON.parse(readFileSync(ws.out, "utf8"));
    expect(file.generatedAt).toBe("2026-11-27T12:00:00.000Z");
    expect(file.expires).toBe("2027-02-25T12:00:00.000Z");

    expect(build({ ...ws, now })).toMatchObject({ changed: false, serial: 1 });

    writeFileSync(`${ws.out}.sig`, "stale\n");
    expect(build({ ...ws, now, force: true })).toMatchObject({ changed: true, serial: 2 });
    expect(existsSync(`${ws.out}.sig`)).toBe(false);
  });

  test("refuses a draft that still has TODO values", () => {
    const ws = workspace();
    const { entry } = draftEntry({
      server: {
        name: "io.github.x/y",
        description: "d",
        version: "1.0.0",
        remotes: [{ type: "streamable-http", url: "https://x.example/mcp" }],
      },
    });
    writeFileSync(join(ws.sourcesDir, "servers", "y.json"), JSON.stringify(entry));
    expect(() => build(ws)).toThrow(SourceError);
    try {
      build(ws);
    } catch (e) {
      expect((e as SourceError).problems.join()).toContain("servers/y.json: still has TODO");
    }
  });

  test("refuses a preset naming an unknown server", () => {
    const ws = workspace();
    const p = join(ws.sourcesDir, "presets", "program-data.json");
    const preset = JSON.parse(readFileSync(p, "utf8"));
    preset.servers.push("io.github.nobody/missing");
    writeFileSync(p, JSON.stringify(preset));
    expect(() => build(ws)).toThrow(/unknown server/);
  });
});

describe("check-catalog", () => {
  test("a source change without a rebuild is an error", async () => {
    const ws = workspace();
    build(ws);
    const p = join(ws.sourcesDir, "servers", "linear.json");
    writeFileSync(p, readFileSync(p, "utf8").replace("Finds, creates", "Finds and creates"));
    const { errors } = await checkCatalog({ ...ws, placeholder: true });
    expect(errors.join()).toContain("does not match catalog/ sources");
  });

  test("a missing signature warns while the key is a placeholder, and fails once it is not", async () => {
    const ws = workspace();
    build(ws);
    const before = await checkCatalog({ ...ws, placeholder: true });
    expect(before.errors).toEqual([]);
    expect(before.warnings.join()).toContain("sig is missing");
    const after = await checkCatalog({ ...ws, placeholder: false, keys: [TEST_CATALOG_PUBLIC_KEY] });
    expect(after.errors.join()).toContain("sig is missing");
  });

  test("a valid signature passes and the gateway's verifier accepts the file", async () => {
    const ws = workspace();
    build(ws);
    const bytes = new Uint8Array(readFileSync(ws.out));
    const sig = await signWithTestKey(bytes);
    writeFileSync(`${ws.out}.sig`, sig);
    const r = await checkCatalog({ ...ws, placeholder: false, keys: [TEST_CATALOG_PUBLIC_KEY] });
    expect(r).toEqual({ errors: [], warnings: [] });
    const file = await verifyCatalog(bytes, sig, { keys: [TEST_CATALOG_PUBLIC_KEY] });
    expect(file.servers.length).toBeGreaterThan(20);
  });

  test("a signature by another key fails once the key is real", async () => {
    const ws = workspace();
    build(ws);
    writeFileSync(`${ws.out}.sig`, await signWithTestKey(new TextEncoder().encode("other")));
    const r = await checkCatalog({ ...ws, placeholder: false, keys: [TEST_CATALOG_PUBLIC_KEY] });
    expect(r.errors.join()).toContain("does not verify");
  });

  test("an expired catalog fails once the key is real", async () => {
    const ws = workspace();
    build({ ...ws, now: new Date("2020-01-01T00:00:00Z") });
    writeFileSync(`${ws.out}.sig`, await signWithTestKey(new Uint8Array(readFileSync(ws.out))));
    const r = await checkCatalog({ ...ws, placeholder: false, keys: [TEST_CATALOG_PUBLIC_KEY] });
    expect(r.errors.join()).toContain("expired");
  });
});

describe("catalog-import", () => {
  test("encodes the registry name in the URL", () => {
    expect(registryUrl("io.github.acme/weather")).toBe(
      "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.acme%2Fweather/versions/latest",
    );
  });

  test("maps a registry server to a draft with secrets as credential names", () => {
    const { entry, notes } = draftEntry(
      {
        server: {
          name: "io.github.acme/weather",
          description: "Weather.",
          version: "1.2.0",
          $schema: "ignored",
          packages: [
            {
              registryType: "npm",
              identifier: "@acme/weather",
              version: "1.2.0",
              transport: { type: "stdio" },
              packageArguments: [
                { type: "named", name: "--units", value: "metric" },
                { type: "positional", valueHint: "city" },
              ],
              environmentVariables: [{ name: "WEATHER_KEY", isSecret: true, isRequired: true }],
            },
            {
              registryType: "npm",
              identifier: "@acme/weather-http",
              version: "1.2.0",
              transport: { type: "streamable-http" },
            },
          ],
        },
        _meta: {},
      },
      "2026-11-27",
    );
    expect(entry.$schema).toBeUndefined();
    const pkgs = entry.packages as { identifier: string; packageArguments: unknown[] }[];
    expect(pkgs.map((p) => p.identifier)).toEqual(["@acme/weather"]);
    expect(pkgs[0]?.packageArguments).toEqual([{ type: "named", name: "--units", value: "metric" }]);
    const c = (entry._meta as Record<string, { auth: unknown; reviewedBy: string }>)["io.pmcpg/curation"];
    expect(c?.auth).toEqual({ type: "header", credentials: ["WEATHER_KEY"] });
    expect(c?.reviewedBy).toStartWith("TODO");
    expect(notes.join()).toContain("Skipped package @acme/weather-http");
    expect(notes.join()).toContain("Dropped package argument");
  });
});
