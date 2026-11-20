// The policy evaluator: a pure function from (profile, tool, session trust) to allow / ask / deny.
// Order: profile deny list, read-only profile, custom rules, preset rules, then allow.
import type { ProfileDef } from "../core/config.ts";
import { NAME_SEPARATOR, type ToolRef } from "../core/types.ts";
import type { Annotation, PolicyPreset, Rule, RuleThen, RuleWhen } from "./schema.ts";

type Trust = ToolRef["trust"][number];

export interface DecideInput {
  profile: Pick<ProfileDef, "policy" | "readOnly" | "deny">;
  tool: Pick<ToolRef, "qualifiedName" | "toolName" | "annotations" | "trust">;
  /** Trust levels of results seen earlier in this client session. */
  seenTrust?: ReadonlySet<string>;
}

export interface PolicyDecision {
  outcome: RuleThen;
  /** One plain sentence. */
  reason: string;
  /** Which rule fired: "deny-list", "read-only", "custom #2", "balanced #1" or "default". */
  rule: string;
}

/**
 * A server with no trust labels is unknown, not harmless. Its results count as private data and outside
 * content, and its tools count as able to send data out, except tools annotated read-only (pins cover
 * annotations, so a server cannot flip that after approval). Without this, `balanced` rule 2 never fires
 * for servers added through onboarding, which all start with `trust: []`.
 */
export const UNLABELLED_SOURCE: readonly Trust[] = ["private-data", "external-content"];

/** Trust levels a tool's results add to the session. */
export function sourceTrust(tool: Pick<ToolRef, "trust">): readonly Trust[] {
  return tool.trust.length ? tool.trust : UNLABELLED_SOURCE;
}

/** Trust levels rules test the tool against. */
export function targetTrust(tool: Pick<ToolRef, "trust" | "annotations">): readonly Trust[] {
  if (tool.trust.length) return tool.trust;
  return hasAnnotation(tool, "read-only") ? UNLABELLED_SOURCE : [...UNLABELLED_SOURCE, "can-send"];
}

/** Builds a rule. `then` holds a string, never a function, so rules are not thenables. */
function rule(when: RuleWhen, then: RuleThen, reason: string): Rule {
  return { when, then, reason };
}

/** Built-in rules per preset. Custom rules run first. */
export const PRESET_RULES: Record<PolicyPreset, Rule[]> = {
  open: [],
  balanced: [
    rule({ annotation: "destructive" }, "ask", "This tool may delete or overwrite data."),
    rule(
      { trust: "can-send", after: "external-content" },
      "ask",
      "This tool can send data out, and this session has read outside content that could steer it.",
    ),
  ],
  careful: [
    rule(
      { annotation: "write" },
      "ask",
      "This tool may change data, and this profile asks before any change.",
    ),
    rule(
      { trust: "can-send" },
      "ask",
      "This tool can send data out, and this profile asks before anything leaves.",
    ),
  ],
};

const PRESET_DEFAULT_REASON: Record<PolicyPreset, string> = {
  open: "The open preset allows every call.",
  balanced: "No rule asks for approval here, so the call is allowed.",
  careful: "This tool only reads data, so the call is allowed.",
};

export function decide({ profile, tool, seenTrust = new Set() }: DecideInput): PolicyDecision {
  if (profile.deny.some((g) => matchGlob(g, tool.qualifiedName)))
    return { outcome: "deny", reason: "This tool is on this profile's deny list.", rule: "deny-list" };
  if (profile.readOnly && !hasAnnotation(tool, "read-only"))
    return {
      outcome: "deny",
      reason: "This profile is read-only, and this tool may change data.",
      rule: "read-only",
    };
  for (const { rule, label } of effectiveRules(profile.policy)) {
    if (matches(rule.when, tool, seenTrust))
      return { outcome: rule.then, reason: rule.reason ?? describeRule(rule), rule: label };
  }
  return { outcome: "allow", reason: PRESET_DEFAULT_REASON[profile.policy.preset], rule: "default" };
}

