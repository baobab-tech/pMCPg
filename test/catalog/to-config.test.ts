import { describe, expect, test } from "bun:test";
import { CatalogFile, type Entry } from "../../src/catalog/schema.ts";
import { entrySlug, entryToConfig } from "../../src/catalog/to-config.ts";
import { catalogToolsHash } from "../../src/catalog/tools-hash.ts";
import { Config } from "../../src/core/config.ts";
import { sampleCatalog } from "../fixtures/catalog-sample.ts";

const [linear, grants] = CatalogFile.parse(sampleCatalog()).servers as [Entry, Entry];

function asConfig(r: ReturnType<typeof entryToConfig>) {
  if (!r.ok) throw new Error(r.reason);
  const c = r.config;
  return Config.parse({ servers: { [c.serverId]: c.server }, accounts: { [c.accountId]: c.account } });
}

describe("entryToConfig", () => {
  test("remote OAuth entry", () => {
    const r = entryToConfig(linear);
    expect(r.ok && r.config.server).toMatchObject({ transport: "http", url: "https://mcp.linear.app/mcp" });
    expect(r.ok && r.config.account.auth).toEqual({ type: "oauth" });
    expect(r.ok && r.config.server.trust).toEqual(["private-data", "can-send"]);
    expect(asConfig(r).servers.linear?.name).toBe("Linear");
  });

  test("npm package pins the exact version; secrets become vault refs", () => {
    const r = entryToConfig(grants);
    if (!r.ok) throw new Error(r.reason);
    expect(r.config.serverId).toBe("grants-search");
    expect(r.config.server).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/grants-mcp@0.4.2", "--read-only"],
      env: { GRANTS_REGION: "ca" },
    });
    expect(r.config.account.env).toEqual({
      GRANTS_API_KEY: "vault:account/grants-search/env-grants_api_key",
    });
    expect(r.config.needs.env).toEqual(["GRANTS_API_KEY"]);
    asConfig(r);
  });

  test("header auth on a remote", () => {
    const e = {
      ...linear,
      _meta: {
        "io.pmcpg/curation": {
          ...linear._meta["io.pmcpg/curation"],
          auth: { type: "header", credentials: ["X-Api-Key"] },
        },
      },
    } as Entry;
    const r = entryToConfig(e, { accountId: "linear-work" });
    expect(r.ok && r.config.account.auth).toEqual({
      type: "header",
      headers: { "X-Api-Key": "{{vault:account/linear-work/header-x-api-key}}" },
    });
  });

  test("mcpb-only entry is refused with a reason", () => {
    const e = {
      ...grants,
      packages: [
        {
          registryType: "mcpb",
          identifier: "https://example.com/a.mcpb",
          version: "1.0.0",
          fileSha256: "c".repeat(64),
          transport: { type: "stdio" },
          packageArguments: [],
          environmentVariables: [],
        },
      ],
    } as Entry;
    const r = entryToConfig(e);
    expect(r.ok).toBe(false);
  });

  test("entrySlug always gives a valid slug", () => {
    expect(entrySlug("io.github.acme/Grants_Search.v2")).toBe("grants-search-v2");
    expect(entrySlug("io.x/___")).toBe("server");
    expect(entrySlug(`io.x/${"a".repeat(60)}`)).toHaveLength(40);
  });

  test("toolsHash ignores list order", () => {
    const a = { name: "a", inputSchema: { type: "object" } };
    const b = { name: "b", inputSchema: { type: "object" } };
    expect(catalogToolsHash([a, b])).toBe(catalogToolsHash([b, a]));
    expect(catalogToolsHash([a, b])).toMatch(/^[0-9a-f]{64}$/);
  });
});
