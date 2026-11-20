// Profile resolution and cross-reference checks for a parsed Config.
import { ALL_PROFILE, type Config, ProfileDef } from "./config.ts";

export interface ResolvedProfile {
  id: string;
  def: ProfileDef;
  /** Account ids, in config order for "all", in profile order otherwise. */
  accounts: string[];
}

const ALL_DEFAULTS: ProfileDef = ProfileDef.parse({ name: "All" });

/** Profile ids, with "all" first. */
export function profileIds(config: Config): string[] {
  return [ALL_PROFILE, ...Object.keys(config.profiles).filter((id) => id !== ALL_PROFILE)];
}

/**
 * Resolve a profile id. "all" always exists and holds every account; a `profiles.all` entry
 * may set its other fields (privacy, deny, ...). Unknown ids return undefined.
 */
export function resolveProfile(config: Config, id: string): ResolvedProfile | undefined {
  if (id === ALL_PROFILE) {
    const def = { ...ALL_DEFAULTS, ...config.profiles[ALL_PROFILE] };
    return { id, def, accounts: Object.keys(config.accounts) };
  }
  const def = config.profiles[id];
  if (!def) return undefined;
  return { id, def, accounts: [...new Set(def.accounts)] };
}

/** Broken references, as "<path>: <problem>" lines. Empty when the config is consistent. */
export function checkReferences(config: Config): string[] {
  const problems: string[] = [];
  for (const [id, account] of Object.entries(config.accounts)) {
    if (!config.servers[account.server])
      problems.push(`accounts.${id}.server: no server named "${account.server}"`);
  }
  for (const [id, profile] of Object.entries(config.profiles)) {
    if (id === ALL_PROFILE && profile.accounts.length > 0) {
      problems.push(`profiles.all.accounts: "all" always holds every account; remove this list`);
      continue;
    }
    profile.accounts.forEach((accountId, i) => {
      if (!config.accounts[accountId])
        problems.push(`profiles.${id}.accounts.${i}: no account named "${accountId}"`);
    });
  }
  return problems;
}