/** Custom rules, then preset rules, each with a label for explanations. */
export function effectiveRules(policy: ProfileDef["policy"]): { rule: Rule; label: string }[] {
  return [
    ...policy.rules.map((rule, i) => ({ rule, label: `custom #${i + 1}` })),
    ...PRESET_RULES[policy.preset].map((rule, i) => ({ rule, label: `${policy.preset} #${i + 1}` })),
  ];
}

/** False when the tool is blocked whatever the session has seen, so search can leave it out. */
export function searchable(profile: DecideInput["profile"], tool: DecideInput["tool"]): boolean {
  return decide({ profile, tool }).outcome !== "deny";
}

export function matches(when: RuleWhen, tool: DecideInput["tool"], seenTrust: ReadonlySet<string>): boolean {
  if (when.tool && !list(when.tool).some((g) => matchToolGlob(g, tool))) return false;
  if (when.annotation && !list(when.annotation).some((a) => hasAnnotation(tool, a))) return false;
  if (when.trust && !list(when.trust).some((t) => targetTrust(tool).includes(t))) return false;
  if (when.after && !list(when.after).some((t) => seenTrust.has(t))) return false;
  return true;
}

/** Annotation test with the MCP spec defaults: readOnlyHint false, destructiveHint true. */
export function hasAnnotation(tool: Pick<ToolRef, "annotations">, a: Annotation): boolean {
  const readOnly = tool.annotations?.readOnlyHint === true;
  if (a === "read-only") return readOnly;
  if (a === "write") return !readOnly;
  return !readOnly && tool.annotations?.destructiveHint !== false;
}

/** A glob with "__" matches the qualified name; without, the tool's own name on any account. */
function matchToolGlob(glob: string, tool: DecideInput["tool"]): boolean {
  return matchGlob(glob, glob.includes(NAME_SEPARATOR) ? tool.qualifiedName : tool.toolName);
}

/** `*` matches any run of characters. Everything else is literal. */
export function matchGlob(glob: string, name: string): boolean {
  const body = glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${body}$`).test(name);
}

const list = <T>(v: T | T[]): T[] => (Array.isArray(v) ? v : [v]);

// --- plain-language descriptions ------------------------------------------

const VERB: Record<RuleThen, string> = {
  allow: "Allow",
  ask: "Ask before calling",
  deny: "Block",
};

const ANNOTATION_WORDS: Record<Annotation, string> = {
  "read-only": "only read data",
  write: "may change data",
  destructive: "may delete or overwrite data",
};

const SERVER_WORDS: Record<Trust, string> = {
  local: "are local",
  "private-data": "hold private data",
  "external-content": "bring in outside content",
  "can-send": "can send data out",
};

const SEEN_WORDS: Record<Trust, string> = {
  local: "a local result",
  "private-data": "private data",
  "external-content": "outside content (web pages, emails, documents)",
  "can-send": "a result from a server that can send data out",
};

const or = (items: string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;

/** The rule as one sentence, e.g. "Ask before calling tools named "send_*" that may change data." */
export function describeRule(rule: Rule): string {
  const w = rule.when;
  const parts: string[] = [];
  if (w.tool) parts.push(`named ${or(list(w.tool).map((g) => `"${g}"`))}`);
  if (w.annotation) parts.push(`that ${or(list(w.annotation).map((a) => ANNOTATION_WORDS[a]))}`);
  if (w.trust) parts.push(`from servers that ${or(list(w.trust).map((t) => SERVER_WORDS[t]))}`);
  let sentence = `${VERB[rule.then]} ${parts.length ? `tools ${parts.join(" ")}` : "every tool"}`;
  if (w.after) sentence += `, once this session has read ${or(list(w.after).map((t) => SEEN_WORDS[t]))}`;
  return `${sentence}.`;
}
