// Vault contract. Implementation: DbVault (encrypted rows in state.db).
// The master key comes from the OS keychain (one entry) or from PMCPG_MASTER_KEY / PMCPG_MASTER_KEY_FILE.

/**
 * Key naming (flat strings, "/" separated):
 *   account/<accountId>/oauth/tokens        JSON OAuthTokens
 *   account/<accountId>/oauth/client        JSON client registration
 *   account/<accountId>/oauth/discovery     JSON discovery state
 *   account/<accountId>/<name>              API keys and other per-account secrets
 *   shared/<name>                           secrets referenced by several accounts
 *   gateway/client-token/<profileId>        front-door bearer token per profile
 *   gateway/admin-token                     local API token for the CLI
 */
export interface Vault {
  /** Where the master key comes from. Secrets themselves are always in state.db. */
  readonly keySource: "keychain" | "env";
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  /** Returns true if something was deleted. */
  delete(key: string): Promise<boolean>;
  /** Keys (not values) under a prefix. */
  list(prefix: string): Promise<string[]>;
}

export const vaultKeys = {
  oauthTokens: (accountId: string) => `account/${accountId}/oauth/tokens`,
  oauthClient: (accountId: string) => `account/${accountId}/oauth/client`,
  oauthDiscovery: (accountId: string) => `account/${accountId}/oauth/discovery`,
  accountSecret: (accountId: string, name: string) => `account/${accountId}/${name}`,
  clientToken: (profileId: string) => `gateway/client-token/${profileId}`,
  adminToken: () => "gateway/admin-token",
} as const;

/** Resolve "vault:<key>" refs and "{{vault:<key>}}" placeholders inside a string. */
export async function resolveSecrets(value: string, vault: Vault): Promise<string> {
  if (value.startsWith("vault:")) return (await vault.get(value.slice(6))) ?? "";
  const matches = [...value.matchAll(/\{\{vault:([\w./@-]+)\}\}/g)];
  let out = value;
  for (const m of matches) out = out.replace(m[0], (await vault.get(m[1] as string)) ?? "");
  return out;
}
