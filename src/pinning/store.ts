// PinStore on state.db (tables tool_pins, tool_pin_accounts, tool_quarantine).
// Trust on first use: the first listing of an account pins every tool. After that, a new tool or a tool
// whose hash changed is quarantined until approved. A rejected version stays hidden until it changes again.
import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import type { DownstreamTool } from "../connectors/connector.ts";
import type { PinStore, QuarantinedTool } from "./pins.ts";

/**
 * SHA-256 of everything the model or the policy sees: name, title, description, input schema and
 * annotations, as JSON with sorted keys. Annotations matter because policy trusts `readOnlyHint` and
 * `destructiveHint`; without them a server could relabel a pinned tool as read-only.
 * Same formula as the tool catalogue's hash.
 */
export function pinHash(t: DownstreamTool): string {
  return createHash("sha256")
    .update(
      canonicalJson({
        name: t.name,
        title: t.title ?? "",
        description: t.description ?? "",
        inputSchema: t.inputSchema,
        annotations: t.annotations ?? {},
      }),
    )
    .digest("hex");
}

/** The hash before annotations and title were included. Only used to upgrade old pins. */
function legacyPinHash(t: DownstreamTool): string {
  return createHash("sha256")
    .update(JSON.stringify({ name: t.name, description: t.description ?? "", inputSchema: t.inputSchema }))
    .digest("hex");
}

