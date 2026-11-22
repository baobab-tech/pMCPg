// Converts gitleaks' config/gitleaks.toml (MIT) into src/privacy/secrets/gitleaks-rules.ts.
// Dev tool, not part of the binary. Usage:
//   curl -sSLO https://raw.githubusercontent.com/gitleaks/gitleaks/<sha>/config/gitleaks.toml
//   bun src/privacy/secrets/gen-gitleaks.ts gitleaks.toml <sha> && bunx biome format --write src/privacy/secrets
// Rules scoped to file paths are dropped (the gateway scans text, not files).
// Go RE2 syntax is rewritten to JavaScript; rules that still fail to compile are dropped and reported.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface TomlAllowlist {
  regexes?: string[];
  regexTarget?: "secret" | "match" | "line";
  stopwords?: string[];
  paths?: string[];
  condition?: string;
}
interface TomlRule {
  id: string;
  regex?: string;
  entropy?: number;
  keywords?: string[];
  secretGroup?: number;
  path?: string;
  allowlists?: TomlAllowlist[];
}

const POSIX: Record<string, string> = {
  alnum: "a-zA-Z0-9",
  alpha: "a-zA-Z",
  digit: "0-9",
  lower: "a-z",
  upper: "A-Z",
  space: "\\s",
  xdigit: "0-9a-fA-F",
  word: "\\w",
  punct: "!-\\/:-@\\[-`{-~",
};

/** Index of the end of the current alternative: next top-level `|` or the closing `)` of the enclosing group. */
function alternativeEnd(src: string, from: number): number {
  let depth = 0;
  let inClass = false;
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      i++;
      continue;
    }
    if (inClass) {
      if (c === "]") inClass = false;
      continue;
    }
    if (c === "[") {
      inClass = true;
      if (src[i + 1] === "]") i++;
    } else if (c === "(") depth++;
    else if (c === ")") {
      if (depth === 0) return i;
      depth--;
    } else if (c === "|" && depth === 0) return i;
  }
  return src.length;
}

/** Rewrites Go RE2 syntax to JavaScript. Returns the source and flags. */
export function goToJs(go: string): { source: string; flags: string } {
  let src = go;
  let flags = "";
  const lead = /^\(\?([a-z]+)\)/.exec(src);
  if (lead?.[1]) {
    for (const f of lead[1]) if ("ims".includes(f) && !flags.includes(f)) flags += f;
    src = src.slice(lead[0].length);
  }
  src = src.replace(/\[:(\w+):\]/g, (m, name: string) => POSIX[name] ?? m);
  src = src
    .replace(/\\z/g, "$")
    .replace(/\\A/g, "^")
    .replace(/\(\?P</g, "(?<");
  // Mid-pattern (?i): scope it to the rest of the current alternative.
  for (let i = src.indexOf("(?i)"); i !== -1; i = src.indexOf("(?i)")) {
    const end = alternativeEnd(src, i + 4);
    src = `${src.slice(0, i)}(?i:${src.slice(i + 4, end)})${src.slice(end)}`;
  }
  // (?s:...) groups: JavaScript has no inline s modifier support in all engines; expand the dot.
  src = src.replace(/\(\?s:\.\)/g, "[\\s\\S]");
  return { source: src, flags };
}

/**
 * An allowlist entry that is a plain literal matching its own rule is a sample key (gitleaks lists
 * public example keys this way). Inserts an empty group after the 4th character so the repo holds no
 * key-shaped string for secret scanners to flag. The regex matches exactly the same text.
 */
export function defangLiteral(source: string, rule: RegExp): string {
  if (!/^[\w-]{8,}$/.test(source) || !rule.test(source)) return source;
  return `${source.slice(0, 4)}(?:)${source.slice(4)}`;
}

function compiles(source: string, flags: string): boolean {
  try {
    new RegExp(source, `${flags}d`);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const [file, sha = "master"] = process.argv.slice(2);
  if (!file) {
    console.error("Usage: bun src/privacy/secrets/gen-gitleaks.ts <gitleaks.toml> [sha]");
    process.exit(2);
  }
  const toml = Bun.TOML.parse(await Bun.file(file).text()) as { rules: TomlRule[] };
  const out: unknown[] = [];
  const dropped: string[] = [];
  for (const r of toml.rules) {
    if (!r.regex || r.path) {
      dropped.push(`${r.id} (path-scoped or no regex)`);
      continue;
    }
    const { source, flags } = goToJs(r.regex);
    if (!compiles(source, flags)) {
      dropped.push(`${r.id} (does not compile)`);
      continue;
    }
    const ruleRe = new RegExp(source, flags);
    const allow: { regexes?: [string, string][]; target?: string; stopwords?: string[] }[] = [];
    for (const a of r.allowlists ?? []) {
      if (a.paths && a.condition === "AND") continue;
      if (!a.regexes && !a.stopwords) continue;
      const regexes = (a.regexes ?? []).map((x) => goToJs(x)).filter((x) => compiles(x.source, x.flags));
      allow.push({
        ...(regexes.length
          ? { regexes: regexes.map((x) => [defangLiteral(x.source, ruleRe), x.flags] as [string, string]) }
          : {}),
        ...(a.regexTarget && a.regexTarget !== "secret" ? { target: a.regexTarget } : {}),
        ...(a.stopwords?.length ? { stopwords: a.stopwords.map((s) => s.toLowerCase()) } : {}),
      });
    }
    out.push({
      id: r.id,
      re: source,
      flags,
      ...(r.keywords?.length ? { kw: r.keywords.map((k) => k.toLowerCase()) } : {}),
      ...(r.entropy ? { entropy: r.entropy } : {}),
      ...(r.secretGroup ? { group: r.secretGroup } : {}),
      ...(allow.length ? { allow } : {}),
    });
  }

  const header = `// GENERATED by src/privacy/secrets/gen-gitleaks.ts from gitleaks config/gitleaks.toml @ ${sha}. Do not edit.
  // ${out.length} rules. Source: https://github.com/gitleaks/gitleaks
  //
  // MIT License
  //
  // Copyright (c) 2019 Zachary Rice
  //
  // Permission is hereby granted, free of charge, to any person obtaining a copy
  // of this software and associated documentation files (the "Software"), to deal
  // in the Software without restriction, including without limitation the rights
  // to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  // copies of the Software, and to permit persons to whom the Software is
  // furnished to do so, subject to the following conditions:
  //
  // The above copyright notice and this permission notice shall be included in all
  // copies or substantial portions of the Software.
  //
  // THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  // IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  // FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  // AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  // LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  // OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  // SOFTWARE.
  /** biome-ignore-all lint/suspicious/noTemplateCurlyInString: regex sources, not templates */
  import type { RawRule } from "./rules.ts";

  export const GITLEAKS_RULES: RawRule[] = `;

  const target = join(import.meta.dir, "gitleaks-rules.ts");
  writeFileSync(target, `${header}${JSON.stringify(out, null, 1)};\n`);
  console.log(`Wrote ${out.length} rules to ${target}`);
  for (const d of dropped) console.log(`dropped: ${d}`);
}

if (import.meta.main) await main();
