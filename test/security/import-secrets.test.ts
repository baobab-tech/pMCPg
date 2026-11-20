// IMP-2: secrets in args, URL paths, URL passwords and query parameters never land in config.yaml.
import { describe, expect, test } from "bun:test";
import { resolveArgs } from "../../src/connectors/stdio-env.ts";
import { Config } from "../../src/core/config.ts";
import { argSecrets, findRawSecrets, urlSecrets } from "../../src/core/config-store.ts";
import { applyImport } from "../../src/onboarding/apply.ts";
import { mergeFound, parseEntry, redactArgs, stripSecretParams } from "../../src/onboarding/importers.ts";
import { cleanPastedUrl } from "../../src/onboarding/paste.ts";
import type { Vault } from "../../src/vault/vault.ts";

const GHP = `ghp_${"a1B2c3D4e5".repeat(4)}`;

describe("config validation finds plain-text secrets outside env and headers", () => {
  const cfg = (servers: unknown, accounts: unknown = {}) => Config.parse({ servers, accounts });

  test("URLs: password, query value, token in the path", () => {
    const found = findRawSecrets(
      cfg({
        a: { transport: "http", url: "https://user:hunter2hunter2@x.example/mcp" },
        b: { transport: "http", url: "https://x.example/mcp?apiKey=sk-abcdefghijklmnopqrstu" },
        c: { transport: "http", url: `https://x.example/mcp/${GHP}/sse` },
        ok: { transport: "http", url: "https://x.example/mcp?region=eu" },
      }),
    );
    expect(found.map((f) => f.split(":")[0])).toEqual(["servers.a.url", "servers.b.url", "servers.c.url"]);
    expect(found.join("\n")).not.toContain("hunter2");
  });

  test("stdio arguments and raw URL parameter values", () => {
    const found = findRawSecrets(
      cfg(
        {
          s: {
            transport: "stdio",
            command: "docker",
            args: [
              "run",
              "-e",
              `GITHUB_TOKEN=${GHP}`,
              "postgresql://admin:SuperSecretPW@db/x",
              "--api-key",
              "abcd1234efgh",
            ],
          },
          r: { transport: "http", url: "https://x.example/mcp" },
        },
        { r: { server: "r", urlParams: { token: "abcdefgh12345678" } } },
      ),
    );
    expect(found.map((f) => f.split(":")[0]).sort()).toEqual([
      "accounts.r.urlParams.token",
      "servers.s.args.2",
      "servers.s.args.3",
      "servers.s.args.5",
    ]);
  });

  test("vault references and ordinary arguments pass", () => {
    expect(
      argSecrets(["-y", "@modelcontextprotocol/server-filesystem", "/Users/x/Docs", "{{vault:a/b}}"]),
    ).toEqual([]);
    expect(urlSecrets("https://mcp.linear.app/mcp")).toEqual([]);
  });
});

describe("import never copies secrets (IMP-2)", () => {
  test("arguments: secrets become values to fill in", () => {
    const r = redactArgs(["run", "-e", `GITHUB_TOKEN=${GHP}`, "postgresql://admin:SuperSecretPW@db/x"]);
    expect(r.args).toEqual([
      "run",
      "-e",
      "GITHUB_TOKEN={{arg-secret:ARG_3_SECRET}}",
      "postgresql://admin:{{arg-secret:ARG_4_SECRET}}@db/x",
    ]);
    expect(r.names).toEqual(["ARG_3_SECRET", "ARG_4_SECRET"]);
  });

  test("URLs: password removed and asked as a header; session parameters removed", () => {
    expect(stripSecretParams("https://u:p@x.example/mcp?x_session=abc&region=eu")).toEqual({
      url: "https://x.example/mcp?region=eu",
      removed: ["x_session"],
      hadPassword: true,
    });
    const f = parseEntry("cursor", "x", "f", { url: "https://u:pw@x.example/mcp" });
    expect(f?.headerNames).toEqual(["Authorization"]);
    expect(JSON.stringify(f)).not.toContain("pw@");
  });

  test("a key in the URL path: not imported; pasted lists refuse it", async () => {
    const f = parseEntry("cursor", "zap", "f", {
      url: "https://actions.zapier.com/mcp/sk-ak-PATHSECRETabcdefghij/sse",
    });
    expect(f?.secretInUrl).toBe(true);
    expect(JSON.stringify(f)).not.toContain("PATHSECRET");
    let cfg = Config.parse({});
    const handle = {
      config: () => cfg,
      updateConfig: async (m: (d: Config) => void) => {
        const d = structuredClone(cfg);
        m(d);
        cfg = Config.parse(d);
        return cfg;
      },
      vault: {} as never,
    };
    const out = await applyImport(handle, mergeFound(f ? [f] : []), {
      probe: async (url) => ({ ok: true, url, transport: "http", auth: { type: "none" }, suggestedId: "x" }),
    });
    expect(out[0]?.status).toBe("skipped-secret");
    expect(JSON.stringify(cfg)).not.toContain("PATHSECRET");
    expect(cleanPastedUrl("https://actions.zapier.com/mcp/sk-ak-PATHSECRETabcdefghij/sse").ok).toBe(false);
  });

  test("applyImport turns argument markers into vault references the account fills in", async () => {
    const f = parseEntry("cursor", "gh", "f", {
      command: "docker",
      args: ["run", "-e", `GITHUB_TOKEN=${GHP}`],
    });
    let cfg = Config.parse({});
    const handle = {
      config: () => cfg,
      updateConfig: async (m: (d: Config) => void) => {
        const d = structuredClone(cfg);
        m(d);
        cfg = Config.parse(d);
        return cfg;
      },
      vault: {} as never,
    };
    const out = await applyImport(handle, mergeFound(f ? [f] : []));
    expect(JSON.stringify(cfg)).not.toContain(GHP);
    expect(out[0]?.missingValues).toEqual(["ARG_3_SECRET"]);
    const s = cfg.servers.gh;
    expect(s?.transport === "stdio" && s.args[2]).toBe("GITHUB_TOKEN={{vault:account/gh/env-arg_3_secret}}");
    expect(findRawSecrets(cfg)).toEqual([]);
  });

  test("stdio spawn resolves vault placeholders in arguments", async () => {
    const vault = {
      get: async (k: string) => (k === "account/gh/env-arg_3_secret" ? GHP : undefined),
    } as unknown as Vault;
    const r = await resolveArgs(["run", "GITHUB_TOKEN={{vault:account/gh/env-arg_3_secret}}"], vault);
    expect(r.args).toEqual(["run", `GITHUB_TOKEN=${GHP}`]);
    expect(r.secrets).toEqual([GHP]);
  });
});
