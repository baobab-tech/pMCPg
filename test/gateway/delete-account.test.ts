// Deleting an account drops everything the gateway stored for it: cached tools, search results and pins.
// Stale pins would skip trust on first use when an account with the same name comes back.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Gateway, startGateway } from "../../src/gateway/runtime.ts";

const echo = join(import.meta.dir, "..", "fixtures", "echo-server.ts");
let home: string;
let gw: Gateway;

const rows = (table: string, account: string) =>
  (gw.db.query(`SELECT count(*) AS n FROM ${table} WHERE account_id = ?`).get(account) as { n: number }).n;

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "pmcpg-delete-"));
  writeFileSync(
    join(home, "config.yaml"),
    `servers:
  echo: { transport: stdio, command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(echo)}] }
accounts:
  echo: { server: echo }
profiles:
  work: { accounts: [echo], policy: { preset: open } }
`,
  );
  gw = await startGateway({ home, listen: false, openBrowser: async () => {} });
  await gw.catalog.refreshMissing();
});

afterAll(async () => {
  await gw?.close();
});

describe("delete an account", () => {
  test("drops its cached tools, search entries and pins", async () => {
    expect(gw.catalog.count("echo")).toBe(2);
    expect(rows("tool_pins", "echo")).toBe(2);
    expect(rows("tool_pin_accounts", "echo")).toBe(1);

    await gw.handle.updateConfig((d) => {
      delete d.accounts.echo;
      delete d.servers.echo;
      for (const p of Object.values(d.profiles)) p.accounts = p.accounts.filter((a) => a !== "echo");
    });

    expect(gw.catalog.count("echo")).toBe(0);
    expect(gw.catalog.profileTools("work")).toEqual([]);
    expect(rows("tool_cache", "echo")).toBe(0);
    expect(rows("tool_pins", "echo")).toBe(0);
    expect(rows("tool_pin_accounts", "echo")).toBe(0);
    expect(rows("tool_quarantine", "echo")).toBe(0);
  });

  test("pins of an account removed while the gateway was stopped go at the next start", async () => {
    gw.db.run("INSERT INTO tool_pin_accounts (account_id, pinned_at) VALUES ('gone', 1)");
    gw.db.run(
      "INSERT INTO tool_pins (account_id, tool_name, hash, approved_at) VALUES ('gone', 't', 'h', 1)",
    );
    await gw.close();
    gw = await startGateway({ home, listen: false, openBrowser: async () => {} });
    expect(rows("tool_pins", "gone")).toBe(0);
    expect(rows("tool_pin_accounts", "gone")).toBe(0);
  });
});
