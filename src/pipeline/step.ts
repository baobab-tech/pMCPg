// Call pipeline contract. Owner: core (Phase 0) for the runner; steps are added by later sessions.
// Order (docs/design.md "Call pipeline"): resolve, rehydrate, secret scan, policy, inject, forward, scan, mask, log, return.
import type { ProfileDef } from "../core/config.ts";
import type { ToolRef, ToolResult } from "../core/types.ts";

export interface Decision {
  step: string;
  outcome: "allow" | "deny" | "ask" | "modified";
  reason?: string;
}

export interface MaskRecord {
  type: string;
  placeholder: string;
  /** Where it was found. Never holds the value. */
  where: "result" | "arguments";
}

/** Per client session. Holds the placeholder map; lives in memory only. */
export interface SessionState {
  id: string;
  profileId: string;
  /** placeholder -> real value */
  placeholders: Map<string, string>;
  /** real value -> placeholder, for stable numbering */
  reverse: Map<string, string>;
  /** Trust levels seen in results so far, for data-flow rules. */
  seenTrust: Set<string>;
}

export interface CallContext {
  requestId: string;
  profileId: string;
  profile: ProfileDef;
  session: SessionState;
  tool: ToolRef;
  /** As sent by the model (may contain placeholders). */
  modelArgs: Record<string, unknown>;
  /** As sent downstream (after rehydration). Set by the rehydrate step. */
  args: Record<string, unknown>;
  result?: ToolResult;
  decisions: Decision[];
  masks: MaskRecord[];
  startedAt: number;
  signal: AbortSignal;
}

/** A step may modify ctx, throw GatewayError to stop, or do nothing. */
export interface Step {
  name: string;
  phase: "before" | "after";
  run(ctx: CallContext): Promise<void>;
}

/** Runs "before" steps, the forward function, then "after" steps. */
export async function runPipeline(
  ctx: CallContext,
  steps: Step[],
  forward: (ctx: CallContext) => Promise<ToolResult>,
): Promise<ToolResult> {
  for (const s of steps) if (s.phase === "before") await s.run(ctx);
  ctx.result = await forward(ctx);
  for (const s of steps) if (s.phase === "after") await s.run(ctx);
  return ctx.result;
}
