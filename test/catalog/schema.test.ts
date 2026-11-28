import { describe, expect, test } from "bun:test";
import { CatalogFile, Entry, PackageDef, RemoteDef } from "../../src/catalog/schema.ts";
import { sampleCatalog } from "../fixtures/catalog-sample.ts";

const npm = (over: Record<string, unknown> = {}) => ({
  registryType: "npm",
  identifier: "@example/server",
  version: "1.2.3",
  ...over,
});

describe("catalog schema", () => {
  test("parses the sample", () => {
    const c = CatalogFile.parse(sampleCatalog());
    expect(c.servers).toHaveLength(2);
    expect(c.presets[0]?.approvals).toBe("balanced");
  });

  test("rejects latest and version ranges", () => {
    for (const version of ["latest", "^1.2.3", "~1.2", "1.x", ">=1.0.0", "1.2"])
      expect(PackageDef.safeParse(npm({ version })).success).toBe(false);
    expect(PackageDef.safeParse(npm({ version: "1.2.3-beta.1" })).success).toBe(true);
  });

  test("mcpb needs a sha256 and an https download", () => {
    const mcpb = { registryType: "mcpb", identifier: "https://example.com/s.mcpb", version: "1.0.0" };
    expect(PackageDef.safeParse(mcpb).success).toBe(false);
    expect(PackageDef.safeParse({ ...mcpb, fileSha256: "b".repeat(64) }).success).toBe(true);
    expect(
      PackageDef.safeParse({ ...mcpb, identifier: "http://example.com/s.mcpb", fileSha256: "b".repeat(64) })
        .success,
    ).toBe(false);
  });

  test("rejects http and credentialed remote URLs", () => {
    expect(RemoteDef.safeParse({ type: "streamable-http", url: "http://mcp.example.com" }).success).toBe(
      false,
    );
    expect(RemoteDef.safeParse({ type: "sse", url: "https://u:p@mcp.example.com" }).success).toBe(false);
    expect(RemoteDef.safeParse({ type: "sse", url: "https://mcp.example.com/sse" }).success).toBe(true);
  });

  test("rejects secret values in headers and env", () => {
    const header = { name: "Authorization", isSecret: true, value: "Bearer sk-123" };
    expect(RemoteDef.safeParse({ type: "sse", url: "https://x.example", headers: [header] }).success).toBe(
      false,
    );
    const secretDefault = { name: "API_KEY", isSecret: true, default: "sk-123" };
    expect(PackageDef.safeParse(npm({ environmentVariables: [secretDefault] })).success).toBe(false);
    const envValue = { name: "API_KEY", value: "sk-123" };
    expect(PackageDef.safeParse(npm({ environmentVariables: [envValue] })).success).toBe(false);
  });

  test("entry needs a package or remote and a curation block", () => {
    const [first] = sampleCatalog().servers as Record<string, unknown>[];
    expect(Entry.safeParse({ ...first, remotes: [] }).success).toBe(false);
    expect(Entry.safeParse({ ...first, _meta: {} }).success).toBe(false);
  });

  test("oauth registration only with oauth", () => {
    const [first] = sampleCatalog().servers as { _meta: Record<string, Record<string, unknown>> }[];
    const cur = first?._meta["io.pmcpg/curation"] ?? {};
    const bad = {
      ...first,
      _meta: { "io.pmcpg/curation": { ...cur, auth: { type: "none", registration: "dcr" } } },
    };
    expect(Entry.safeParse(bad).success).toBe(false);
  });

  test("presets must name servers in the file; names are unique", () => {
    const c = sampleCatalog();
    const presets = [{ ...(c.presets?.[0] as object), servers: ["io.github.nobody/missing"] }];
    expect(CatalogFile.safeParse({ ...c, presets }).success).toBe(false);
    expect(CatalogFile.safeParse({ ...c, servers: [c.servers[0], c.servers[0]] }).success).toBe(false);
  });

  test("expires must be after generatedAt", () => {
    expect(CatalogFile.safeParse(sampleCatalog({ expires: "2026-10-01T00:00:00Z" })).success).toBe(false);
  });
});
