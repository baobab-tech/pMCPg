import { expect, test } from "bun:test";
import { PASSWORD_SETTING, writePassword } from "../../src/api/auth.ts";
import { run } from "../../src/cli/main.ts";
import { paths } from "../../src/core/paths.ts";
import { openDb } from "../../src/store/db.ts";

test("pmcpg ui reset-password removes the password and every session", async () => {
  const db = openDb(paths().db);
  await writePassword(db, "correct horse");
  db.run("INSERT INTO ui_sessions (id_hash, created_at, last_seen_at) VALUES ('x', 1, 1)");
  db.close();

  const out: string[] = [];
  const code = await run(["ui", "reset-password"], { out: (l) => out.push(l), err: (l) => out.push(l) });
  expect(code).toBe(0);
  expect(out[0]).toContain("password removed");

  const check = openDb(paths().db);
  expect(check.query("SELECT 1 FROM settings WHERE key = ?").get(PASSWORD_SETTING)).toBeNull();
  expect(check.query("SELECT COUNT(*) AS n FROM ui_sessions").get()).toEqual({ n: 0 });
  check.close();
});
