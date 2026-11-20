// CLI commands for the activity log and tool pinning. Owner: p2-pinning-log. Registered in commands.ts.
// They read state.db directly, so they work whether or not the gateway is running.
import { unqualify } from "../core/types.ts";
import { openState } from "../gateway/runtime.ts";
import { diffTool, formatDiff } from "../pinning/diff.ts";
import { SqlitePinStore } from "../pinning/store.ts";
import type { ActivityEntry } from "../store/activity.ts";
import { DEFAULT_RETENTION_DAYS, SqliteActivityLog } from "../store/activity-log.ts";
import type { GatewayEvent } from "../store/events.ts";
import { getDataKey } from "../vault/select.ts";
import { type Command, EXIT_OK, EXIT_USAGE, type Io } from "./cli.ts";

const EVENT_TYPES: GatewayEvent["type"][] = [
  "search",
  "call",
  "account-state",
  "tools-changed",
  "token-refreshed",
  "token-rotated",
  "server-spawned",
  "server-exited",
  "privacy-reset",
];

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** One line per event: time, type, then names, counts and outcomes. */
export function formatEntry(e: ActivityEntry): string {
  const ev = e.event;
  const time = new Date(e.at).toISOString();
  const detail = (() => {
    switch (ev.type) {
      case "search":
        return `${ev.profileId} "${ev.query}" results=${ev.results} ${ev.ms}ms`;
      case "call":
        return `${ev.profileId} ${ev.tool} ${ev.outcome}${ev.errorCode ? ` (${ev.errorCode})` : ""} masked=${ev.masked} ${ev.ms}ms`;
      case "account-state":
        return `${ev.accountId} ${ev.status}${ev.reason ? `: ${ev.reason}` : ""}`;
      case "tools-changed":
        return `${ev.accountId} added=${ev.added} removed=${ev.removed} changed=${ev.changed}`;
      case "token-refreshed":
        return ev.accountId;
      case "token-rotated":
        return `${ev.token === "admin" ? "admin" : `client ${ev.profileId ?? ""}`} via ${ev.via}`;
      case "server-spawned":
        return `${ev.accountId} pid=${ev.pid}`;
      case "server-exited":
        return `${ev.accountId} code=${ev.code ?? "none"}`;
      case "privacy-reset":
        return `${ev.profileId ?? "all profiles"} sessions=${ev.sessions} placeholders=${ev.placeholders}`;
    }
  })();
  return `${time}  ${ev.type.padEnd(14)}${detail}`;
}

export interface TailOptions {
  type?: GatewayEvent["type"];
  profileId?: string;
  limit: number;
  json: boolean;
  /** Keep printing new entries until aborted. */
  follow?: AbortSignal;
  pollMs?: number;
}

/** Print the last `limit` entries oldest first, then poll for new ones while following. */
export async function tail(log: SqliteActivityLog, io: Io, o: TailOptions): Promise<void> {
  const filter = { type: o.type, profileId: o.profileId };
  const print = (e: ActivityEntry) =>
    io.out(o.json ? JSON.stringify({ id: e.id, at: e.at, ...e.event }) : formatEntry(e));
  const first = await log.query({ ...filter, limit: o.limit });
  let last = first[0]?.id ?? 0;
  for (const e of first.reverse()) print(e);
  const signal = o.follow;
  while (signal && !signal.aborted) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, o.pollMs ?? 1000);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
    if (signal.aborted) break;
    const fresh = await log.query({ ...filter, afterId: last, limit: 10_000 });
    for (const e of fresh.reverse()) {
      print(e);
      last = e.id;
    }
  }
}

async function withState<T>(fn: (s: Awaited<ReturnType<typeof openState>>) => Promise<T>): Promise<T> {
  const s = await openState();
  try {
    return await fn(s);
  } finally {
    s.db.close();
  }
}

function toolArg(name: string, io: Io): { accountId: string; toolName: string } | undefined {
  const ref = unqualify(name);
  if (!ref) io.err(`Expected <account>__<tool>, got "${name}"`);
  return ref;
}

