// CLI commands for policy and approvals. Owner: p2-policy. Registered in commands.ts.
// They read config.yaml and state.db directly (no vault), so they work with or without a running gateway.
import type { Database } from "bun:sqlite";
import type { Config, ProfileDef } from "../core/config.ts";
import { ensureDataDir, loadConfig } from "../core/config-store.ts";
import { paths } from "../core/paths.ts";
import { profileIds, resolveProfile } from "../core/profiles.ts";
import { type ToolAnnotations, unqualify } from "../core/types.ts";
import { SqliteApprovalStore } from "../policy/approvals.ts";
import {
  type DecideInput,
  decide,
  describeRule,
  effectiveRules,
  hasAnnotation,
  targetTrust,
} from "../policy/decide.ts";
import { TRUST_LEVELS } from "../policy/schema.ts";
import type { ApprovalRequest } from "../store/approvals.ts";
import { openDb } from "../store/db.ts";
import { type Command, EXIT_ERROR, EXIT_OK, EXIT_USAGE, type Io } from "./cli.ts";

function state(): { config: Config; db: Database } {
  const p = paths();
  ensureDataDir(p.dir);
  return { config: loadConfig(p.config), db: openDb(p.db) };
}

/** The profile's definition, or undefined after printing which profiles exist. */
function profileOrFail(config: Config, id: string, io: Io): ProfileDef | undefined {
  const found = resolveProfile(config, id);
  if (!found) io.err(`No profile named "${id}". Profiles: ${profileIds(config).join(", ")}`);
  return found?.def;
}

/** "custom #2" -> "your rule 2", "balanced #1" -> "balanced preset". */
export function ruleSource(label: string): string {
  const [kind, n] = label.split(" #");
  if (kind === "custom") return `your rule ${n}`;
  if (kind === "deny-list") return "deny list";
  if (kind === "read-only") return "read-only profile";
  if (kind === "default") return "no rule matched";
  return `${kind} preset`;
}

export function explainLines(id: string, def: ProfileDef): string[] {
  const policy = def.policy;
  const lines = [`Profile ${id}: ${policy.preset} preset. Checked in order; the first match decides.`];
  let n = 0;
  const add = (text: string, source: string) => lines.push(`  ${++n}. ${text}  (${source})`);
  if (def.deny.length)
    add(`Block tools on the deny list: ${def.deny.map((g) => `"${g}"`).join(", ")}.`, "deny list");
  if (def.readOnly) add("Block every tool that may change data.", "read-only profile");
  for (const { rule, label } of effectiveRules(policy)) {
    add(describeRule(rule), ruleSource(label));
    if (label.startsWith("custom") && rule.reason) lines.push(`     Reason shown: ${rule.reason}`);
  }
  add("Otherwise allow.", "default");
  lines.push(
    `Approval requests wait ${duration(policy.approvalTimeout * 1000)}; no answer counts as declined.`,
  );
  return lines;
}

function annotationWords(a: ToolAnnotations | undefined): string {
  const t = { annotations: a };
  if (hasAnnotation(t, "read-only")) return "only reads data";
  if (hasAnnotation(t, "destructive"))
    return a?.destructiveHint === true
      ? "may delete or overwrite data"
      : "may delete or overwrite data (its server does not say otherwise)";
  return "may change data";
}

async function explain(id: string, io: Io): Promise<number> {
  const { config, db } = state();
  db.close();
  const def = profileOrFail(config, id, io);
  if (!def) return EXIT_ERROR;
  for (const l of explainLines(id, def)) io.out(l);
  return EXIT_OK;
}

