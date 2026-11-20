// Opens the vault. Secrets always live encrypted in state.db; only the master key's source varies:
//   1. PMCPG_MASTER_KEY or PMCPG_MASTER_KEY_FILE (Docker, headless Linux, CI), else
//   2. the OS keychain, one entry, created on first run.
import type { Database } from "bun:sqlite";
import { DbVault, hasEncryptedData, readMasterKey, takeMasterKeyFromProcessEnv } from "./db.ts";
import {
  forgetLegacyKey,
  KEYCHAIN_SERVICE,
  keychainMasterKey,
  legacyKeychainKeys,
  type SecretStore,
} from "./keychain.ts";
import type { Vault } from "./vault.ts";

export interface SelectOptions {
  /** Defaults to process.env, whose master key variables are deleted once read. */
  env?: Record<string, string | undefined>;
  /** Keychain implementation; defaults to Bun.secrets. */
  store?: SecretStore;
  service?: string;
}

export async function openVault(db: Database, opts: SelectOptions = {}): Promise<DbVault> {
  const service = opts.service ?? KEYCHAIN_SERVICE;
  const store = opts.store ?? Bun.secrets;

  const fromEnv = opts.env ? readMasterKey(opts.env) : takeMasterKeyFromProcessEnv();
  const vault = fromEnv
    ? await DbVault.open(db, fromEnv, "env")
    : await DbVault.open(db, await keychainMasterKey(store, hasEncryptedData(db), service), "keychain");

  await migrateLegacyKeychain(db, vault, store, service);
  return vault;
}

/** Move secrets from the earlier one-entry-per-secret keychain layout into state.db, then delete them. */
async function migrateLegacyKeychain(db: Database, vault: Vault, store: SecretStore, service: string) {
  const keys = legacyKeychainKeys(db);
  if (keys.length === 0) return;
  for (const key of keys) {
    const value = await store.get({ service, name: key });
    if (value) await vault.set(key, value);
    await store.delete({ service, name: key });
    forgetLegacyKey(db, key);
  }
  db.run("DELETE FROM settings WHERE key = 'vault.backend'");
}

/** AES-256 key for encrypted db fields (activity payloads), derived from the master key. */
export function getDataKey(vault: DbVault): Promise<CryptoKey> {
  return vault.dataKey();
}
