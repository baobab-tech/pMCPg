import type { Database } from "bun:sqlite";
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decrypt, encrypt } from "../../src/core/crypto.ts";
import { openDb } from "../../src/store/db.ts";
import { DbVault, readMasterKey } from "../../src/vault/db.ts";
import { keychainMasterKey, MASTER_KEY_NAME, type SecretStore } from "../../src/vault/keychain.ts";
import { getDataKey, openVault } from "../../src/vault/select.ts";
import { resolveSecrets, type Vault } from "../../src/vault/vault.ts";

const MASTER = Buffer.from(new Uint8Array(32).fill(7)).toString("base64");
const OTHER_MASTER = Buffer.from(new Uint8Array(32).fill(9)).toString("base64");

class FakeStore implements SecretStore {
  entries = new Map<string, string>();
  fail = false;
  async get(o: { service: string; name: string }) {
    if (this.fail) throw new Error("no keychain");
    return this.entries.get(`${o.service}|${o.name}`) ?? null;
  }
  async set(o: { service: string; name: string; value: string }) {
    if (this.fail) throw new Error("no keychain");
    this.entries.set(`${o.service}|${o.name}`, o.value);
  }
  async delete(o: { service: string; name: string }) {
    if (this.fail) throw new Error("no keychain");
    return this.entries.delete(`${o.service}|${o.name}`);
  }
}

let home: string;
let db: Database;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pmcpg-vault-"));
  db = openDb(join(home, "state.db"));
});
afterEach(() => {
  db.close();
  rmSync(home, { recursive: true, force: true });
});

/** Behaviour every backend must share. */
async function contract(vault: Vault) {
  expect(await vault.get("account/a/key")).toBeUndefined();
  await vault.set("account/a/key", "s1");
  await vault.set("account/a/oauth/tokens", '{"t":1}');
  await vault.set("account/ab/key", "s2");
  await vault.set("gateway/admin-token", "s3");
  await vault.set("account/a/key", "s1b");
  expect(await vault.get("account/a/key")).toBe("s1b");
  expect(await vault.list("account/a/")).toEqual(["account/a/key", "account/a/oauth/tokens"]);
  expect(await vault.list("account/a%")).toEqual([]);
  expect((await vault.list("")).length).toBe(4);
  expect(await resolveSecrets("Bearer {{vault:account/ab/key}}", vault)).toBe("Bearer s2");
  expect(await vault.delete("account/a/key")).toBe(true);
  expect(await vault.delete("account/a/key")).toBe(false);
  expect(await vault.get("account/a/key")).toBeUndefined();
  expect(await vault.list("account/a/")).toEqual(["account/a/oauth/tokens"]);
  await expect(vault.set("x", "")).rejects.toThrow("empty value");
}

describe("db vault", () => {
  test("get/set/delete/list", async () => {
    await contract(await DbVault.open(db, readMasterKey({ PMCPG_MASTER_KEY: MASTER })));
  });
  test("stores ciphertext bound to the key", async () => {
    const vault = await DbVault.open(db, readMasterKey({ PMCPG_MASTER_KEY: MASTER }));
    await vault.set("a", "plain-value");
    await vault.set("b", "other");
    const raw = db.query<{ value: Uint8Array }, []>("SELECT value FROM secrets WHERE key = 'a'").get();
    expect(Buffer.from(raw?.value ?? []).toString()).not.toContain("plain-value");
    // Swap rows: AAD mismatch must fail.
    db.run("UPDATE secrets SET value = (SELECT value FROM secrets WHERE key = 'a') WHERE key = 'b'");
    await expect(vault.get("b")).rejects.toThrow("cannot decrypt b");
  });
  test("refuses to start without a master key", async () => {
    await expect(DbVault.open(db, undefined)).rejects.toThrow("PMCPG_MASTER_KEY");
  });
  test("refuses a different master key", async () => {
    await DbVault.open(db, readMasterKey({ PMCPG_MASTER_KEY: MASTER }));
    await expect(DbVault.open(db, readMasterKey({ PMCPG_MASTER_KEY: OTHER_MASTER }))).rejects.toThrow(
      "does not match",
    );
  });
});

describe("readMasterKey", () => {
  test("inline and file", () => {
    expect(readMasterKey({})).toBeUndefined();
    expect(readMasterKey({ PMCPG_MASTER_KEY: MASTER })?.byteLength).toBe(32);
    const file = join(home, "mk");
    writeFileSync(file, `${MASTER}\n`);
    expect(readMasterKey({ PMCPG_MASTER_KEY_FILE: file })?.byteLength).toBe(32);
  });
  test("bad values, without echoing them", () => {
    expect(() => readMasterKey({ PMCPG_MASTER_KEY: "c2hvcnQ=" })).toThrow("32 bytes");
    expect(() => readMasterKey({ PMCPG_MASTER_KEY: "not base64!" })).toThrow("not base64");
    expect(() => readMasterKey({ PMCPG_MASTER_KEY: MASTER, PMCPG_MASTER_KEY_FILE: "x" })).toThrow("only one");
    expect(() => readMasterKey({ PMCPG_MASTER_KEY_FILE: join(home, "missing") })).toThrow("cannot read");
    try {
      readMasterKey({ PMCPG_MASTER_KEY: "c2hvcnQ=" });
    } catch (e) {
      expect((e as Error).message).not.toContain("c2hvcnQ=");
    }
  });
});