async function testCall(profileId: string, name: string, after: string[], io: Io): Promise<number> {
  const bad = after.filter((t) => !(TRUST_LEVELS as readonly string[]).includes(t));
  if (bad.length) {
    io.err(`--after must be one of ${TRUST_LEVELS.join(", ")} (got ${bad.join(", ")}).`);
    return EXIT_USAGE;
  }
  const parts = unqualify(name);
  if (!parts) {
    io.err(`Give the tool as <account>__<tool>, e.g. gmail-work__send_email.`);
    return EXIT_USAGE;
  }
  const { config, db } = state();
  try {
    const resolved = resolveProfile(config, profileId);
    if (!resolved) {
      io.err(`No profile named "${profileId}". Profiles: ${profileIds(config).join(", ")}`);
      return EXIT_ERROR;
    }
    const account = config.accounts[parts.accountId];
    if (!account) {
      io.err(
        `No account named "${parts.accountId}". Accounts: ${Object.keys(config.accounts).join(", ") || "none"}`,
      );
      return EXIT_ERROR;
    }
    if (!resolved.accounts.includes(parts.accountId)) {
      io.out(`${name}: not in profile ${profileId}, so the call fails before any rule runs.`);
      return EXIT_OK;
    }
    const row = db
      .query<{ definition: string }, [string, string]>(
        "SELECT definition FROM tool_cache WHERE account_id = ? AND tool_name = ?",
      )
      .get(parts.accountId, parts.toolName);
    const annotations = row
      ? (JSON.parse(row.definition) as { annotations?: ToolAnnotations }).annotations
      : undefined;
    const tool: DecideInput["tool"] = {
      qualifiedName: name,
      toolName: parts.toolName,
      trust: config.servers[account.server]?.trust ?? [],
      ...(annotations ? { annotations } : {}),
    };
    const d = decide({ profile: resolved.def, tool, seenTrust: new Set(after) });
    io.out(`${name} in profile ${profileId}: ${d.outcome.toUpperCase()}`);
    io.out(`Why:   ${d.reason}`);
    const n = d.rule.split(" #")[1];
    io.out(`Rule:  ${ruleSource(d.rule)}${n && !d.rule.startsWith("custom") ? `, rule ${n}` : ""}`);
    io.out(
      `Tool:  ${annotationWords(annotations)}; server trust: ${tool.trust.join(", ") || `not set, so treated as unknown (${targetTrust(tool).join(", ")})`}`,
    );
    io.out(`Seen:  ${after.length ? after.join(", ") : "nothing yet in this session"}`);
    if (!row) io.out(`Note:  this tool has not been listed yet; it was checked without annotations.`);
    return EXIT_OK;
  } finally {
    db.close();
  }
}

function withStore<T>(fn: (store: SqliteApprovalStore) => T): T {
  const { db } = state();
  try {
    return fn(new SqliteApprovalStore(db));
  } finally {
    db.close();
  }
}

export function approvalLine(r: ApprovalRequest, now = Date.now()): string {
  const age = duration(now - r.createdAt, true);
  return [r.id, r.status.padEnd(8), `${age} ago`.padEnd(10), r.profileId, r.tool, r.reason]
    .filter(Boolean)
    .join("  ");
}

export interface DecideDeps {
  /** A person at a terminal. AI clients run commands without one. */
  interactive: boolean;
  /** Asks the question; true when the person confirms. */
  confirm: (question: string) => boolean;
  /** Sends the decision to the running gateway. */
  send: (id: string, decision: "approved" | "denied") => Promise<Response>;
}

const defaultDecideDeps = (): DecideDeps => ({
  interactive: !!process.stdin.isTTY && !!process.stdout.isTTY,
  confirm: (q) => /^y(es)?$/i.test(prompt(q)?.trim() ?? ""),
  send: async (id, decision) => {
    const { adminApi } = await import("./actions.ts");
    return adminApi("POST", `/api/approvals/${encodeURIComponent(id)}`, { decision });
  },
});

/**
 * Approve or decline through the running gateway, after a person confirms at a terminal.
 * A prompt-injected AI client with a shell must not be able to approve its own call.
 */