/** JSON with object keys sorted at every level, so key order never changes a hash. */
export function canonicalJson(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      return Object.fromEntries(
        Object.keys(o)
          .sort()
          .map((k) => [k, sort(o[k])]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

interface PinRow {
  tool_name: string;
  hash: string;
  definition: string | null;
}

interface QuarantineRow {
  account_id: string;
  tool_name: string;
  hash: string;
  definition: string;
  status: "pending" | "rejected";
}

const parse = (s: string | null) => (s ? (JSON.parse(s) as DownstreamTool) : undefined);

export class SqlitePinStore implements PinStore {
  constructor(
    private readonly db: Database,
    private readonly now: () => number = Date.now,
  ) {}

  check(
    accountId: string,
    tools: DownstreamTool[],
  ): { allowed: DownstreamTool[]; quarantined: QuarantinedTool[] } {
    return this.db.transaction(() => {
      const at = this.now();
      if (!this.db.query("SELECT 1 FROM tool_pin_accounts WHERE account_id = ?").get(accountId)) {
        this.db.run("INSERT INTO tool_pin_accounts (account_id, pinned_at) VALUES (?, ?)", [accountId, at]);
        for (const t of tools) this.pin(accountId, t, at);
        return { allowed: [...tools], quarantined: [] };
      }

      const pins = new Map(
        this.db
          .query<PinRow, [string]>("SELECT tool_name, hash, definition FROM tool_pins WHERE account_id = ?")
          .all(accountId)
          .map((r) => [r.tool_name, r]),
      );
      const held = new Map(
        this.db
          .query<QuarantineRow, [string]>("SELECT * FROM tool_quarantine WHERE account_id = ?")
          .all(accountId)
          .map((r) => [r.tool_name, r]),
      );

      const allowed: DownstreamTool[] = [];
      const quarantined: QuarantinedTool[] = [];
      for (const t of tools) {
        const hash = pinHash(t);
        const pin = pins.get(t.name);
        const q = held.get(t.name);
        if (pin?.hash === hash) {
          allowed.push(t);
          if (q) this.unquarantine(accountId, t.name);
          continue;
        }
        if (pin && this.upgradesLegacyPin(pin, t)) {
          this.db.run("UPDATE tool_pins SET hash = ? WHERE account_id = ? AND tool_name = ?", [
            hash,
            accountId,
            t.name,
          ]);
          allowed.push(t);
          if (q) this.unquarantine(accountId, t.name);
          continue;
        }
        if (q?.status === "rejected" && q.hash === hash) continue;
        this.db.run(
          `INSERT INTO tool_quarantine (account_id, tool_name, hash, definition, status, seen_at)
           VALUES (?, ?, ?, ?, 'pending', ?)
           ON CONFLICT (account_id, tool_name) DO UPDATE SET
             hash = excluded.hash, definition = excluded.definition, status = 'pending', seen_at = excluded.seen_at
           WHERE tool_quarantine.hash != excluded.hash OR tool_quarantine.status != 'pending'`,
          [accountId, t.name, hash, JSON.stringify(t), at],
        );
        quarantined.push(this.toQuarantined(accountId, t, pin));
      }

      // A quarantined tool that the server no longer lists has nothing left to review.
      const listed = new Set(tools.map((t) => t.name));
      for (const name of held.keys()) if (!listed.has(name)) this.unquarantine(accountId, name);

      return { allowed, quarantined };
    })();
  }

  approve(accountId: string, toolName: string): void {
    const q = this.held(accountId, toolName);
    this.db.transaction(() => {
      this.pin(accountId, JSON.parse(q.definition) as DownstreamTool, this.now());
      this.unquarantine(accountId, toolName);
    })();
  }

  reject(accountId: string, toolName: string): void {
    this.held(accountId, toolName);
    this.db.run("UPDATE tool_quarantine SET status = 'rejected' WHERE account_id = ? AND tool_name = ?", [
      accountId,
      toolName,
    ]);
  }

  quarantined(accountId?: string): QuarantinedTool[] {
    const rows = this.db
      .query<
        QuarantineRow & { pinned: string | null; pinned_hash: string | null },
        [string | null, string | null]
      >(
        `SELECT q.*, p.definition AS pinned, p.hash AS pinned_hash FROM tool_quarantine q
         LEFT JOIN tool_pins p ON p.account_id = q.account_id AND p.tool_name = q.tool_name
         WHERE q.status = 'pending' AND (? IS NULL OR q.account_id = ?)
         ORDER BY q.account_id, q.tool_name`,
      )
      .all(accountId ?? null, accountId ?? null);
    return rows.map((r) => {
      const pinned = parse(r.pinned);
      return {
        accountId: r.account_id,
        toolName: r.tool_name,
        reason: r.pinned_hash ? "changed" : "new",
        ...(pinned ? { pinned } : {}),
        current: JSON.parse(r.definition) as DownstreamTool,
      };
    });
  }

  forget(accountId: string): void {
    this.db.transaction(() => {
      for (const table of ["tool_pins", "tool_quarantine", "tool_pin_accounts"])
        this.db.run(`DELETE FROM ${table} WHERE account_id = ?`, [accountId]);
    })();
  }

  /**
   * A pin made with the old formula still matches when the listed tool is unchanged: the old hash matches,
   * and the stored definition (when there is one) has the same annotations and title.
   */
  private upgradesLegacyPin(pin: PinRow, t: DownstreamTool): boolean {
    if (pin.hash !== legacyPinHash(t)) return false;
    const stored = parse(pin.definition);
    return !stored || pinHash(stored) === pinHash(t);
  }

  private pin(accountId: string, t: DownstreamTool, at: number): void {
    this.db.run(
      `INSERT INTO tool_pins (account_id, tool_name, hash, approved_at, definition) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (account_id, tool_name) DO UPDATE SET
         hash = excluded.hash, approved_at = excluded.approved_at, definition = excluded.definition`,
      [accountId, t.name, pinHash(t), at, JSON.stringify(t)],
    );
  }

  private unquarantine(accountId: string, toolName: string): void {
    this.db.run("DELETE FROM tool_quarantine WHERE account_id = ? AND tool_name = ?", [accountId, toolName]);
  }

  private held(accountId: string, toolName: string): QuarantineRow {
    const q = this.db
      .query<QuarantineRow, [string, string]>(
        "SELECT * FROM tool_quarantine WHERE account_id = ? AND tool_name = ?",
      )
      .get(accountId, toolName);
    if (!q) throw new Error(`${accountId}__${toolName} is not quarantined`);
    return q;
  }

  private toQuarantined(
    accountId: string,
    current: DownstreamTool,
    pin: PinRow | undefined,
  ): QuarantinedTool {
    const pinned = pin ? parse(pin.definition) : undefined;
    return {
      accountId,
      toolName: current.name,
      reason: pin ? "changed" : "new",
      ...(pinned ? { pinned } : {}),
      current,
    };
  }
}
