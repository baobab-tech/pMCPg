// Privacy pipeline steps. Order in the pipeline (docs/design.md "Call pipeline"):
//   before: rehydrate -> secretScan -> policy -> (inject credentials) -> forward
//   after:  mask
// secretScan must run before credential injection, or it would flag the injected keys.
import type { PrivacyLevel } from "../core/config.ts";
import { type ContentBlock, GatewayError, type ToolResult } from "../core/types.ts";
import type { CallContext, MaskRecord, Step } from "../pipeline/step.ts";
import type { Detector } from "./detector.ts";
import { patternDetector, secretDetector } from "./detectors.ts";
import { type MaskOptions, maskValue, rehydrateValue, SECRET_PLACEHOLDER } from "./mask.ts";
import { PrivacyOptions } from "./schema.ts";
import { findSecrets } from "./secrets/scan.ts";

/** Profile options with defaults filled in, even for hand-built profiles in tests. */
function options(ctx: CallContext): PrivacyOptions {
  return PrivacyOptions.parse(ctx.profile.privacyOptions ?? {});
}

/**
 * Placeholders in the model's arguments become real values in `ctx.args`.
 * A value only goes back to the account it came from, unless `shareAcrossAccounts` allows the target.
 * Otherwise a malicious tool could ask for "[EMAIL_1]" and receive another account's data.
 */
export const rehydrateStep: Step = {
  name: "rehydrate",
  phase: "before",
  async run(ctx) {
    const { value, count, blocked, unknown } = rehydrateValue(ctx.modelArgs, ctx.session, {
      target: ctx.tool.accountId,
      shareWith: options(ctx).shareAcrossAccounts,
    });
    if (blocked.length) {
      const list = blocked.join(", ");
      ctx.decisions.push({
        step: "rehydrate",
        outcome: "deny",
        reason: `${blocked.length} value(s) came from another account`,
      });
      throw new GatewayError(
        "denied",
        `Blocked: ${list} came from another account, and the gateway does not pass personal data from one account to another. Do not retry. Tell the user; they can allow it for ${ctx.tool.accountId} in pMCPg (privacy options, "share across accounts").`,
      );
    }
    // Sent on as text, an old placeholder would reach the tool as "[EMAIL_1_k7qx]" instead of an address.
    if (unknown.length) {
      const list = unknown.join(", ");
      ctx.decisions.push({
        step: "rehydrate",
        outcome: "deny",
        reason: `${unknown.length} unknown placeholder(s)`,
      });
      throw new GatewayError(
        "invalid-arguments",
        `${list} does not match any value the gateway holds now. It may come from before the gateway restarted or from another profile. Do not guess the value: read the source again to get a current placeholder, or ask the user.`,
      );
    }
    ctx.args = value as Record<string, unknown>;
    if (count)
      ctx.decisions.push({ step: "rehydrate", outcome: "modified", reason: `restored ${count} value(s)` });
  },
};

/** Walks strings in a JSON-like value, object keys included; `fn` may return a replacement. */
function mapStrings(v: unknown, fn: (s: string) => string): unknown {
  if (typeof v === "string") return fn(v);
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map((x) => mapStrings(x, fn));
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [fn(k), mapStrings(x, fn)]));
}

