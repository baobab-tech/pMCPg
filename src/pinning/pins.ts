// Tool pinning contract. Implementation owner: p2-pinning-log (table `tool_pins`).
// The catalogue calls `check` after listing tools; quarantined tools stay out of search until approved.
import type { DownstreamTool } from "../connectors/connector.ts";

export interface QuarantinedTool {
  accountId: string;
  toolName: string;
  /** "new" when the account was already pinned and this tool appeared later; "changed" when its hash changed. */
  reason: "new" | "changed";
  pinned?: DownstreamTool;
  current: DownstreamTool;
}

export interface PinStore {
  /**
   * Split listed tools into those allowed into search and those quarantined.
   * First listing of an account pins everything (trust on first use).
   */
  check(
    accountId: string,
    tools: DownstreamTool[],
  ): { allowed: DownstreamTool[]; quarantined: QuarantinedTool[] };
  approve(accountId: string, toolName: string): void;
  /** Keep the old version pinned and hide the tool. */
  reject(accountId: string, toolName: string): void;
  quarantined(accountId?: string): QuarantinedTool[];
  forget(accountId: string): void;
}
