// `pmcpg token rotate` against a temporary PMCPG_HOME (VLT-3).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tokenRotate } from "../../src/cli/commands-token.ts";
import { run } from "../../src/cli/main.ts";
import { ensureToken, openState } from "../../src/gateway/runtime.ts";
import { SqliteActivityLog } from "../../src/store/activity-log.ts";
import { getDataKey } from "../../src/vault/select.ts";
import { vaultKeys } from "../../src/vault/vault.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

async function token(key: string, create = false): Promise<string | undefined> {
  const { vault, db } = await openState();
  try {
    return create ? await ensureToken(vault, key) : await vault.get(key);
  } finally {
    db.close();
  }
}

let savedHome: string | undefined;
beforeAll(() => {
  savedHome = process.env.PMCPG_HOME;
  process.env.PMCPG_HOME = mkdtempSync(join(tmpdir(), "pmcpg-token-cli-"));
});
afterAll(() => {
  process.env.PMCPG_HOME = savedHome;
});

describe("pmcpg token rotate", () => {
  test("needs exactly one of --profile and --admin; the profile must exist", async () => {
    const c = capture();
    expect(await run(["token", "rotate"], c.io)).toBe(2);
    expect(await run(["token", "rotate", "--admin", "--profile", "all"], c.io)).toBe(2);
    expect(await run(["token", "rotate", "--profile", "nope"], c.io)).toBe(2);
    expect(c.err.join("\n")).toContain('No profile named "nope"');
  });

  test("--admin replaces the admin token and says nothing needs reconnecting", async () => {
    const old = await token(vaultKeys.adminToken(), true);
    const c = capture();
    expect(await run(["token", "rotate", "--admin"], c.io)).toBe(0);
    const now = await token(vaultKeys.adminToken());
    expect(now).toBeDefined();
    expect(now).not.toBe(old);
    expect(c.out.join("\n")).toContain("nothing to reconnect");
    expect(c.out.join("\n")).not.toContain(now as string);
  });

  test("--profile replaces the client token, rewrites app files holding it, logs the event", async () => {
    const old = (await token(vaultKeys.clientToken("all"), true)) as string;
    const home = mkdtempSync(join(tmpdir(), "pmcpg-token-apps-"));
    const lm = join(home, ".lmstudio", "mcp.json");
    mkdirSync(join(lm, ".."), { recursive: true });
    writeFileSync(
      lm,
      JSON.stringify({ mcpServers: { pmcpg: { url: "u", headers: { Authorization: `Bearer ${old}` } } } }),
    );

    const c = capture();
    const code = await tokenRotate({ values: { profile: "all" }, positionals: [] }, c.io, {
      home,
      platform: "linux",
    });
    expect(code).toBe(0);
    const now = (await token(vaultKeys.clientToken("all"))) as string;
    expect(now).not.toBe(old);
    expect(readFileSync(lm, "utf8")).toContain(`Bearer ${now}`);
    const text = c.out.join("\n");
    expect(text).toContain("LM Studio");
    expect(text).toContain("stdio bridge");
    expect(text).not.toContain(now);
    expect(text).not.toContain(old);

    const { vault, db } = await openState();
    try {
      const log = new SqliteActivityLog(db, await getDataKey(vault));
      const events = (await log.query({ type: "token-rotated" })).map((e) => e.event);
      expect(events).toContainEqual({ type: "token-rotated", token: "client", profileId: "all", via: "cli" });
      expect(events).toContainEqual({ type: "token-rotated", token: "admin", via: "cli" });
    } finally {
      db.close();
    }
  });
});