export async function decideApproval(
  id: string,
  decision: "approved" | "denied",
  io: Io,
  deps: DecideDeps = defaultDecideDeps(),
): Promise<number> {
  if (!deps.interactive) {
    io.err(
      "Approvals need a person: answer in the web UI (Approvals), or run this command yourself in a terminal.",
    );
    return EXIT_ERROR;
  }
  const req = withStore((store) => store.get(id));
  if (!req) {
    io.err(`No approval request with id ${id}. See: pmcpg approvals list`);
    return EXIT_ERROR;
  }
  if (req.status !== "pending") {
    io.err(`Approval request ${id} is already ${req.status}.`);
    return EXIT_ERROR;
  }
  const verb = decision === "approved" ? "Approve" : "Decline";
  if (!deps.confirm(`${verb} ${req.tool} for profile ${req.profileId}? ${req.reason} [y/N] `)) {
    io.out("Nothing changed.");
    return EXIT_OK;
  }
  let res: Response;
  try {
    res = await deps.send(id, decision);
  } catch {
    io.err("The gateway is not running, so no call is waiting for this answer.");
    return EXIT_ERROR;
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    io.err(body.error ?? `The gateway refused the answer (HTTP ${res.status}).`);
    return EXIT_ERROR;
  }
  io.out(`${decision === "approved" ? "Approved" : "Declined"}: ${req.tool} (${id}).`);
  return EXIT_OK;
}

/** "2 minutes", "45 seconds"; short form "2m", "45s", "3h". */
export function duration(ms: number, short = false): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const [n, unit] =
    s >= 3600 ? [Math.floor(s / 3600), "hour"] : s >= 60 ? [Math.floor(s / 60), "minute"] : [s, "second"];
  if (short) return `${n}${unit[0]}`;
  return `${n} ${unit}${n === 1 ? "" : "s"}`;
}

const approve = (id: string, io: Io) => decideApproval(id, "approved", io);
const deny = (id: string, io: Io) => decideApproval(id, "denied", io);

export const policyCommands: Command[] = [
  {
    path: ["policy", "explain"],
    summary: "Show a profile's approval rules in plain words, in the order they run",
    args: "<profile>",
    minArgs: 1,
    maxArgs: 1,
    run: (p, io) => explain(p.positionals[0] as string, io),
  },
  {
    path: ["policy", "test"],
    summary: "Dry run: which rule decides a call, and why",
    args: "<profile> <account>__<tool> [--after <trust>]...",
    options: { after: { type: "string", multiple: true } },
    optionHelp: { after: `Pretend the session has read a result of this trust (${TRUST_LEVELS.join(", ")})` },
    minArgs: 2,
    maxArgs: 2,
    run: (p, io) => {
      const after = Array.isArray(p.values.after) ? p.values.after.map(String) : [];
      return testCall(p.positionals[0] as string, p.positionals[1] as string, after, io);
    },
  },
  {
    path: ["approvals", "list"],
    summary: "List approval requests waiting for an answer",
    args: "[--all]",
    options: { all: { type: "boolean" } },
    optionHelp: { all: "Include answered and expired requests (last 50)" },
    run: (p, io) =>
      withStore((store) => {
        const rows = store.list(p.values.all ? { limit: 50 } : { status: "pending" });
        if (rows.length === 0) {
          io.out(p.values.all ? "No approval requests yet." : "No approval requests waiting.");
          return EXIT_OK;
        }
        for (const r of rows) io.out(approvalLine(r));
        return EXIT_OK;
      }),
  },
  {
    path: ["approvals", "approve"],
    summary: "Approve a waiting call",
    args: "<id>",
    minArgs: 1,
    maxArgs: 1,
    run: (p, io) => approve(p.positionals[0] as string, io),
  },
  {
    path: ["approvals", "deny"],
    summary: "Decline a waiting call",
    args: "<id>",
    minArgs: 1,
    maxArgs: 1,
    run: (p, io) => deny(p.positionals[0] as string, io),
  },
];
