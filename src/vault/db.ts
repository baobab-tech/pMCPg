// Vault backed by the secrets table in state.db. The only vault: the master key comes from the OS keychain
// (desktop) or from the environment (Docker, headless Linux).
// Values are AES-256-GCM encrypted (crypto.ts) with the vault key as AAD, so rows cannot be swapped.
// The encryption keys are derived with HKDF from a master key given by the environment.
import type { Database } from "bun:sqlite";
import { readFileSync } from "node:fs";
import { decrypt, encrypt } from "../core/crypto.ts";
import { listByPrefix } from "./list.ts";
import type { Vault } from "./vault.ts";

const CHECK_SETTING = "vault.db.check";
const CHECK_TEXT = "pmcpg-master-key-check";

export const MASTER_KEY_HELP =
  "Set PMCPG_MASTER_KEY (base64 of 32 random bytes) or PMCPG_MASTER_KEY_FILE (path to a file holding it). " +
  "Generate one with: openssl rand -base64 32";

/** Read the master key from PMCPG_MASTER_KEY or PMCPG_MASTER_KEY_FILE. Undefined when neither is set. */
export function readMasterKey(
  env: Record<string, string | undefined> = process.env,
): Uint8Array<ArrayBuffer> | undefined {
  const inline = env.PMCPG_MASTER_KEY;
  const file = env.PMCPG_MASTER_KEY_FILE;
  if (inline && file) throw new Error("Set only one of PMCPG_MASTER_KEY and PMCPG_MASTER_KEY_FILE.");
  let text: string;
  let source: string;
  if (inline) {
    text = inline;
    source = "PMCPG_MASTER_KEY";
  } else if (file) {
    source = "PMCPG_MASTER_KEY_FILE";
    try {
      text = readFileSync(file, "utf8");
    } catch {
      throw new Error(`${source}: cannot read ${file}`);
    }
  } else {
    return undefined;
  }
  const trimmed = text.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed)) throw new Error(`${source} is not base64. ${MASTER_KEY_HELP}`);
  const bytes = new Uint8Array(Buffer.from(trimmed, "base64"));
  if (bytes.byteLength !== 32)
    throw new Error(`${source} must decode to 32 bytes, got ${bytes.byteLength}. ${MASTER_KEY_HELP}`);
  return bytes;
}

let fromProcess: { key: Uint8Array<ArrayBuffer> | undefined } | undefined;

/**
 * The master key from the process environment, read once. PMCPG_MASTER_KEY and PMCPG_MASTER_KEY_FILE are
 * then deleted from process.env, so no child process (browser launcher, `claude`, stdio servers) inherits them.
 */
export function takeMasterKeyFromProcessEnv(): Uint8Array<ArrayBuffer> | undefined {
  if (!fromProcess || process.env.PMCPG_MASTER_KEY || process.env.PMCPG_MASTER_KEY_FILE) {
    try {
      fromProcess = { key: readMasterKey(process.env) };
    } finally {
      delete process.env.PMCPG_MASTER_KEY;
      delete process.env.PMCPG_MASTER_KEY_FILE;
    }
  }
  return fromProcess.key;
}

/** Derive a non-extractable AES-256-GCM key for one purpose from the master key. */
export async function deriveKey(master: Uint8Array<ArrayBuffer>, purpose: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", master, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new TextEncoder().encode("pmcpg/v1"),
      info: new TextEncoder().encode(purpose),
    },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** True once this state.db has been used with a master key (it may hold secrets). */
export function hasEncryptedData(db: Database): boolean {
  return !!db.query("SELECT 1 FROM settings WHERE key = ?").get(CHECK_SETTING);
}

export class DbVault implements Vault {
  private constructor(
    private readonly db: Database,
    private readonly key: CryptoKey,
    private readonly master: Uint8Array<ArrayBuffer>,
    readonly keySource: "keychain" | "env",
  ) {}

  /**
   * Open the vault. Throws when no master key is given, or when it differs from the key
   * this state.db was first used with.
   */
  static async open(
    db: Database,
    master: Uint8Array<ArrayBuffer> | undefined,
    keySource: "keychain" | "env" = "env",
  ): Promise<DbVault> {
    if (!master) throw new Error(`The db vault needs a master key. ${MASTER_KEY_HELP}`);
    const key = await deriveKey(master, "vault/secrets");
    const row = db
      .query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?")
      .get(CHECK_SETTING);
    if (row) {
      try {
        await decrypt(key, new Uint8Array(Buffer.from(row.value, "base64")), CHECK_SETTING);
      } catch {
        throw new Error("The master key does not match the one this state.db was created with.");
      }
    } else {
      const blob = await encrypt(key, CHECK_TEXT, CHECK_SETTING);
      db.run("INSERT INTO settings (key, value) VALUES (?, ?)", [
        CHECK_SETTING,
        Buffer.from(blob).toString("base64"),
      ]);
    }
    return new DbVault(db, key, master, keySource);
  }

  async get(key: string): Promise<string | undefined> {
    const row = this.db
      .query<{ value: Uint8Array<ArrayBuffer> }, [string]>("SELECT value FROM secrets WHERE key = ?")
      .get(key);
    if (!row) return undefined;
    try {
      return await decrypt(this.key, row.value, key);
    } catch {
      throw new Error(`vault: cannot decrypt ${key}`);
    }
  }

  async set(key: string, value: string): Promise<void> {
    if (value === "") throw new Error(`vault: empty value for ${key}; use delete instead`);
    const blob = await encrypt(this.key, value, key);
    this.db.run(
      "INSERT INTO secrets (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, blob],
    );
  }

  async delete(key: string): Promise<boolean> {
    return this.db.run("DELETE FROM secrets WHERE key = ?", [key]).changes > 0;
  }

  async list(prefix: string): Promise<string[]> {
    return listByPrefix(this.db, "secrets", "", prefix);
  }

  /** AES key for encrypted db fields, derived from the master key (no vault entry needed). */
  dataKey(): Promise<CryptoKey> {
    return deriveKey(this.master, "data-key");
  }
}