describe("keychain master key", () => {
  test("created once, then reused; one keychain entry only", async () => {
    const store = new FakeStore();
    const k1 = await keychainMasterKey(store, false, "svc");
    const k2 = await keychainMasterKey(store, true, "svc");
    expect(Buffer.from(k1).equals(Buffer.from(k2))).toBe(true);
    expect([...store.entries.keys()]).toEqual([`svc|${MASTER_KEY_NAME}`]);
  });
  test("missing key with existing data is an error, not a new key", async () => {
    await expect(keychainMasterKey(new FakeStore(), true)).rejects.toThrow("no master key");
  });
  test("no keychain: clear error pointing at PMCPG_MASTER_KEY", async () => {
    const store = new FakeStore();
    store.fail = true;
    await expect(keychainMasterKey(store, false)).rejects.toThrow("PMCPG_MASTER_KEY");
  });
});

describe("openVault", () => {
  test("env key wins and never touches the keychain", async () => {
    const store = new FakeStore();
    store.fail = true;
    const v = await openVault(db, { env: { PMCPG_MASTER_KEY: MASTER }, store });
    expect(v.keySource).toBe("env");
  });
  test("keychain key: secrets go to state.db, keychain holds one entry", async () => {
    const store = new FakeStore();
    const v = await openVault(db, { env: {}, store });
    expect(v.keySource).toBe("keychain");
    await contract(v);
    expect(store.entries.size).toBe(1);
    const again = await openVault(db, { env: {}, store });
    expect(await again.get("gateway/admin-token")).toBe("s3");
  });
  test("large values work (no per-entry keychain limit)", async () => {
    const v = await openVault(db, { env: {}, store: new FakeStore() });
    const big = "x".repeat(20_000);
    await v.set("account/a/oauth/tokens", big);
    expect(await v.get("account/a/oauth/tokens")).toBe(big);
  });
  test("migrates secrets from the old one-entry-per-secret keychain layout", async () => {
    const store = new FakeStore();
    store.entries.set("private-mcp-gateway|account/a/key", "old-secret");
    db.run("INSERT INTO settings (key, value) VALUES ('vault.keychain/account/a/key', '1')");
    db.run("INSERT INTO settings (key, value) VALUES ('vault.backend', 'keychain')");
    const v = await openVault(db, { env: {}, store });
    expect(await v.get("account/a/key")).toBe("old-secret");
    expect([...store.entries.keys()]).toEqual([`private-mcp-gateway|${MASTER_KEY_NAME}`]);
    expect(db.query("SELECT key FROM settings WHERE key LIKE 'vault.keychain/%'").all()).toEqual([]);
  });
});

describe("getDataKey", () => {
  test("derived from the master key, nothing stored", async () => {
    const vault = await DbVault.open(db, readMasterKey({ PMCPG_MASTER_KEY: MASTER }));
    const blob = await encrypt(await getDataKey(vault), "payload");
    const again = await DbVault.open(db, readMasterKey({ PMCPG_MASTER_KEY: MASTER }));
    expect(await decrypt(await getDataKey(again), blob)).toBe("payload");
    expect(await vault.list("")).toEqual([]);
  });
});

// Real OS keychain. Opt in with PMCPG_TEST_KEYCHAIN=1 (CI does on macOS, Windows and Linux).
// Uses its own service name and deletes its entry.
describe.skipIf(process.env.PMCPG_TEST_KEYCHAIN !== "1")("OS keychain", () => {
  const service = "private-mcp-gateway-test";
  afterAll(async () => {
    await Bun.secrets.delete({ service, name: MASTER_KEY_NAME });
  });
  test("master key round trip, then vault works", async () => {
    await Bun.secrets.delete({ service, name: MASTER_KEY_NAME });
    const v = await openVault(db, { env: {}, service });
    expect(v.keySource).toBe("keychain");
    await contract(v);
    const stored = await Bun.secrets.get({ service, name: MASTER_KEY_NAME });
    expect(Buffer.from(stored ?? "", "base64").byteLength).toBe(32);
    const again = await openVault(db, { env: {}, service });
    expect(await again.get("gateway/admin-token")).toBe("s3");
  });
});
