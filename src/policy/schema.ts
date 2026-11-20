// Policy config schema. Owner: p2-policy. Imported by src/core/config.ts (ProfileDef.policy).
// The rule language: a rule has `when` (conditions, all must hold) and `then` (allow, ask or deny).
// First match wins; custom rules run before the preset's. No expressions, no code.
import { z } from "zod";

/** Named starting points. Most users pick one and never write a rule. */
export const PolicyPreset = z.enum(["open", "balanced", "careful"], {
  error: "must be open, balanced or careful",
});
export type PolicyPreset = z.infer<typeof PolicyPreset>;

/** Same values as TrustLevel in core/config.ts (redefined here: config.ts imports this file). */
export const TRUST_LEVELS = ["local", "private-data", "external-content", "can-send"] as const;
const Trust = z.enum(TRUST_LEVELS, { error: "must be local, private-data, external-content or can-send" });

/**
 * What a tool says about itself through MCP annotations, with the spec's defaults for missing hints:
 * - read-only: readOnlyHint is true
 * - write: not read-only
 * - destructive: not read-only, and destructiveHint is not false
 */
export const ANNOTATIONS = ["read-only", "write", "destructive"] as const;
export type Annotation = (typeof ANNOTATIONS)[number];
const AnnotationSchema = z.enum(ANNOTATIONS, { error: "must be read-only, write or destructive" });

/** One value or a list; a list matches when any item does. */
const oneOrMany = <T extends z.ZodType>(item: T) =>
  z.union([item, z.array(item).min(1, "list must not be empty")], {
    error: "must be a value or a list of values",
  });

const Glob = z.string().min(1, "must not be empty");

/** "unknown key "annotaton"; use tool, annotation, trust or after" instead of zod's default. */
const unknownKeys = (allowed: string) => ({
  error: (iss: { code?: string; keys?: string[] }) =>
    iss.code === "unrecognized_keys"
      ? `unknown key ${(iss.keys ?? []).map((k) => `"${k}"`).join(", ")}; use ${allowed}`
      : undefined,
});

export const RuleWhen = z
  .strictObject(
    {
      /** Glob on the tool name. With "__" it matches "<account>__<tool>"; without, only the tool part. */
      tool: oneOrMany(Glob).optional(),
      annotation: oneOrMany(AnnotationSchema).optional(),
      /** Trust level of the tool's server. */
      trust: oneOrMany(Trust).optional(),
      /** Trust level of any earlier result in this client session (data-flow rule). */
      after: oneOrMany(Trust).optional(),
    },
    unknownKeys("tool, annotation, trust or after"),
  )
  .default({});
export type RuleWhen = z.infer<typeof RuleWhen>;

export const RuleThen = z.enum(["allow", "ask", "deny"], { error: "must be allow, ask or deny" });
export type RuleThen = z.infer<typeof RuleThen>;

export const Rule = z.strictObject(
  {
    /** Omitted: the rule matches every call. */
    when: RuleWhen,
    // biome-ignore lint/suspicious/noThenProperty: `then` is the config.yaml rule syntax; its value is a string
    then: RuleThen,
    /** One plain sentence shown with the decision. Generated from `when` and `then` if omitted. */
    reason: z.string().min(1).max(200).optional(),
  },
  unknownKeys("when, then or reason"),
);
export type Rule = z.infer<typeof Rule>;

export const DEFAULT_APPROVAL_TIMEOUT = 120;

export const PolicyDef = z
  .object({
    preset: PolicyPreset.default("balanced"),
    /** Custom rules, evaluated before the preset's own. */
    rules: z.array(Rule).default([]),
    /** Seconds to wait for an answer to an approval request. No answer means denied. */
    approvalTimeout: z
      .number({ error: "must be a number of seconds" })
      .int("must be a whole number of seconds")
      .min(5, "must be at least 5 seconds")
      .max(3600, "must be at most 3600 seconds (one hour)")
      .default(DEFAULT_APPROVAL_TIMEOUT),
  })
  .default({ preset: "balanced", rules: [], approvalTimeout: DEFAULT_APPROVAL_TIMEOUT });
export type PolicyDef = z.infer<typeof PolicyDef>;
