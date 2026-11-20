import { describe, expect, test } from "bun:test";
import { Config } from "../../src/core/config.ts";
import { checkReferences, profileIds, resolveProfile } from "../../src/core/profiles.ts";

const cfg = Config.parse({
  servers: {
    gmail: { transport: "http", url: "https://g.example" },
    slack: { transport: "http", url: "https://s.example" },
  },
  accounts: {
    "gmail-work": { server: "gmail" },
    "gmail-home": { server: "gmail" },
    "slack-work": { server: "slack" },
  },
  profiles: {
    briefing: { accounts: ["gmail-work", "slack-work", "gmail-work"], privacy: "strict" },
    all: { privacy: "off" },
  },
});

describe("profiles", () => {
  test("all holds every account and keeps its own settings", () => {
    const all = resolveProfile(cfg, "all");
    expect(all?.accounts).toEqual(["gmail-work", "gmail-home", "slack-work"]);
    expect(all?.def.privacy).toBe("off");
  });
  test("all exists without a profiles entry", () => {
    const all = resolveProfile(Config.parse({}), "all");
    expect(all?.accounts).toEqual([]);
    expect(all?.def.privacy).toBe("standard");
  });
  test("named profile, duplicates removed", () => {
    expect(resolveProfile(cfg, "briefing")?.accounts).toEqual(["gmail-work", "slack-work"]);
    expect(resolveProfile(cfg, "nope")).toBeUndefined();
  });
  test("ids, all first, once", () => {
    expect(profileIds(cfg)).toEqual(["all", "briefing"]);
  });
  test("references", () => {
    expect(checkReferences(cfg)).toEqual([]);
    const bad = Config.parse({
      accounts: { a: { server: "ghost" } },
      profiles: { all: { accounts: ["a"] }, p: { accounts: ["a", "b"] } },
    });
    expect(checkReferences(bad)).toEqual([
      'accounts.a.server: no server named "ghost"',
      'profiles.all.accounts: "all" always holds every account; remove this list',
      'profiles.p.accounts.1: no account named "b"',
    ]);
  });
});
