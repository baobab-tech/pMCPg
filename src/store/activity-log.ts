// ActivityLog on state.db (table activity). Payloads are AES-256-GCM with the data key; the AAD binds each
// payload to its row's plain columns (time, type, profile, account), so rows cannot be edited or swapped.
import type { Database } from "bun:sqlite";
import { decrypt, encrypt } from "../core/crypto.ts";
import { unqualify } from "../core/types.ts";
import type { ActivityEntry, ActivityLog, ActivityQuery } from "./activity.ts";
import type { GatewayEvent } from "./events.ts";

export const DEFAULT_RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;
const DEFAULT_LIMIT = 100;

type Kind = "string" | "number" | "pid";
interface FieldSpec {
  required: Record<string, Kind | readonly string[]>;
  optional?: Record<string, Kind | "nullable-number">;
}

// Every field each event type may carry. Anything else is rejected, so argument and result values
// cannot slip into the log through an extra field.
const SPEC: Record<GatewayEvent["type"], FieldSpec> = {
  search: { required: { profileId: "string", query: "string", results: "number", ms: "number" } },
  call: {
    required: {
      profileId: "string",
      tool: "string",
      outcome: ["ok", "error", "denied", "approval-required"],
      masked: "number",
      ms: "number",
    },
    optional: { errorCode: "string" },
  },
  "account-state": { required: { accountId: "string", status: "string" }, optional: { reason: "string" } },
  "tools-changed": {
    required: { accountId: "string", added: "number", removed: "number", changed: "number" },
  },
  "token-refreshed": { required: { accountId: "string" } },
  "token-rotated": {
    required: { token: ["client", "admin"], via: ["cli", "ui"] },
    optional: { profileId: "string" },
  },
  "server-spawned": { required: { accountId: "string", pid: "pid" } },
  "server-exited": { required: { accountId: "string" }, optional: { code: "nullable-number" } },
  "privacy-reset": {
    required: { sessions: "number", placeholders: "number" },
    optional: { profileId: "string" },
  },
};

/** Longest string field kept. Longer values are rejected: names and reasons are short. */
const MAX_STRING = 1000;

/** Returns a copy holding only the allowed fields. Throws on unknown types, unknown fields or wrong value types. */
export function sanitizeEvent(e: unknown): GatewayEvent {
  if (!e || typeof e !== "object" || Array.isArray(e)) throw new Error("activity event must be an object");
  const raw = e as Record<string, unknown>;
  const type = raw.type;
  if (typeof type !== "string" || !Object.hasOwn(SPEC, type))
    throw new Error("activity event has an unknown type");
  const spec = SPEC[type as GatewayEvent["type"]];
  const out: Record<string, unknown> = { type };
  for (const key of Object.keys(raw)) {
    if (key === "type") continue;
    const kind = spec.required[key] ?? spec.optional?.[key];
    if (!kind) throw new Error(`activity event "${type}" has an unexpected field "${key}"`);
    const v = raw[key];
    if (v === undefined && !(key in spec.required)) continue;
    if (!valid(kind, v)) throw new Error(`activity event "${type}" has an invalid "${key}"`);
    out[key] = v;
  }
  for (const key of Object.keys(spec.required))
    if (!(key in out)) throw new Error(`activity event "${type}" is missing "${key}"`);
  return out as GatewayEvent;
}

function valid(kind: Kind | "nullable-number" | readonly string[], v: unknown): boolean {
  if (Array.isArray(kind)) return kind.includes(v as string);
  switch (kind) {
    case "string":
      return typeof v === "string" && v.length <= MAX_STRING;
    case "number":
      return typeof v === "number" && Number.isFinite(v);
    case "pid":
      return typeof v === "number" && Number.isInteger(v);
    case "nullable-number":
      return v === null || (typeof v === "number" && Number.isFinite(v));
  }
  return false;
}

