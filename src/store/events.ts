// Activity events. Producers: every module. Consumer: activity log (Phase 2), web UI.
// Events never carry argument or result values, only names, counts and outcomes.

export type GatewayEvent =
  | { type: "search"; profileId: string; query: string; results: number; ms: number }
  | {
      type: "call";
      profileId: string;
      tool: string;
      outcome: "ok" | "error" | "denied" | "approval-required";
      masked: number;
      ms: number;
      errorCode?: string;
    }
  | { type: "account-state"; accountId: string; status: string; reason?: string }
  | { type: "tools-changed"; accountId: string; added: number; removed: number; changed: number }
  | { type: "token-refreshed"; accountId: string }
  /** A gateway token was replaced: a profile's client token (profileId set) or the admin token. Never the value. */
  | { type: "token-rotated"; token: "client" | "admin"; profileId?: string; via: "cli" | "ui" }
  | { type: "server-spawned"; accountId: string; pid: number }
  | { type: "server-exited"; accountId: string; code: number | null }
  /** A client read a skill file. `skill` is the skill id ("notes", "github/pr-review"); `file` its relative path. */
  | { type: "skill-read"; profileId: string; skill: string; file: string; via: "tool" | "mcp" }
  /** A server's skills differ from the last sync. `held` counts skills now waiting for review. */
  | {
      type: "skills-changed";
      accountId: string;
      added: number;
      removed: number;
      changed: number;
      held: number;
    }
  /** Masked values forgotten. No profileId: every profile. */
  | { type: "privacy-reset"; profileId?: string; sessions: number; placeholders: number };

export interface EventSink {
  emit(event: GatewayEvent): void;
}

/** Default sink for tests and early wiring. */
export const nullSink: EventSink = { emit() {} };
