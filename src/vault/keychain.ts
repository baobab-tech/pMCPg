// The OS keychain holds one entry: the vault master key. Every secret lives encrypted in state.db (db.ts).
// One small entry avoids per-entry size limits (Windows Credential Manager: 2,560 bytes) and keychain prompts
// per secret (macOS).
import type { Database } from "bun:sqlite";
import { newKeyBytes } from "../core/crypto.ts";
import { MASTER_KEY_HELP } from "./db.ts";

export const KEYCHAIN_SERVICE = "private-mcp-gateway";
export const MASTER_KEY_NAME = "gateway/master-key";
// Long enough for the user to answer macOS's "allow access" prompt, which appears after each unsigned update.
const TIMEOUT_MS = 120_000;

/** The subset of Bun.secrets used here. Tests pass a fake. */
export interface SecretStore {
  get(o: { service: string; name: string }): Promise<string | null>;
  set(o: { service: string; name: string; value: string; persist?: "local" | "enterprise" }): Promise<void>;
  delete(o: { service: string; name: string }): Promise<boolean>;
}

function withTimeout<T>(p: Promise<T>, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${what} timed out (is the keychain locked, or an access prompt unanswered?)`)),
      TIMEOUT_MS,
    );
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

function unavailable(cause: unknown): Error {
  return new Error(
    `No OS keychain is available (macOS Keychain, Windows Credential Manager or Linux Secret Service): ` +
      `${(cause as Error).message}. ${MASTER_KEY_HELP}`,
  );
}

/**
 * Read the master key from the keychain, creating it on first run.
 * `hasData`: state.db already holds secrets; a missing key then means they cannot be decrypted, so fail.
 */
export async function keychainMasterKey(
  store: SecretStore,
  hasData: boolean,
  service = KEYCHAIN_SERVICE,
): Promise<Uint8Array<ArrayBuffer>> {
  let stored: string | null;
  try {
    stored = await withTimeout(store.get({ service, name: MASTER_KEY_NAME }), "Keychain read");
  } catch (e) {
    throw unavailable(e);
  }
  if (stored) {
    const bytes = new Uint8Array(Buffer.from(stored, "base64"));
    if (bytes.byteLength !== 32) throw new Error(`Keychain entry ${MASTER_KEY_NAME} is not a 32-byte key.`);
    return bytes;
  }
  if (hasData)
    throw new Error(
      `state.db holds encrypted secrets but the keychain has no master key (${service} / ${MASTER_KEY_NAME}). ` +
        `Restore the keychain entry, or move state.db aside to start fresh.`,
    );
  const bytes = newKeyBytes();
  const value = Buffer.from(bytes).toString("base64");
  try {
    // "local": never roam the key with a Windows roaming profile.
    await withTimeout(
      store.set({ service, name: MASTER_KEY_NAME, value, persist: "local" }),
      "Keychain write",
    );
    const back = await withTimeout(store.get({ service, name: MASTER_KEY_NAME }), "Keychain read");
    if (back !== value) throw new Error("the value read back differs");
  } catch (e) {
    throw unavailable(e);
  }
  return bytes;
}

const LEGACY_INDEX = "vault.keychain/";

/**
 * Secrets written by the earlier one-entry-per-secret keychain vault: their names, from the settings index.
 * Used once, to move them into state.db.
 */
export function legacyKeychainKeys(db: Database): string[] {
  return db
    .query<{ key: string }, []>("SELECT key FROM settings ORDER BY key")
    .all()
    .filter((r) => r.key.startsWith(LEGACY_INDEX))
    .map((r) => r.key.slice(LEGACY_INDEX.length));
}

export function forgetLegacyKey(db: Database, key: string): void {
  db.run("DELETE FROM settings WHERE key = ?", [LEGACY_INDEX + key]);
}
