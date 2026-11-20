// ApprovalStore on the `approvals` table of state.db.
// The gateway creates a request and waits; the web UI (same process) or the CLI decides it.
// The gateway runs with `trustTable: false`: only decisions made through this object count, so a process
// that can write state.db (an AI client's shell, a stdio server) cannot approve its own call. The CLI
// decides through the gateway's admin API. With `trustTable: true` (tests, tools), waiters also poll the
// table for decisions written by other processes.
import type { Database } from "bun:sqlite";
import type { ApprovalRequest, ApprovalStatus, ApprovalStore } from "../store/approvals.ts";

interface Row {
  id: string;
  created_at: number;
  profile_id: string;
  tool: string;
  status: ApprovalStatus;
  decided_at: number | null;
  reason?: string | null;
}

export interface ApprovalStoreOptions {
  /** How often a waiter checks the table for decisions from other processes. Default 500 ms. */
  pollMs?: number;
  /** Accept decisions written to the table by other processes. Default true; the gateway sets false. */
  trustTable?: boolean;
  now?: () => number;
}

export class SqliteApprovalStore implements ApprovalStore {
  private readonly listeners = new Set<(req: ApprovalRequest) => void>();
  /** Resolvers of in-process waiters, by request id. */
  private readonly waiters = new Map<string, Set<() => void>>();
  /** Reasons for this process's requests. Kept in memory while the table has no `reason` column. */
  private readonly reasons = new Map<string, string>();
  /** Argument previews of pending requests. Memory only, by design (see ApprovalRequest.preview). */
  private readonly previews = new Map<string, string>();
  private readonly hasReasonColumn: boolean;
  private readonly pollMs: number;
  private readonly trustTable: boolean;
  /** Decisions made through this object, by request id. The only ones that count without trustTable. */
  private readonly decided = new Map<string, Exclude<ApprovalStatus, "pending">>();
  private readonly now: () => number;

  constructor(
    private readonly db: Database,
    opts: ApprovalStoreOptions = {},
  ) {
    this.pollMs = opts.pollMs ?? 500;
    this.trustTable = opts.trustTable ?? true;
    this.now = opts.now ?? Date.now;
    this.hasReasonColumn = db
      .query<{ name: string }, []>("PRAGMA table_info(approvals)")
      .all()
      .some((c) => c.name === "reason");
  }

  create(req: { profileId: string; tool: string; reason: string; preview?: string }): ApprovalRequest {
    const id = newId();
    const createdAt = this.now();
    if (this.hasReasonColumn)
      this.db.run(
        "INSERT INTO approvals (id, created_at, profile_id, tool, status, reason) VALUES (?, ?, ?, ?, 'pending', ?)",
        [id, createdAt, req.profileId, req.tool, req.reason],
      );
    else
      this.db.run(
        "INSERT INTO approvals (id, created_at, profile_id, tool, status) VALUES (?, ?, ?, ?, 'pending')",
        [id, createdAt, req.profileId, req.tool],
      );
    this.reasons.set(id, req.reason);
    if (req.preview) this.previews.set(id, req.preview);
    const created: ApprovalRequest = {
      id,
      createdAt,
      profileId: req.profileId,
      tool: req.tool,
      reason: req.reason,
      status: "pending",
      ...(req.preview ? { preview: req.preview } : {}),
    };
    this.notify(created);
    return created;
  }

  get(id: string): ApprovalRequest | undefined {
    const row = this.db.query<Row, [string]>("SELECT * FROM approvals WHERE id = ?").get(id);
    return row ? this.toRequest(row) : undefined;
  }

  /** Throws a readable error when the id is unknown or the request is no longer pending. */
  decide(id: string, decision: "approved" | "denied"): void {
    if (decision !== "approved" && decision !== "denied") throw new Error(`Unknown decision "${decision}".`);
    if (!this.transition(id, decision)) {
      const found = this.get(id);
      if (!found) throw new Error(`No approval request with id ${id}.`);
      throw new Error(`Approval request ${id} is already ${found.status}.`);
    }
  }

  wait(id: string, timeoutMs: number, signal?: AbortSignal): Promise<ApprovalStatus> {
    const current = this.get(id);
    if (!current) return Promise.reject(new Error(`No approval request with id ${id}.`));
    if (current.status !== "pending") return Promise.resolve(current.status);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        clearInterval(poll);
        signal?.removeEventListener("abort", expire);
        this.waiters.get(id)?.delete(finish);
        if (this.waiters.get(id)?.size === 0) this.waiters.delete(id);
        if (!this.trustTable) {
          // A row changed behind our back (status no longer pending, no decision of ours) counts as expired.
          const mine = this.decided.get(id);
          this.decided.delete(id);
          resolve(mine ?? "expired");
          return;
        }
        resolve(this.get(id)?.status ?? "expired");
      };
      const expire = () => {
        this.transition(id, "expired");
        finish();
      };
      const timer = setTimeout(expire, timeoutMs);
      const poll = setInterval(() => {
        if (!this.trustTable) return;
        const r = this.get(id);
        if (r && r.status !== "pending") {
          this.notify(r); // decided by another process
          finish();
        }
      }, this.pollMs);
      const set = this.waiters.get(id) ?? new Set();
      set.add(finish);
      this.waiters.set(id, set);
      if (signal?.aborted) expire();
      else signal?.addEventListener("abort", expire, { once: true });
    });
  }

  list(filter: { status?: ApprovalStatus; limit?: number } = {}): ApprovalRequest[] {
    const limit = Math.max(1, Math.min(filter.limit ?? 50, 1000));
    const rows = filter.status
      ? this.db
          .query<Row, [string, number]>(
            "SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?",
          )
          .all(filter.status, limit)
      : this.db
          .query<Row, [number]>("SELECT * FROM approvals ORDER BY created_at DESC, rowid DESC LIMIT ?")
          .all(limit);
    return rows.map((r) => this.toRequest(r));
  }

  subscribe(listener: (req: ApprovalRequest) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Mark every pending request expired. Call once when the gateway starts:
   * requests left by an earlier process have no waiter.
   */
  expirePending(): number {
    return this.db.run("UPDATE approvals SET status = 'expired', decided_at = ? WHERE status = 'pending'", [
      this.now(),
    ]).changes;
  }

  /** pending -> status. False when the request is unknown or already decided. */
  private transition(id: string, status: Exclude<ApprovalStatus, "pending">): boolean {
    const changed = this.db.run(
      "UPDATE approvals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
      [status, this.now(), id],
    ).changes;
    if (changed === 0) return false;
    this.decided.set(id, status);
    this.previews.delete(id);
    const r = this.get(id);
    if (r) this.notify(r);
    for (const finish of [...(this.waiters.get(id) ?? [])]) finish();
    return true;
  }

  private notify(req: ApprovalRequest): void {
    for (const l of [...this.listeners]) {
      try {
        l(req);
      } catch {
        // A failing listener must not break the call that triggered it.
      }
    }
  }

  private toRequest(r: Row): ApprovalRequest {
    return {
      id: r.id,
      createdAt: r.created_at,
      profileId: r.profile_id,
      tool: r.tool,
      reason: r.reason ?? this.reasons.get(r.id) ?? "",
      status: r.status,
      ...(r.decided_at != null ? { decidedAt: r.decided_at } : {}),
      ...(r.status === "pending" && this.previews.has(r.id) ? { preview: this.previews.get(r.id) } : {}),
    };
  }
}

/** 10 lowercase hex characters: short enough to type in `pmcpg approvals approve <id>`. */
function newId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(5))).toString("hex");
}
