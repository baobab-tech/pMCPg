import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config } from "../../src/core/config.ts";
import {
  ConfigError,
  ensureDataDir,
  findRawSecrets,
  loadConfig,
  looksLikeRawSecret,
  saveConfig,
} from "../../src/core/config-store.ts";
import { paths } from "../../src/core/paths.ts";

const posix = process.platform !== "win32";
let home: string;
let file: string;
beforeEach(() => {
  home = join(mkdtempSync(join(tmpdir(), "pmcpg-config-")), "home");
  file = paths(home).config;
});
afterEach(() => rmSync(join(home, ".."), { recursive: true, force: true }));

const GOOD = `
servers:
  gmail:
    transport: stdio
    command: npx
    env: { NODE_ENV: production, GMAIL_TOKEN: "vault:shared/gmail" }
  linear:
    transport: http
    url: https://mcp.linear.app/mcp
accounts:
  gmail-work:
    server: gmail
    auth: { type: oauth }
  linear-work:
    server: linear
    auth:
      type: header
      headers: { Authorization: "Bearer {{vault:account/linear-work/key}}", X-Team: eng }
profiles:
  briefing:
    accounts: [gmail-work]
`;

function caught(fn: () => unknown): ConfigError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ConfigError) return e;
    throw e;
  }
  throw new Error("expected ConfigError");
}

describe("loadConfig", () => {
  test("missing file gives defaults", () => {
    expect(loadConfig(file).gateway).toEqual({ host: "127.0.0.1", port: 7431 });
  });
  test("parses a valid file", () => {
    ensureDataDir(home);
    writeFileSync(file, GOOD);
    const cfg = loadConfig(file);
    expect(cfg.accounts["linear-work"]?.auth.type).toBe("header");
  });
  test("empty file gives defaults", () => {
    ensureDataDir(home);
    writeFileSync(file, "");
    expect(loadConfig(file).servers).toEqual({});
  });
  test("bad YAML", () => {
    ensureDataDir(home);
    writeFileSync(file, "servers: [");
    expect(caught(() => loadConfig(file)).problems[0]).toContain("not valid YAML");
  });
  test("schema errors name the field path", () => {
    ensureDataDir(home);
    writeFileSync(file, "gateway: { port: 99999 }\nservers:\n  x:\n    transport: stdio\n");
    const err = caught(() => loadConfig(file));
    expect(err.problems.some((p) => p.startsWith("gateway.port:"))).toBe(true);
    expect(err.problems.some((p) => p.startsWith("servers.x.command:"))).toBe(true);
    expect(err.message).toContain(file);
  });
  test("broken references", () => {
    ensureDataDir(home);
    writeFileSync(file, "accounts:\n  a: { server: nope }\nprofiles:\n  p: { accounts: [ghost] }\n");
    const err = caught(() => loadConfig(file));
    expect(err.problems).toContain('accounts.a.server: no server named "nope"');
    expect(err.problems).toContain('profiles.p.accounts.0: no account named "ghost"');
  });
  test("raw secrets are rejected by field, value not echoed", () => {
    ensureDataDir(home);
    const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";
    writeFileSync(
      file,
      `servers:\n  s:\n    transport: stdio\n    command: x\n    env: { GITHUB_TOKEN: ${secret} }\n` +
        `accounts:\n  a:\n    server: s\n    auth: { type: header, headers: { Authorization: "Bearer abc" } }\n`,
    );
    const err = caught(() => loadConfig(file));
    expect(err.problems.map((p) => p.split(":")[0])).toEqual([
      "servers.s.env.GITHUB_TOKEN",
      "accounts.a.auth.headers.Authorization",
    ]);
    expect(err.message).not.toContain(secret);
  });
});

describe("looksLikeRawSecret", () => {
  test.each([
    ["API_KEY", "abcd1234efgh"],
    ["Authorization", "Bearer abc"],
    ["Authorization", "Basic dXNlcjpwYXNz"],
    ["X_ANYTHING", "sk-proj-abcdefghijklmnop1234"],
    ["X_ANYTHING", "AKIAABCDEFGHIJKLMNOP"],
    ["RANDOM", "aB3dE5fG7hJ9kL1mN3pQ5rS7tU9vW1xY"],
    ["X-Api-Key", "prefix-{{vault:k}}-0123456789abcdef"],
  ])("%s=%s is a secret", (name, value) => {
    expect(looksLikeRawSecret(name, value)).toBe(true);
  });
  test.each([
    ["API_KEY", "vault:shared/k"],
    ["Authorization", "Bearer {{vault:account/a/key}}"],
    ["NODE_ENV", "production"],
    ["AUTH_URL", "https://example.com/oauth"],
    ["TOKEN_TYPE", "bearer"],
    ["PATH", "/usr/local/bin:/usr/bin"],
    ["X-Team", "eng"],
  ])("%s=%s is not", (name, value) => {
    expect(looksLikeRawSecret(name, value)).toBe(false);
  });
});

describe("saveConfig", () => {
  test("round trips, atomic, 0600 in a 0700 dir", () => {
    const cfg = Config.parse(Bun.YAML.parse(GOOD));
    saveConfig(file, cfg);
    expect(loadConfig(file)).toEqual(cfg);
    expect(readdirSync(home).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    if (posix) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(statSync(home).mode & 0o777).toBe(0o700);
    }
  });
  test("overwrites an existing file", () => {
    saveConfig(file, Config.parse({}));
    const cfg = Config.parse({ gateway: { port: 8000 } });
    saveConfig(file, cfg);
    expect(loadConfig(file).gateway.port).toBe(8000);
  });
  test("refuses invalid config and leaves the file alone", () => {
    saveConfig(file, Config.parse({}));
    const before = readFileSync(file, "utf8");
    const bad = Config.parse({ accounts: { a: { server: "s", env: { API_KEY: "abcd1234efgh" } } } });
    const err = caught(() => saveConfig(file, bad));
    expect(err.problems.length).toBe(2);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  test("findRawSecrets on a clean config", () => {
    expect(findRawSecrets(Config.parse(Bun.YAML.parse(GOOD)))).toEqual([]);
  });
});

describe("ensureDataDir", () => {
  test("creates nested dir, tightens an existing one", () => {
    ensureDataDir(home);
    expect(existsSync(home)).toBe(true);
    if (posix) {
      Bun.spawnSync(["chmod", "755", home]);
      ensureDataDir(home);
      expect(statSync(home).mode & 0o777).toBe(0o700);
    }
  });
});