/** Profile and account columns, kept in plain text for filtering. A call's account comes from its tool name. */
export function eventColumns(e: GatewayEvent): { profileId: string | null; accountId: string | null } {
  if (e.type === "search") return { profileId: e.profileId, accountId: null };
  if (e.type === "call") return { profileId: e.profileId, accountId: unqualify(e.tool)?.accountId ?? null };
  if (e.type === "token-rotated") return { profileId: e.profileId ?? null, accountId: null };
  if (e.type === "privacy-reset") return { profileId: e.profileId ?? null, accountId: null };
  return { profileId: null, accountId: e.accountId };
}

const aad = (at: number, type: string, profileId: string | null, accountId: string | null) =>
  `activity:${at}:${type}:${profileId ?? ""}:${accountId ?? ""}`;

interface Row {
  id: number;
  at: number;
  type: string;
  profile_id: string | null;
  account_id: string | null;
  payload: Uint8Array<ArrayBuffer>;
}

export class SqliteActivityLog implements ActivityLog {
  private readonly listeners = new Set<(e: ActivityEntry) => void>();
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly db: Database,
    private readonly key: CryptoKey,
    private readonly now: () => number = Date.now,
    private readonly onError: (e: Error) => void = (e) =>
      process.stderr.write(`pmcpg: activity log write failed: ${e.message}\n`),
  ) {}

  /** Validates synchronously (throws on a bad event), then encrypts and writes in order. */
  emit(event: GatewayEvent): void {
    const clean = sanitizeEvent(event);
    const at = this.now();
    this.queue = this.queue.then(() => this.write(at, clean)).catch((e: Error) => this.onError(e));
  }

  /** Resolves once every emitted event is written. */
  flush(): Promise<void> {
    return this.queue;
  }

  private async write(at: number, e: GatewayEvent): Promise<void> {
    const { profileId, accountId } = eventColumns(e);
    const payload = await encrypt(this.key, JSON.stringify(e), aad(at, e.type, profileId, accountId));
    const r = this.db.run(
      "INSERT INTO activity (at, type, profile_id, account_id, payload) VALUES (?, ?, ?, ?, ?)",
      [at, e.type, profileId, accountId, payload],
    );
    const entry: ActivityEntry = { id: Number(r.lastInsertRowid), at, event: e };
    for (const l of this.listeners) {
      try {
        l(entry);
      } catch {
        // A failing listener must not stop the log or other listeners.
      }
    }
  }

  /** Newest first. */
  async query(q: ActivityQuery & { afterId?: number } = {}): Promise<ActivityEntry[]> {
    const where: string[] = [];
    const args: (string | number)[] = [];
    const add = (sql: string, v: string | number | undefined) => {
      if (v === undefined) return;
      where.push(sql);
      args.push(v);
    };
    add("at >= ?", q.since);
    add("at < ?", q.before);
    add("type = ?", q.type);
    add("profile_id = ?", q.profileId);
    add("account_id = ?", q.accountId);
    add("id > ?", q.afterId);
    const limit = Math.max(1, Math.min(q.limit ?? DEFAULT_LIMIT, 10_000));
    const rows = this.db
      .query<Row, (string | number)[]>(
        `SELECT * FROM activity ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ${limit}`,
      )
      .all(...args);
    return Promise.all(
      rows.map(async (r) => ({
        id: r.id,
        at: r.at,
        event: JSON.parse(
          await decrypt(this.key, r.payload, aad(r.at, r.type, r.profile_id, r.account_id)),
        ) as GatewayEvent,
      })),
    );
  }

  prune(retentionDays: number = DEFAULT_RETENTION_DAYS): number {
    if (!Number.isFinite(retentionDays) || retentionDays < 0)
      throw new Error("retention must be 0 or more days");
    return this.db.run("DELETE FROM activity WHERE at < ?", [this.now() - retentionDays * DAY_MS]).changes;
  }

  subscribe(listener: (e: ActivityEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
