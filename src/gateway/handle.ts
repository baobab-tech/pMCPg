// What the web UI's API (src/api) may read and change in the running gateway.
// Implemented by the runtime; the UI API is built against this interface and tested with fakes.

import type { DownstreamTool, OAuthController } from "../connectors/connector.ts";
import type { Config } from "../core/config.ts";
import type { AccountState } from "../core/types.ts";
import type { PinStore } from "../pinning/pins.ts";
import type { ActivityLog } from "../store/activity.ts";
import type { ApprovalStore } from "../store/approvals.ts";
import type { Vault } from "../vault/vault.ts";

export interface GatewayHandle {
  /** Base URL, e.g. http://127.0.0.1:7431 */
  url: string;
  config(): Config;
  /**
   * Change config.yaml: the mutation runs on a copy, which is validated, checked for broken references,
   * saved, and then applied (reload). Throws with a readable message when invalid; nothing is saved then.
   */
  updateConfig(mutate: (draft: Config) => void): Promise<Config>;
  accountState(accountId: string): AccountState;
  toolCount(accountId: string): number;
  /** Tools as last listed by the account's server (cached; empty before the first listing). */
  tools(accountId: string): DownstreamTool[];
  /** List tools again for one account (after sign-in, or "Test" in the UI). */
  refreshAccount(accountId: string): Promise<void>;
  oauth: OAuthController;
  /** For write-only secret fields. The UI never reads secret values back. */
  vault: Vault;
  /** The profile's client token, created if missing. Shown in "Connect a client". */
  clientToken(profileId: string): Promise<string>;
  /**
   * Forget masked values (placeholder -> real value) for one profile, or every profile when omitted.
   * Old placeholders then stay literal text. Returns how many sessions and placeholders were dropped.
   */
  resetPrivacy(profileId?: string): { sessions: number; placeholders: number };
  /** Where the master key lives, shown in Settings. */
  keySource: "keychain" | "env";
  /** Present once Phase 2 modules are wired in. */
  approvals?: ApprovalStore;
  activity?: ActivityLog;
  pins?: PinStore;
}
