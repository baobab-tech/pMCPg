// Tool catalogue: downstream tool lists per account, cached in state.db, fed into the search index per profile.
import type { Database } from "bun:sqlite";
import type { Connector, DownstreamTool } from "../connectors/connector.ts";
import type { Config } from "../core/config.ts";
import { profileIds, resolveProfile } from "../core/profiles.ts";
import { qualify, type ToolRef } from "../core/types.ts";
import type { PinStore } from "../pinning/pins.ts";
import { pinHash } from "../pinning/store.ts";
import { searchable } from "../policy/decide.ts";
import type { ToolIndex } from "../search/search.ts";
import type { EventSink } from "../store/events.ts";

/** Same formula as the pin hash: name, title, description, input schema and annotations. */
export function toolHash(t: DownstreamTool): string {
  return pinHash(t);
}

export class ToolCatalog {
  private readonly tools = new Map<string, DownstreamTool[]>();
  private readonly inflight = new Map<string, Promise<void>>();
  /** Searchable tools per profile, as last pushed into the index. */
  private readonly byProfile = new Map<string, ToolRef[]>();

  constructor(
    private readonly db: Database,
    private readonly index: ToolIndex,
    private readonly config: () => Config,
    private readonly getConnector: (accountId: string) => Connector | undefined,
    private readonly events: EventSink,
    private readonly pins?: PinStore,
  ) {}

  /** Tools a profile can search and call: the same set the index holds. */
  profileTools(profileId: string): ToolRef[] {
    return [...(this.byProfile.get(profileId) ?? [])];
  }

  count(accountId: string): number {
    return this.tools.get(accountId)?.length ?? 0;
  }

  /** Tools as last listed by the server (cached), including any held in quarantine. */
  listed(accountId: string): DownstreamTool[] {
    return [...(this.tools.get(accountId) ?? [])];
  }

  loadCache(): void {
    this.tools.clear();
    const rows = this.db
      .query<{ account_id: string; definition: string }, []>(
        "SELECT account_id, definition FROM tool_cache ORDER BY account_id, tool_name",
      )
      .all();
    for (const r of rows) {
      const list = this.tools.get(r.account_id) ?? [];
      list.push(JSON.parse(r.definition) as DownstreamTool);
      this.tools.set(r.account_id, list);
    }
  }

  /** Listed tools minus quarantined or rejected ones (pinning). */
  private visible(accountId: string): DownstreamTool[] {
    const listed = this.tools.get(accountId) ?? [];
    return this.pins && listed.length ? this.pins.check(accountId, listed).allowed : listed;
  }

  /** Tool refs for one account, with trust from its server. Quarantined tools are left out. */
  refs(accountId: string): ToolRef[] {
    const cfg = this.config();
    const account = cfg.accounts[accountId];
    const server = account && cfg.servers[account.server];
    if (!account || !server) return [];
    return this.visible(accountId).map((t) => ({
      qualifiedName: qualify(accountId, t.name),
      accountId,
      serverId: account.server,
      toolName: t.name,
      ...(t.title ? { title: t.title } : {}),
      description: t.description ?? "",
      inputSchema: t.inputSchema,
      ...(t.annotations ? { annotations: t.annotations } : {}),
      hash: toolHash(t),
      trust: server.trust,
    }));
  }

  /** Push every profile's tool set into the index, without tools its policy hides (deny, read-only). */
  rebuild(): void {
    const cfg = this.config();
    const byAccount = new Map(Object.keys(cfg.accounts).map((a) => [a, this.refs(a)]));
    this.byProfile.clear();
    for (const id of profileIds(cfg)) {
      const p = resolveProfile(cfg, id);
      if (!p) continue;
      const tools = p.accounts.flatMap((a) => byAccount.get(a) ?? []).filter((t) => searchable(p.def, t));
      this.byProfile.set(id, tools);
      this.index.setTools(id, tools);
    }
  }

  /** List tools from the server, update cache and index. Errors are reported as events, not thrown. */
  refresh(accountId: string): Promise<void> {
    const running = this.inflight.get(accountId);
    if (running) return running;
    const job = this.doRefresh(accountId).finally(() => this.inflight.delete(accountId));
    this.inflight.set(accountId, job);
    return job;
  }

  private async doRefresh(accountId: string): Promise<void> {
    const connector = this.getConnector(accountId);
    if (!connector) return;
    let listed: DownstreamTool[];
    try {
      listed = await connector.listTools();
    } catch (e) {
      this.events.emit({ type: "account-state", accountId, status: "error", reason: (e as Error).message });
      return;
    }
    const before = new Map((this.tools.get(accountId) ?? []).map((t) => [t.name, toolHash(t)]));
    const after = new Map(listed.map((t) => [t.name, toolHash(t)]));
    let added = 0;
    let changed = 0;
    for (const [n, h] of after) {
      if (!before.has(n)) added++;
      else if (before.get(n) !== h) changed++;
    }
    const removed = [...before.keys()].filter((n) => !after.has(n)).length;

    const now = Date.now();
    this.db.transaction(() => {
      this.db.run("DELETE FROM tool_cache WHERE account_id = ?", [accountId]);
      for (const t of listed)
        this.db.run(
          "INSERT INTO tool_cache (account_id, tool_name, definition, hash, fetched_at) VALUES (?, ?, ?, ?, ?)",
          [accountId, t.name, JSON.stringify(t), toolHash(t), now],
        );
    })();
    this.tools.set(accountId, listed);
    this.rebuild();
    if (added || removed || changed)
      this.events.emit({ type: "tools-changed", accountId, added, removed, changed });
  }

  /** Refresh accounts that have no cached tools, plus remote accounts (cheap to list). */
  async refreshMissing(): Promise<void> {
    const cfg = this.config();
    // Drop cache rows of accounts that no longer exist.
    for (const id of [...this.tools.keys()]) {
      if (!cfg.accounts[id]) {
        this.tools.delete(id);
        this.db.run("DELETE FROM tool_cache WHERE account_id = ?", [id]);
      }
    }
    const todo = Object.entries(cfg.accounts)
      .filter(([id, a]) => !this.tools.has(id) || cfg.servers[a.server]?.transport !== "stdio")
      .map(([id]) => id);
    await Promise.allSettled(todo.map((id) => this.refresh(id)));
    this.rebuild();
  }
}
