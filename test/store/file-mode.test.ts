// VLT-2: the data directory is 0700; state.db, -wal, -shm and config.yaml are 0600.
import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDataDir, saveConfig, validateConfig } from "../../src/core/config-store.ts";
import { openState } from "../../src/gateway/runtime.ts";
import { openDb } from "../../src/store/db.ts";

const mode = (f: string) => statSync(f).mode & 0o777;
const posix = process.platform !== "win32";

describe.if(posix)("data directory modes", () => {
  test("a new state.db and its -wal and -shm are 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "pmcpg-mode-"));
    const file = join(dir, "state.db");
    const db = openDb(file);
    db.run("INSERT INTO settings (key, value) VALUES ('a', 'b')");
    for (const f of [file, `${file}-wal`, `${file}-shm`]) expect(mode(f)).toBe(0o600);
    db.close();
  });

  test("opening tightens an existing 0644 state.db, -wal and -shm", () => {
    const dir = mkdtempSync(join(tmpdir(), "pmcpg-mode-"));
    const file = join(dir, "state.db");
    const first = openDb(file);
    first.run("INSERT INTO settings (key, value) VALUES ('a', 'b')");
    for (const f of [file, `${file}-wal`, `${file}-shm`]) chmodSync(f, 0o644);
    const second = openDb(file);
    for (const f of [file, `${file}-wal`, `${file}-shm`]) expect(mode(f)).toBe(0o600);
    second.close();
    first.close();
  });

  test("ensureDataDir makes the directory 0700 and tightens config.yaml", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "pmcpg-mode-")), "home");
    mkdirSync(dir, { mode: 0o755 });
    writeFileSync(join(dir, "config.yaml"), "{}\n", { mode: 0o644 });
    ensureDataDir(dir);
    expect(mode(dir)).toBe(0o700);
    expect(mode(join(dir, "config.yaml"))).toBe(0o600);
  });

  test("saveConfig writes config.yaml 0600", () => {
    const dir = mkdtempSync(join(tmpdir(), "pmcpg-mode-"));
    const file = join(dir, "config.yaml");
    saveConfig(file, validateConfig({}));
    expect(mode(file)).toBe(0o600);
  });

  test("openState leaves every file in a fresh home owner-only", async () => {
    const home = join(mkdtempSync(join(tmpdir(), "pmcpg-mode-")), "home");
    const s = await openState(home);
    expect(mode(home)).toBe(0o700);
    for (const f of ["config.yaml", "state.db", "state.db-wal", "state.db-shm"])
      expect(mode(join(home, f))).toBe(0o600);
    s.db.close();
  });
});
