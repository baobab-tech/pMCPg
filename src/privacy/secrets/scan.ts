// Secret scanner: gitleaks-style keyword prefilter, regex, entropy and allowlists.
import { entropy } from "../validate.ts";
import { type Rule, secretRules } from "./rules.ts";

export interface SecretMatch {
  /** Offsets of the secret itself (the capture group), not the label around it. */
  start: number;
  end: number;
  ruleId: string;
}

/** gitleaks' global allowlist (values that are templates or placeholders), plus our own placeholders. */
const GLOBAL_ALLOW = [
  /^(?:true|false|null)$/i,
  /^(?:a+|b+|c+|d+|e+|f+|g+|h+|i+|j+|k+|l+|m+|n+|o+|p+|q+|r+|s+|t+|u+|v+|w+|x+|y+|z+|\*+|\.+)$/i,
  /^\$(?:\d+|\{\d+\})$/,
  /^\$(?:[A-Z_]+|[a-z_]+)$/,
  /^\$\{(?:[A-Z_]+|[a-z_]+)\}$/,
  /^\{\{[ \t]*[\w ().|]+[ \t]*\}\}$/,
  /^%(?:[A-Z_]+|[a-z_]+)%$/,
  /^\[[A-Z_]+(?:_\d+)?\]$/,
];
const GLOBAL_STOPWORDS = ["014df517-39d1-4453-b7b3-9930c563627c", "abcdefghijklmnopqrstuvwxyz"];

function lineAt(text: string, start: number, end: number): string {
  const a = text.lastIndexOf("\n", start - 1) + 1;
  const b = text.indexOf("\n", end);
  return text.slice(a, b === -1 ? text.length : b);
}

function allowed(
  rule: Rule,
  secret: string,
  match: string,
  text: string,
  start: number,
  end: number,
): boolean {
  const lower = secret.toLowerCase();
  if (GLOBAL_ALLOW.some((r) => r.test(secret)) || GLOBAL_STOPWORDS.some((w) => lower.includes(w)))
    return true;
  for (const a of rule.allow) {
    if (a.stopwords.some((w) => lower.includes(w))) return true;
    if (a.regexes.length) {
      const target = a.target === "match" ? match : a.target === "line" ? lineAt(text, start, end) : secret;
      if (a.regexes.some((r) => r.test(target))) return true;
    }
  }
  return false;
}

/** Secrets in `text`. Overlapping matches from different rules are all returned; callers merge spans. */
export function findSecrets(text: string): SecretMatch[] {
  const out: SecretMatch[] = [];
  if (text.length < 8) return out;
  const lower = text.toLowerCase();
  for (const rule of secretRules()) {
    if (rule.kw && !rule.kw.some((k) => lower.includes(k))) continue;
    rule.re.lastIndex = 0;
    for (let m = rule.re.exec(text); m; m = rule.re.exec(text)) {
      if (m[0].length === 0) {
        rule.re.lastIndex++;
        continue;
      }
      // Secret = the configured group, else the first group that matched, else the whole match.
      let gi = rule.group ?? 0;
      if (!rule.group) for (let i = 1; i < m.length && gi === 0; i++) if (m[i] !== undefined) gi = i;
      const idx = m.indices?.[gi];
      const secret = m[gi];
      if (!idx || secret === undefined || secret.length === 0) continue;
      if (rule.entropy && entropy(secret) < rule.entropy) continue;
      if (allowed(rule, secret, m[0], text, idx[0], idx[1])) continue;
      out.push({ start: idx[0], end: idx[1], ruleId: rule.id });
    }
  }
  return out;
}
