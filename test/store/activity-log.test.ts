import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { importKey, newKeyBytes } from "../../src/core/crypto.ts";
import type { ActivityEntry } from "../../src/store/activity.ts";
import { SqliteActivityLog, sanitizeEvent } from "../../src/store/activity-log.ts";
import { openDb } from "../../src/store/db.ts";
import type { GatewayEvent } from "../../src/store/events.ts";

const DAY = 86_400_000;

const call = (profileId: string, tool: string): GatewayEvent => ({
  type: "call",
  profileId,
  tool,
  outcome: "ok",
  masked: 2,
  ms: 40,
});

describe("SqliteActivityLog", () => {
  let db: Database;
  let key: CryptoKey;
  let clock: number;
  let log: SqliteActivityLog;
  beforeEach(async () => {
    db = openDb(":memory:");
    key = await importKey(newKeyBytes());
    clock = Date.UTC(2026, 10, 7);
    log = new SqliteActivityLog(db, key, () => clock);
  });

  test("round trip, newest first", async () => {
    log.emit({ type: "search", profileId: "work", query: "create issue", results: 3, ms: 5 });
    clock += 1;
    log.emit(call("work", "linear-work__create_issue"));
    await log.flush();
    const rows = await log.query();
    expect(rows.map((r) => r.event.type)).toEqual(["call", "search"]);
    expect(rows[0]?.event).toEqual(call("work", "linear-work__create_issue"));
    expect(rows[1]?.at).toBe(Date.UTC(2026, 10, 7));
  });

  test("payloads are encrypted at rest", async () => {
    log.emit({ type: "search", profileId: "work", query: "quarterly-secret-plan", results: 1, ms: 1 });
    log.emit({ type: "account-state", accountId: "gmail", status: "error", reason: "token-expired-xyz" });
    await log.flush();
    const raw = db.query<Record<string, unknown>, []>("SELECT * FROM activity").all();
    const dump = raw.map((r) => Buffer.from(r.payload as Uint8Array).toString("latin1")).join("|");
    expect(raw).toHaveLength(2);
    for (const needle of ["quarterly-secret-plan", "token-expired-xyz", "query", "results"])
      expect(dump).not.toContain(needle);
  });

  test("a row's payload cannot be moved to other columns", async () => {
    log.emit(call("work", "a__b"));
    await log.flush();
    db.run("UPDATE activity SET profile_id = 'personal'");
    await expect(log.query()).rejects.toThrow();
  });

  test("another key cannot read the log", async () => {
    log.emit(call("work", "a__b"));
    await log.flush();
    const other = new SqliteActivityLog(db, await importKey(newKeyBytes()));
    await expect(other.query()).rejects.toThrow();
  });

  test("query filters", async () => {
    log.emit(call("work", "linear-work__create_issue"));
    clock += 10;
    log.emit(call("personal", "gmail-home__send"));
    clock += 10;
    log.emit({ type: "token-refreshed", accountId: "gmail-home" });
    clock += 10;
    log.emit({ type: "search", profileId: "work", query: "q", results: 0, ms: 1 });
    await log.flush();
    const t0 = Date.UTC(2026, 10, 7);
    const types = (rows: ActivityEntry[]) => rows.map((r) => r.event.type);

    expect(types(await log.query({ profileId: "work" }))).toEqual(["search", "call"]);
    expect(types(await log.query({ type: "call" }))).toEqual(["call", "call"]);
    expect(types(await log.query({ accountId: "gmail-home" }))).toEqual(["token-refreshed", "call"]);
    expect(types(await log.query({ since: t0 + 10, before: t0 + 30 }))).toEqual(["token-refreshed", "call"]);
    expect(await log.query({ limit: 1 })).toHaveLength(1);
    expect(types(await log.query({ profileId: "nobody" }))).toEqual([]);
  });

  test("prune removes entries older than the retention period", async () => {
    log.emit(call("work", "a__old"));
    clock += 31 * DAY;
    log.emit(call("work", "a__new"));
    await log.flush();
    expect(log.prune(30)).toBe(1);
    const rows = await log.query();
    expect(rows.map((r) => (r.event as { tool: string }).tool)).toEqual(["a__new"]);
    expect(log.prune(30)).toBe(0);
    expect(() => log.prune(-1)).toThrow();
  });

  test("subscribe receives new entries until unsubscribed", async () => {
    const seen: ActivityEntry[] = [];
    const off = log.subscribe((e) => seen.push(e));
    log.subscribe(() => {
      throw new Error("bad listener");
    });
    log.emit(call("work", "a__b"));
    await log.flush();
    off();
    log.emit(call("work", "a__c"));
    await log.flush();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.id).toBeGreaterThan(0);
    expect(seen[0]?.event).toEqual(call("work", "a__b"));
  });

  test("events with extra fields are rejected and never written", async () => {
    const leaky = { ...call("work", "a__b"), arguments: { to: "x@example.com" } };
    expect(() => log.emit(leaky as unknown as GatewayEvent)).toThrow('unexpected field "arguments"');
    expect(() =>
      log.emit({ type: "token-refreshed", accountId: "a", result: "x" } as unknown as GatewayEvent),
    ).toThrow();
    await log.flush();
    expect(await log.query()).toEqual([]);
  });
});

describe("sanitizeEvent", () => {
  test("accepts every event type", () => {
    const ok: GatewayEvent[] = [
      { type: "search", profileId: "p", query: "q", results: 1, ms: 1 },
      {
        type: "call",
        profileId: "p",
        tool: "a__b",
        outcome: "error",
        masked: 0,
        ms: 1,
        errorCode: "timeout",
      },
      { type: "account-state", accountId: "a", status: "ready" },
      { type: "account-state", accountId: "a", status: "error", reason: "x" },
      { type: "tools-changed", accountId: "a", added: 1, removed: 0, changed: 2 },
      { type: "token-refreshed", accountId: "a" },
      { type: "server-spawned", accountId: "a", pid: 123 },
      { type: "server-exited", accountId: "a", code: null },
      { type: "server-exited", accountId: "a", code: 1 },
    ];
    for (const e of ok) expect(sanitizeEvent(e)).toEqual(e);
  });

  test("drops undefined optionals", () => {
    expect(sanitizeEvent({ ...call("p", "a__b"), errorCode: undefined })).toEqual(call("p", "a__b"));
  });

  test("rejects bad shapes", () => {
    const bad: unknown[] = [
      null,
      [],
      { type: "unknown" },
      { type: "toString" },
      { type: "token-refreshed" },
      { type: "token-refreshed", accountId: 5 },
      { type: "token-refreshed", accountId: { nested: "value" } },
      { ...call("p", "a__b"), outcome: "maybe" },
      { ...call("p", "a__b"), masked: Number.NaN },
      { type: "search", profileId: "p", query: "x".repeat(1001), results: 1, ms: 1 },
    ];
    for (const e of bad) expect(() => sanitizeEvent(e)).toThrow();
  });
});