export const logCommands: Command[] = [
  {
    path: ["log", "tail"],
    summary: "Show recent activity (searches, calls, account changes)",
    args: "[--follow] [--type <type>] [--profile <name>] [--limit <n>] [--json]",
    options: {
      follow: { type: "boolean", short: "f" },
      type: { type: "string" },
      profile: { type: "string" },
      limit: { type: "string" },
      json: { type: "boolean" },
    },
    optionHelp: {
      follow: "Keep printing new activity until Ctrl+C",
      type: `Only this event type: ${EVENT_TYPES.join(", ")}`,
      profile: "Only searches and calls of this profile",
      limit: "How many recent entries to show (default 50)",
      json: "Print JSON lines",
    },
    run: async (p, io) => {
      const type = str(p.values.type);
      if (type && !EVENT_TYPES.includes(type as GatewayEvent["type"])) {
        io.err(`Unknown event type "${type}". Use one of: ${EVENT_TYPES.join(", ")}`);
        return EXIT_USAGE;
      }
      const limit = p.values.limit === undefined ? 50 : Number(p.values.limit);
      if (!Number.isInteger(limit) || limit < 1) {
        io.err("--limit must be a positive whole number");
        return EXIT_USAGE;
      }
      return withState(async ({ db, vault }) => {
        const log = new SqliteActivityLog(db, await getDataKey(vault));
        const stop = new AbortController();
        const onSignal = () => stop.abort();
        if (p.values.follow) {
          process.once("SIGINT", onSignal);
          process.once("SIGTERM", onSignal);
        }
        try {
          await tail(log, io, {
            type: type as GatewayEvent["type"] | undefined,
            profileId: str(p.values.profile),
            limit,
            json: p.values.json === true,
            ...(p.values.follow ? { follow: stop.signal } : {}),
          });
        } finally {
          process.off("SIGINT", onSignal);
          process.off("SIGTERM", onSignal);
        }
        return EXIT_OK;
      });
    },
  },
  {
    path: ["log", "prune"],
    summary: "Delete activity older than the retention period",
    args: "[--days <n>]",
    options: { days: { type: "string" } },
    optionHelp: { days: `Keep this many days (default ${DEFAULT_RETENTION_DAYS})` },
    run: async (p, io) => {
      const days = p.values.days === undefined ? DEFAULT_RETENTION_DAYS : Number(p.values.days);
      if (!Number.isFinite(days) || days < 0) {
        io.err("--days must be 0 or more");
        return EXIT_USAGE;
      }
      return withState(async ({ db, vault }) => {
        const removed = new SqliteActivityLog(db, await getDataKey(vault)).prune(days);
        io.out(`Removed ${removed} ${removed === 1 ? "entry" : "entries"} older than ${days} days.`);
        return EXIT_OK;
      });
    },
  },
  {
    path: ["tools", "review"],
    summary: "List quarantined tools (new or changed since approved) with what changed",
    args: "[<account>]",
    maxArgs: 1,
    run: (p, io) =>
      withState(async ({ db }) => {
        const held = new SqlitePinStore(db).quarantined(p.positionals[0]);
        if (held.length === 0) {
          io.out("No tools waiting for review.");
          return EXIT_OK;
        }
        for (const q of held) {
          io.out(`${q.accountId}__${q.toolName} (${q.reason === "new" ? "new tool" : "changed"})`);
          io.out(indent(formatDiff(diffTool(q.pinned, q.current))));
          io.out("");
        }
        io.out("Approve with `pmcpg tools approve <account>__<tool>`, or hide with `pmcpg tools reject`.");
        return EXIT_OK;
      }),
  },
  {
    path: ["tools", "approve"],
    summary: "Approve a quarantined tool so it shows up in search",
    args: "<account>__<tool>",
    minArgs: 1,
    maxArgs: 1,
    run: (p, io) => decide(p.positionals[0] as string, io, "approve"),
  },
  {
    path: ["tools", "reject"],
    summary: "Keep a quarantined tool hidden until it changes again",
    args: "<account>__<tool>",
    minArgs: 1,
    maxArgs: 1,
    run: (p, io) => decide(p.positionals[0] as string, io, "reject"),
  },
];

function decide(name: string, io: Io, action: "approve" | "reject"): Promise<number> {
  const ref = toolArg(name, io);
  if (!ref) return Promise.resolve(EXIT_USAGE);
  return withState(async ({ db }) => {
    const pins = new SqlitePinStore(db);
    pins[action](ref.accountId, ref.toolName);
    io.out(action === "approve" ? `Approved ${name}.` : `Rejected ${name}; it stays hidden.`);
    return EXIT_OK;
  });
}

const indent = (s: string) =>
  s
    .split("\n")
    .map((l) => `  ${l}`)
    .join("\n");
