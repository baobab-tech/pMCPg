import { describe, expect, test } from "bun:test";
import { Config } from "../src/core/config.ts";
import { decrypt, encrypt, importKey, newKeyBytes } from "../src/core/crypto.ts";
import { qualify, unqualify } from "../src/core/types.ts";
import { openDb } from "../src/store/db.ts";
import { resolveSecrets, type Vault } from "../src/vault/vault.ts";

describe("config schema", () => {
  test("parses a full example", () => {
    const yaml = Bun.YAML.parse(exampleYaml());
    const cfg = Config.parse(yaml);
    expect(cfg.gateway.port).toBe(7431);
    expect(cfg.servers.gmail?.transport).toBe("stdio");
    expect(cfg.accounts["gmail-work"]?.auth.type).toBe("oauth");
    expect(cfg.profiles.briefing?.privacy).toBe("strict");
  });
  test("rejects bad slugs, accepts header auth", () => {
    expect(() => Config.parse({ servers: { Bad__Name: { transport: "http", url: "https://x" } } })).toThrow();
    expect(() =>
      Config.parse({ accounts: { a: { server: "s", env: {}, auth: { type: "header", headers: {} } } } }),
    ).not.toThrow();
  });
});

function exampleYaml(): string {
  return `
servers:
  gmail:
    transport: stdio
    command: npx
    args: [-y, some-gmail-mcp]
    trust: [private-data, can-send]
  linear:
    transport: http
    url: https://mcp.linear.app/mcp
accounts:
  gmail-work:
    server: gmail
    label: olivier@work
    auth: { type: oauth }
  linear-work:
    server: linear
    auth: { type: oauth }
profiles:
  briefing:
    accounts: [gmail-work, linear-work]
    privacy: strict
`;
}

test("qualify / unqualify round trip", () => {
  expect(unqualify(qualify("gmail-work", "send_email"))).toEqual({
    accountId: "gmail-work",
    toolName: "send_email",
  });
  expect(unqualify("nounderscore")).toBeUndefined();
});

test("resolveSecrets", async () => {
  const store = new Map([["shared/key", "abc"]]);
  const vault: Vault = {
    keySource: "env",
    get: async (k) => store.get(k),
    set: async () => {},
    delete: async () => false,
    list: async () => [],
  };
  expect(await resolveSecrets("vault:shared/key", vault)).toBe("abc");
  expect(await resolveSecrets("Bearer {{vault:shared/key}}", vault)).toBe("Bearer abc");
});

test("encrypt / decrypt with aad", async () => {
  const key = await importKey(newKeyBytes());
  const blob = await encrypt(key, "secret", "row-1");
  expect(await decrypt(key, blob, "row-1")).toBe("secret");
  await expect(decrypt(key, blob, "row-2")).rejects.toThrow();
});

test("db migrates", () => {
  const db = openDb(":memory:");
  const v = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
  expect(v?.user_version).toBe(2);
});
