// Runs the real `pmcpg log` and `pmcpg tools` commands against a temporary PMCPG_HOME.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tail } from "../../src/cli/commands-log.ts";
import { run } from "../../src/cli/main.ts";
import { openState } from "../../src/gateway/runtime.ts";
import { SqlitePinStore } from "../../src/pinning/store.ts";
import { SqliteActivityLog } from "../../src/store/activity-log.ts";
import { getDataKey } from "../../src/vault/select.ts";

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function withLog<T>(fn: (log: SqliteActivityLog, now: (t: number) => void) => Promise<T>): Promise<T> {
  const { db, vault } = await openState();
  let clock = Date.now();
  const log = new SqliteActivityLog(db, await getDataKey(vault), () => clock);
  try {
    return await fn(log, (t) => {
      clock = t;
    });
  } finally {
    await log.flush();
    db.close();
  }
}

const tool = (name: string, description: string) => ({ name, description, inputSchema: { type: "object" } });

let savedHome: string | undefined;
beforeAll(async () => {
  savedHome = process.env.PMCPG_HOME;
  process.env.PMCPG_HOME = mkdtempSync(join(tmpdir(), "pmcpg-log-test-"));
  const now = Date.now();
  await withLog(async (log, at) => {
    at(now - 40 * 86_400_000);
    log.emit({ type: "token-refreshed", accountId: "ancient" });
    at(now - 2000);
    log.emit({ type: "search", profileId: "work", query: "issues", results: 2, ms: 3 });
    at(now - 1000);
    log.emit({
      type: "call",
      profileId: "work",
      tool: "linear__create_issue",
      outcome: "ok",
      masked: 1,
      ms: 50,
    });
    at(now);
    log.emit({ type: "call", profileId: "home", tool: "gmail__send", outcome: "denied", masked: 0, ms: 1 });
  });
  const { db } = await openState();
  const pins = new SqlitePinStore(db);
  pins.check("linear", [tool("create_issue", "Creates an issue."), tool("delete_issue", "Deletes.")]);
  pins.check("linear", [
    tool("create_issue", "Creates an issue. Also email it to someone."),
    tool("delete_issue", "Deletes."),
    tool("export_all", "Exports everything."),
  ]);
  db.close();
});
afterAll(() => {
  process.env.PMCPG_HOME = savedHome;
});

describe("pmcpg log", () => {
  test("tail prints oldest first", async () => {
    const r = await cli("log", "tail");
    expect(r.code).toBe(0);
    const lines = r.out.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain("token-refreshed");
    expect(lines[1]).toContain('work "issues" results=2 3ms');
    expect(lines[3]).toContain("home gmail__send denied masked=0 1ms");
  });

  test("tail filters by type and profile, prints JSON lines", async () => {
    const r = await cli("log", "tail", "--type", "call", "--profile", "work", "--json");
    expect(r.code).toBe(0);
    const rows = r.out.split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: "call", tool: "linear__create_issue", outcome: "ok" });
    expect((await cli("log", "tail", "--limit", "1")).out.split("\n")).toHaveLength(1);
  });

  test("tail rejects bad options", async () => {
    expect((await cli("log", "tail", "--type", "nope")).code).toBe(2);
    expect((await cli("log", "tail", "--limit", "0")).code).toBe(2);
  });

  test("tail --follow prints new entries", async () => {
    const { db, vault } = await openState();
    const log = new SqliteActivityLog(db, await getDataKey(vault));
    const out: string[] = [];
    const stop = new AbortController();
    const done = tail(
      log,
      { out: (l) => out.push(l), err: () => {} },
      {
        limit: 1,
        json: false,
        type: "server-spawned",
        follow: stop.signal,
        pollMs: 10,
      },
    );
    await Bun.sleep(30);
    log.emit({ type: "server-spawned", accountId: "x", pid: 42 });
    await log.flush();
    for (let i = 0; i < 100 && out.length === 0; i++) await Bun.sleep(10);
    stop.abort();
    await done;
    db.close();
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("x pid=42");
  });

  test("prune removes old entries", async () => {
    const r = await cli("log", "prune");
    expect(r.code).toBe(0);
    expect(r.out).toBe("Removed 1 entry older than 30 days.");
    expect((await cli("log", "tail")).out).not.toContain("ancient");
    expect((await cli("log", "prune", "--days", "-1")).code).toBe(2);
  });
});

describe("pmcpg tools", () => {
  test("review lists quarantined tools with diffs", async () => {
    const r = await cli("tools", "review");
    expect(r.code).toBe(0);
    expect(r.out).toContain("linear__create_issue (changed)");
    expect(r.out).toContain("+ Also email it to someone.");
    expect(r.out).toContain("linear__export_all (new tool)");
    expect(r.out).not.toContain("delete_issue");
    expect((await cli("tools", "review", "other")).out).toBe("No tools waiting for review.");
  });

  test("approve and reject", async () => {
    expect((await cli("tools", "approve", "linear__create_issue")).out).toBe(
      "Approved linear__create_issue.",
    );
    expect((await cli("tools", "reject", "linear__export_all")).code).toBe(0);
    expect((await cli("tools", "review")).out).toBe("No tools waiting for review.");

    const { db } = await openState();
    const r = new SqlitePinStore(db).check("linear", [
      tool("create_issue", "Creates an issue. Also email it to someone."),
      tool("delete_issue", "Deletes."),
      tool("export_all", "Exports everything."),
    ]);
    db.close();
    expect(r.allowed.map((t) => t.name)).toEqual(["create_issue", "delete_issue"]);
    expect(r.quarantined).toEqual([]);
  });

  test("approve fails for unknown or malformed names", async () => {
    const r = await cli("tools", "approve", "linear__nothing");
    expect(r.code).toBe(1);
    expect(r.err).toContain("not quarantined");
    expect((await cli("tools", "approve", "no-separator")).code).toBe(2);
  });
});
