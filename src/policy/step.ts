// Pipeline steps for policy: the check before forwarding, and data-flow tracking after.
import { GatewayError } from "../core/types.ts";
import type { CallContext, Step } from "../pipeline/step.ts";
import { SECRET_PLACEHOLDER } from "../privacy/mask.ts";
import { findSecrets } from "../privacy/secrets/scan.ts";
import type { ApprovalStore } from "../store/approvals.ts";
import { decide, sourceTrust } from "./decide.ts";

export interface PolicyStepDeps {
  approvals: ApprovalStore;
  /** Overrides the profile's `policy.approvalTimeout` (tests). */
  timeoutMs?: number;
}

/**
 * "before" step. Allow passes; deny throws; ask creates an approval request and waits for the user.
 * A request nobody answers expires and counts as denied.
 */
export function policyStep(deps: PolicyStepDeps): Step {
  return {
    name: "policy",
    phase: "before",
    async run(ctx: CallContext) {
      const d = decide({ profile: ctx.profile, tool: ctx.tool, seenTrust: ctx.session.seenTrust });
      ctx.decisions.push({ step: "policy", outcome: d.outcome, reason: d.reason });
      const tool = ctx.tool.qualifiedName;
      if (d.outcome === "allow") return;
      if (d.outcome === "deny")
        throw new GatewayError(
          "denied",
          `The gateway's policy blocks ${tool}: ${d.reason} Do not retry; tell the user if they need it.`,
        );

      const timeoutMs = deps.timeoutMs ?? ctx.profile.policy.approvalTimeout * 1000;
      const req = deps.approvals.create({
        profileId: ctx.profileId,
        tool,
        reason: d.reason,
        preview: argumentPreview(ctx.args),
      });
      const status = await deps.approvals.wait(req.id, timeoutMs, ctx.signal);
      if (status === "approved") {
        ctx.decisions.push({ step: "policy", outcome: "allow", reason: "The user approved this call." });
        return;
      }
      if (status === "denied") {
        ctx.decisions.push({ step: "policy", outcome: "deny", reason: "The user declined this call." });
        throw new GatewayError(
          "denied",
          `The user declined the call to ${tool}, so it was not made. Do not retry unless the user asks.`,
        );
      }
      ctx.decisions.push({
        step: "policy",
        outcome: "deny",
        reason: "Nobody answered the approval request.",
      });
      throw new GatewayError(
        "approval-required",
        `The call to ${tool} needed the user's approval and nobody answered within ${formatSeconds(timeoutMs)}, so it was not made. Ask the user to approve it in pMCPg, then try again.`,
      );
    },
  };
}

/** "after" step. Records the tool's trust levels in the session, for rules with `after`. Unlabelled servers count as unknown. */
export const dataFlowStep: Step = {
  name: "data-flow",
  phase: "after",
  async run(ctx: CallContext) {
    for (const t of sourceTrust(ctx.tool)) ctx.session.seenTrust.add(t);
  },
};

/** Longest preview shown to the person deciding. */
export const PREVIEW_MAX = 2000;

/**
 * The arguments the tool will receive, as indented JSON, for the approval request. Policy runs after
 * re-hydration, so the person deciding sees real values (a recipient, not "[EMAIL_1_k7qx]").
 * Secrets are redacted. Cut at PREVIEW_MAX characters.
 */
export function argumentPreview(args: Record<string, unknown>): string {
  const raw = JSON.stringify(args, null, 2) ?? "{}";
  let text = "";
  let at = 0;
  for (const f of findSecrets(raw).sort((a, b) => a.start - b.start)) {
    if (f.start < at) continue;
    text += raw.slice(at, f.start) + SECRET_PLACEHOLDER;
    at = f.end;
  }
  text += raw.slice(at);
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}\n… (cut)` : text;
}

function formatSeconds(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s % 60 === 0 && s >= 60) return s === 60 ? "1 minute" : `${s / 60} minutes`;
  return s === 1 ? "1 second" : `${s} seconds`;
}
