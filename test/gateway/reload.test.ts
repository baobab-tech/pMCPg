import { describe, expect, test } from "bun:test";
import { validateConfig } from "../../src/core/config-store.ts";
import { changedAccounts, movedAccounts } from "../../src/gateway/runtime.ts";

const base = () =>
  validateConfig({
    servers: {
      local: { transport: "stdio", command: "node", args: ["a.js"] },
      web: { transport: "http", url: "https://mcp.example.com/mcp" },
    },
    accounts: { l: { server: "local" }, w: { server: "web" }, w2: { server: "web" } },
  });

describe("reload diff (CON-2)", () => {
  test("a server change marks every account on it", () => {
    const a = base();
    const b = base();
    (b.servers.local as { args: string[] }).args = ["b.js"];
    expect([...changedAccounts(a, b)]).toEqual(["l"]);
    expect(movedAccounts(a, b)).toEqual([]);
  });

  test("a new URL path keeps tokens; a new origin forgets them", () => {
    const a = base();
    const b = base();
    (b.servers.web as { url: string }).url = "https://mcp.example.com/v2/mcp";
    expect([...changedAccounts(a, b)].sort()).toEqual(["w", "w2"]);
    expect(movedAccounts(a, b)).toEqual([]);
    (b.servers.web as { url: string }).url = "https://evil.example.net/mcp";
    expect(movedAccounts(a, b).sort()).toEqual(["w", "w2"]);
  });

  test("no change, no restart", () => {
    expect(changedAccounts(base(), base()).size).toBe(0);
  });
});
