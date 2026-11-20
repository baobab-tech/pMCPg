// CLI commands for privacy. Owner: p2-privacy. Registered in commands.ts.
import { PrivacyLevel } from "../core/config.ts";
import type { PiiType } from "../privacy/detector.ts";
import { type Finding, findPii, LEVEL_TYPES, mergeSpans, patternsFor } from "../privacy/detectors.ts";
import { applySpans, newSession } from "../privacy/mask.ts";
import { secretRules } from "../privacy/secrets/rules.ts";
import { findSecrets } from "../privacy/secrets/scan.ts";
import { type Command, EXIT_ERROR, EXIT_OK, EXIT_USAGE, type Io } from "./cli.ts";

const TYPE_WORDS: Record<PiiType, string> = {
  EMAIL: "Email addresses",
  PHONE: "Phone numbers",
  CARD: "Payment card numbers",
  IBAN: "Bank account numbers (IBAN)",
  IP: "IP addresses",
  NATIONAL_ID: "Government ID numbers",
  PERSON: "Names of people",
  ORG: "Names of organisations",
  ADDRESS: "Postal addresses",
  SECRET: "Secrets (API keys, tokens, passwords, private keys)",
};

async function readInput(arg: string): Promise<string> {
  if (arg === "-") return Bun.stdin.text();
  if (arg.startsWith("@")) {
    const file = Bun.file(arg.slice(1));
    if (!(await file.exists())) throw new Error(`No such file: ${arg.slice(1)}`);
    return file.text();
  }
  return arg;
}

function table(rows: string[][]): string[] {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? "").length))) ?? [];
  return rows.map((r) =>
    r
      .map((c, i) => c.padEnd(widths[i] ?? 0))
      .join("  ")
      .trimEnd(),
  );
}

const check: Command = {
  path: ["privacy", "check"],
  summary: "Show what masking would do to some text",
  args: "<text|-|@file>",
  minArgs: 1,
  maxArgs: 1,
  options: { level: { type: "string", short: "l" } },
  optionHelp: { level: "standard (default) or strict" },
  async run(p, io) {
    const level = PrivacyLevel.safeParse(p.values.level ?? "standard");
    if (!level.success || level.data === "off") {
      io.err("--level must be standard or strict");
      return EXIT_USAGE;
    }
    const text = await readInput(p.positionals[0] ?? "");
    const findings: Finding[] = [
      ...findSecrets(text).map((s) => ({ ...s, type: "SECRET" as const, confidence: 0.95, rule: s.ruleId })),
      ...findPii(text, level.data),
    ];
    const kept = mergeSpans(findings);
    io.out(applySpans(text, kept, newSession(), "result", []).replace(/\n$/, ""));
    io.out("");
    if (!kept.length) {
      io.out(`Nothing found at level ${level.data}.`);
      return EXIT_OK;
    }
    const byType = new Map<string, { count: number; rules: Set<string> }>();
    for (const f of kept) {
      const e = byType.get(f.type) ?? { count: 0, rules: new Set() };
      e.count++;
      e.rules.add(f.rule);
      byType.set(f.type, e);
    }
    const rows = [["TYPE", "COUNT", "FOUND BY"]];
    for (const [type, e] of [...byType].sort((a, b) => b[1].count - a[1].count))
      rows.push([type, String(e.count), [...e.rules].sort().join(", ")]);
    for (const line of table(rows)) io.out(line);
    io.out("");
    io.out(
      "Pattern matching misses some values and masks some ordinary text. It reduces exposure; it is not anonymity.",
    );
    return EXIT_OK;
  },
};

const explain: Command = {
  path: ["privacy", "explain"],
  summary: "List what each privacy level masks",
  async run(_p, io) {
    const lines: string[] = [
      "Privacy levels (set per profile with `privacy: off | standard | strict`):",
      "",
      "off       Nothing is masked. Secrets are still redacted.",
      "",
    ];
    for (const level of ["standard", "strict"] as const) {
      lines.push(
        level === "standard"
          ? "standard  Contact details, financial and government identifiers:"
          : "strict    Everything in standard, plus names, organisations and addresses where a label or",
      );
      if (level === "strict")
        lines.push("          the layout makes them reliable (free-text names need a future local model):");
      const types = LEVEL_TYPES[level].filter(
        (t) => level === "standard" || !LEVEL_TYPES.standard.includes(t),
      );
      for (const type of types) {
        lines.push(`          - ${TYPE_WORDS[type]}`);
        for (const pat of patternsFor(level).filter((x) => x.type === type && x.about !== TYPE_WORDS[type]))
          lines.push(`              ${pat.about}`);
      }
      lines.push("");
    }
    lines.push(
      `Every level  ${TYPE_WORDS.SECRET}: ${secretRules().length} rules from gitleaks plus our own.`,
      "             Redacted as [SECRET_REDACTED] in results and blocked in tool arguments; never restored.",
      "",
      "Masked values become placeholders such as [EMAIL_1]. The same value keeps the same placeholder for the",
      "whole session, and the gateway puts real values back when the AI uses a placeholder in a tool call.",
      "Try it: pmcpg privacy check --level strict 'Name: Jane Doe, phone +44 20 7946 0958'",
    );
    for (const l of lines) io.out(l);
    return EXIT_OK;
  },
};

/** Sends the reset to the running gateway's admin API. */
export type ResetSend = (profile: string | undefined) => Promise<Response>;

const defaultSend: ResetSend = async (profile) => {
  const { adminApi } = await import("./actions.ts");
  return adminApi("POST", "/api/privacy/reset", profile === undefined ? {} : { profile });
};

/** Forgets masked values in the running gateway, which holds them only in memory. */
export async function resetPrivacy(
  profile: string | undefined,
  io: Io,
  send: ResetSend = defaultSend,
): Promise<number> {
  let res: Response;
  try {
    res = await send(profile);
  } catch {
    io.err("The gateway is not running, so it holds no masked values.");
    return EXIT_ERROR;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    io.err(body.error ?? `The gateway refused the reset (HTTP ${res.status}).`);
    return EXIT_ERROR;
  }
  const r = (await res.json()) as { sessions: number; placeholders: number };
  io.out(
    `Forgot ${r.placeholders} masked value(s) in ${r.sessions} session(s)${profile ? ` of profile ${profile}` : ""}.`,
  );
  io.out("Chats that still hold old placeholders can no longer use them.");
  return EXIT_OK;
}

const reset: Command = {
  path: ["privacy", "reset"],
  summary: "Forget masked values, so old placeholders no longer restore",
  options: { profile: { type: "string", short: "p" } },
  optionHelp: { profile: "Only this profile (default: every profile)" },
  maxArgs: 0,
  run: (p, io) => resetPrivacy(typeof p.values.profile === "string" ? p.values.profile : undefined, io),
};

export const privacyCommands: Command[] = [check, explain, reset];
