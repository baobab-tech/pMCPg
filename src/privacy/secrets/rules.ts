// Secret rules: vendored gitleaks rules plus a few of our own, compiled once.
import { GITLEAKS_RULES } from "./gitleaks-rules.ts";

export interface RawAllowlist {
  /** [source, flags] pairs. */
  regexes?: [string, string][];
  /** What the allowlist regexes test: the secret (default), the whole match, or the line. */
  target?: "match" | "line";
  /** Lowercase; the secret is allowed when it contains one. */
  stopwords?: string[];
}

export interface RawRule {
  id: string;
  re: string;
  flags: string;
  /** Lowercase keywords; the rule runs only when the text contains one. */
  kw?: string[];
  /** Minimum Shannon entropy of the secret. */
  entropy?: number;
  /** Capture group holding the secret. Default: the first group that matched, else the whole match. */
  group?: number;
  allow?: RawAllowlist[];
}

/** Rules gitleaks does not cover, or covers only inside files. */
const LOCAL_RULES: RawRule[] = [
  {
    // scheme://user:password@host, e.g. database URLs. The password is the secret.
    id: "url-credentials",
    re: "\\b[a-z][a-z0-9+.-]{1,20}://[^\\s:/@\"'<>]{1,64}:([^\\s@/\"'<>]{3,128})@[a-z0-9.-]+",
    flags: "i",
    kw: ["://"],
    allow: [
      { regexes: [["^(?:\\*+|x+|password|pass|secret|\\$\\{?\\w+\\}?|<[^>]*>|\\{\\{.*\\}\\})$", "i"]] },
    ],
  },
  {
    // A password in a labelled field: "password: hunter2!", "mot de passe : ...".
    id: "labelled-password",
    re: "(?:\\bpassword|\\bpasswd|\\bpwd|mot de passe|contraseña|passwort|nenosiri)[ \\t]*[:=][ \\t]*[\"']?([^\\s\"']{6,128})",
    flags: "i",
    kw: ["password", "passwd", "pwd", "mot de passe", "contraseña", "passwort", "nenosiri"],
    allow: [
      {
        regexes: [
          ["^(?:\\*+|x+|•+|null|none|undefined|true|false|\\$\\{?\\w+\\}?|<[^>]*>|\\[[A-Z_]+\\])$", "i"],
        ],
      },
    ],
  },
];

export interface Rule {
  id: string;
  re: RegExp;
  kw?: string[];
  entropy?: number;
  group?: number;
  allow: { regexes: RegExp[]; target: "secret" | "match" | "line"; stopwords: string[] }[];
}

function compile(r: RawRule): Rule {
  return {
    id: r.id,
    re: new RegExp(r.re, `${r.flags}gd`),
    kw: r.kw,
    entropy: r.entropy,
    group: r.group,
    allow: (r.allow ?? []).map((a) => ({
      regexes: (a.regexes ?? []).map(([s, f]) => new RegExp(s, f)),
      target: a.target ?? "secret",
      stopwords: a.stopwords ?? [],
    })),
  };
}

let compiled: Rule[] | undefined;

/** All rules, compiled on first use. */
export function secretRules(): Rule[] {
  compiled ??= [...GITLEAKS_RULES, ...LOCAL_RULES].map(compile);
  return compiled;
}