/** Stops (or redacts) secrets in outgoing arguments, so a model cannot be talked into sending one out. */
export const secretScanStep: Step = {
  name: "secret-scan",
  phase: "before",
  async run(ctx) {
    const mode = options(ctx).secretsInArguments;
    if (mode === "off") return;
    const rules = new Set<string>();
    let count = 0;
    const scanned = mapStrings(ctx.args, (s) => {
      const found = findSecrets(s).sort((a, b) => a.start - b.start);
      if (!found.length) return s;
      let out = "";
      let at = 0;
      for (const f of found) {
        if (f.start < at) continue;
        rules.add(f.ruleId);
        count++;
        out += s.slice(at, f.start) + SECRET_PLACEHOLDER;
        at = f.end;
      }
      return out + s.slice(at);
    });
    if (!count) return;
    const what = `${count} secret(s) (${[...rules].join(", ")})`;
    if (mode === "block") {
      ctx.decisions.push({ step: "secret-scan", outcome: "deny", reason: `arguments contain ${what}` });
      throw new GatewayError(
        "denied",
        `Blocked: the arguments contain ${what}. The gateway does not send secrets to tools. Ask the user to change privacyOptions.secretsInArguments if this is intended.`,
      );
    }
    ctx.args = scanned as Record<string, unknown>;
    for (let i = 0; i < count; i++)
      ctx.masks.push({ type: "SECRET", placeholder: SECRET_PLACEHOLDER, where: "arguments" });
    ctx.decisions.push({ step: "secret-scan", outcome: "modified", reason: `redacted ${what}` });
  },
};

/** Block fields that hold a kind or binary data, not text. Everything else is masked. */
const KEEP = new Set(["type", "mimeType", "data", "blob"]);

/**
 * Masks every field of a content block: text, link name, uri, description, title, `_meta`, and the same
 * inside an embedded resource. Images, audio and blobs keep their data.
 */
async function maskBlock(
  block: ContentBlock,
  ctx: CallContext,
  opts: MaskOptions & { skipFields?: string[] },
  records: MaskRecord[],
): Promise<ContentBlock> {
  const fields = async (obj: Record<string, unknown>) => {
    const out: [string, unknown][] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (KEEP.has(k)) out.push([k, v]);
      else if (k === "resource" && v !== null && typeof v === "object" && !Array.isArray(v))
        out.push([k, await fields(v as Record<string, unknown>)]);
      else out.push([k, await maskValue(v, ctx.session, opts, "result", records)]);
    }
    return Object.fromEntries(out);
  };
  return (await fields(block as Record<string, unknown>)) as ContentBlock;
}

/** Builds the mask step with a given detector list (tier 0 by default). */
export function createMaskStep(detectors: Detector[] = [secretDetector, patternDetector]): Step {
  return {
    name: "mask",
    phase: "after",
    async run(ctx) {
      const result = ctx.result;
      if (!result) return;
      const o = options(ctx);
      const skipped = o.skipAccounts.includes(ctx.tool.accountId);
      const level: PrivacyLevel = skipped ? "off" : (ctx.profile.privacy ?? "standard");
      const secrets = o.secretsInResults === "redact";
      if (level === "off" && !secrets) return;
      const opts = {
        source: ctx.tool.accountId,
        level,
        secrets,
        allow: o.allow,
        skipTypes: o.skipTypes,
        skipFields: o.skipFields,
        detectors,
      };
      const records: MaskRecord[] = [];
      const masked: ToolResult = { ...result, content: [] };
      for (const block of result.content ?? [])
        masked.content.push(await maskBlock(block, ctx, opts, records));
      if (result.structuredContent) {
        masked.structuredContent = (await maskValue(
          result.structuredContent,
          ctx.session,
          opts,
          "result",
          records,
        )) as Record<string, unknown>;
      }
      // Anything else a server sends at the top level, such as `_meta`.
      const extra = masked as unknown as Record<string, unknown>;
      for (const [k, v] of Object.entries(result)) {
        if (k === "content" || k === "structuredContent" || k === "isError") continue;
        extra[k] = await maskValue(v, ctx.session, opts, "result", records);
      }
      ctx.result = masked;
      if (!records.length) return;
      ctx.masks.push(...records);
      ctx.decisions.push({ step: "mask", outcome: "modified", reason: `masked ${records.length} value(s)` });
    },
  };
}

export const maskStep: Step = createMaskStep();

/** The privacy steps in pipeline order. */
export const privacySteps = { rehydrateStep, secretScanStep, maskStep };
