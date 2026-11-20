// The running gateway: wires config, vault, connectors, tool index, front door, OAuth callback and local API.
import type { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { localhostHostValidation } from "@modelcontextprotocol/hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { embeddedAssets, type UiAssets } from "../api/assets.ts";
import { createUiApi } from "../api/routes.ts";
import type { Connector, ConnectorDeps, OAuthController } from "../connectors/connector.ts";
import { createOAuthController } from "../connectors/oauth.ts";
import { createRemoteConnector } from "../connectors/remote.ts";
import { createStdioConnector } from "../connectors/stdio.ts";
import { ALL_PROFILE, type Config, type ProfileDef } from "../core/config.ts";
import { ensureDataDir, loadConfig, saveConfig, validateConfig } from "../core/config-store.ts";
import { paths } from "../core/paths.ts";
import { checkReferences, profileIds, resolveProfile } from "../core/profiles.ts";
import { createFrontDoor, tokensMatch } from "../frontdoor/server.ts";
import { SqlitePinStore } from "../pinning/store.ts";
import { SqliteApprovalStore } from "../policy/approvals.ts";
import { dataFlowStep, policyStep } from "../policy/step.ts";
import { maskStep, rehydrateStep, secretScanStep } from "../privacy/steps.ts";
import { MiniSearchToolIndex } from "../search/minisearch-index.ts";
import { DEFAULT_RETENTION_DAYS, SqliteActivityLog } from "../store/activity-log.ts";
import { openDb } from "../store/db.ts";
import type { EventSink, GatewayEvent } from "../store/events.ts";
import { getDataKey, openVault } from "../vault/select.ts";
import { type Vault, vaultKeys } from "../vault/vault.ts";
import { openBrowser } from "./browser.ts";
import { ToolCatalog } from "./catalog.ts";
import type { GatewayHandle } from "./handle.ts";
import { ensureToken } from "./tokens.ts";

export interface GatewayOptions {
  home?: string;
  host?: string;
  port?: number;
  /** Start the HTTP listener. False in tests that call `app.fetch` directly. */
  listen?: boolean;
  openBrowser?: (url: string) => Promise<void>;
  /** Extra event sink (tests, debugging). Events always go to the encrypted activity log too. */
  events?: EventSink;
  /** Web UI files. Default: embedded at build time; none when the UI was not built. */
  uiAssets?: UiAssets;
  /** Approval wait override in ms (tests). */
  approvalTimeoutMs?: number;
}

export interface Gateway {
  app: Hono;
  url: string;
  config(): Config;
  vault: Vault;
  db: Database;
  catalog: ToolCatalog;
  oauth: OAuthController;
  /** Re-read config.yaml, drop removed connectors, rebuild the index, list tools of new accounts. */
  reload(): Promise<void>;
  /** The interface the web UI's API uses. */
  handle: GatewayHandle;
  close(): Promise<void>;
}

export { ensureToken, newToken } from "./tokens.ts";

/** Load config.yaml, creating an empty one on first run. */
export function loadOrInitConfig(file: string): Config {
  if (!existsSync(file)) saveConfig(file, validateConfig({}));
  return loadConfig(file);
}

/** Open data dir, config, database and vault: what both `serve` and the CLI need. */
export async function openState(home?: string) {
  const p = paths(home);
  ensureDataDir(p.dir);
  const config = loadOrInitConfig(p.config);
  const db = openDb(p.db);
  const vault = await openVault(db);
  return { paths: p, config, db, vault };
}

const debugSink: EventSink = {
  emit(e: GatewayEvent) {
    if (process.env.PMCPG_DEBUG) process.stderr.write(`[event] ${JSON.stringify(e)}\n`);
  },
};

export async function startGateway(opts: GatewayOptions = {}): Promise<Gateway> {
  const state = await openState(opts.home);
  let config = state.config;
  const { db, vault } = state;
  const host = opts.host ?? config.gateway.host;
  const port = opts.port ?? config.gateway.port;
  const activity = new SqliteActivityLog(db, await getDataKey(vault));
  activity.prune(DEFAULT_RETENTION_DAYS);
  const extraSink = opts.events ?? debugSink;
  const events: EventSink = {
    emit(e) {
      activity.emit(e);
      extraSink.emit(e);
    },
  };
  const pinStore = new SqlitePinStore(db);
  // Only decisions made in this process (web UI, admin API) count; see SqliteApprovalStore.
  const approvals = new SqliteApprovalStore(db, { trustTable: false });
  // OAuth providers redirect to localhost even when the container binds 0.0.0.0.
  const url = `http://127.0.0.1:${port}`;

  const deps: ConnectorDeps = {
    vault,
    events,
    gatewayUrl: url,
    openBrowser: opts.openBrowser ?? openBrowser,
  };
  const lookup = (accountId: string) => {
    const account = config.accounts[accountId];
    const server = account && config.servers[account.server];
    return account && server ? { account, server } : undefined;
  };

  const connectors = new Map<string, Connector>();
  const index = new MiniSearchToolIndex();
  const catalog = new ToolCatalog(db, index, () => config, getConnector, events, pinStore);
  // Approving or rejecting a quarantined tool changes what search shows.
  const pins: typeof pinStore = Object.assign(Object.create(pinStore), {
    approve(accountId: string, toolName: string) {
      pinStore.approve(accountId, toolName);
      catalog.rebuild();
    },
    reject(accountId: string, toolName: string) {
      pinStore.reject(accountId, toolName);
      catalog.rebuild();
    },
  });

  function getConnector(accountId: string): Connector | undefined {
    const found = connectors.get(accountId);
    if (found) return found;
    const target = lookup(accountId);
    if (!target) return undefined;
    const c =
      target.server.transport === "stdio"
        ? createStdioConnector(accountId, target.account, target.server, deps)
        : createRemoteConnector(accountId, target.account, target.server, deps);
    c.onToolsChanged(() => void catalog.refresh(accountId));
    c.onStateChange((s) =>
      events.emit({
        type: "account-state",
        accountId,
        status: s.status,
        ...("reason" in s ? { reason: s.reason } : {}),
      }),
    );
    connectors.set(accountId, c);
    return c;
  }

  const oauth = createOAuthController(deps, lookup, {
    onSignedIn: (id) => {
      void connectors.get(id)?.close();
      connectors.delete(id);
      void catalog.refresh(id);
    },
    onSignedOut: (id) => {
      void connectors.get(id)?.close();
      connectors.delete(id);
    },
  });

  async function ensureProfileTokens() {
    for (const id of profileIds(config)) await ensureToken(vault, vaultKeys.clientToken(id));
  }
  await ensureProfileTokens();
  await ensureToken(vault, vaultKeys.adminToken());

  const getProfile = (id: string): ProfileDef | undefined => resolveProfile(config, id)?.def;
  const frontDoor = createFrontDoor({
    index,
    getProfile,
    getClientToken: (id) => (getProfile(id) ? vault.get(vaultKeys.clientToken(id)) : undefined),
    getConnector,
    listProfiles: () => profileIds(config),
    // Order (docs/design.md "Call pipeline"): re-hydrate, secret scan, policy | forward | data flow, mask.
    // Policy runs last before forwarding, so an approval request shows the values the tool will receive.
    steps: [
      rehydrateStep,
      secretScanStep,
      policyStep({ approvals, ...(opts.approvalTimeoutMs ? { timeoutMs: opts.approvalTimeoutMs } : {}) }),
      dataFlowStep,
      maskStep,
    ],
    events,
  });

  const app = new Hono();
  // MCP requests carry tool arguments, which can hold file contents; the CLI API sends small JSON.
  const tooLarge = bodyLimit({
    maxSize: MCP_BODY_LIMIT,
    onError: (c) => c.json({ error: "Request too large." }, 413),
  });
  app.use("/mcp", tooLarge);
  app.use("/p/*", tooLarge);
  app.use("/api/*", tooLarge);
  app.use("/oauth/*", localhostHostValidation());
  app.use("/api/*", localhostHostValidation());

  app.get("/oauth/callback", async (c) => {
    try {
      const { accountId } = await oauth.handleCallback(new URL(c.req.url));
      return c.html(
        page("Signed in", `Account <b>${escapeHtml(accountId)}</b> is signed in. You can close this tab.`),
      );
    } catch (e) {
      return c.html(page("Sign-in failed", escapeHtml((e as Error).message)), 400);
    }
  });

  // Local API for the CLI. Admin token from the vault, read per request so a rotation applies at once;
  // never exposed to MCP clients.
  app.use("/api/*", async (c, next) => {
    const given = c.req.header("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1] ?? "";
    const adminToken = await vault.get(vaultKeys.adminToken());
    if (!adminToken || !tokensMatch(given, adminToken)) return c.json({ error: "unauthorized" }, 401);
    await next();
  });
  app.get("/api/status", (c) =>
    c.json({
      url,
      profiles: profileIds(config),
      accounts: Object.fromEntries(
        Object.keys(config.accounts).map((id) => [
          id,
          { state: connectors.get(id)?.state() ?? { status: "stopped" }, tools: catalog.count(id) },
        ]),
      ),
    }),
  );
  // `pmcpg approvals approve|deny`: the CLI decides through here, never by writing state.db.
  app.post("/api/approvals/:id", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { decision?: unknown };
    if (b.decision !== "approved" && b.decision !== "denied")
      return c.json({ error: 'decision must be "approved" or "denied"' }, 400);
    try {
      approvals.decide(c.req.param("id"), b.decision);
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
    return c.json({ ok: true });
  });
  // `pmcpg privacy reset`: masked values live only in this process.
  app.post("/api/privacy/reset", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as { profile?: unknown };
    if (b.profile !== undefined && (typeof b.profile !== "string" || !getProfile(b.profile)))
      return c.json({ error: "No such profile." }, 404);
    return c.json(frontDoor.resetPrivacy(b.profile as string | undefined));
  });
  app.post("/api/reload", async (c) => {
    await reload();
    return c.json({ ok: true });
  });
  app.post("/api/accounts/:id/signin", async (c) => {
    try {
      return c.json(await oauth.beginSignIn(c.req.param("id")));
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400);
    }
  });
  app.post("/api/accounts/:id/signout", async (c) => {
    await oauth.signOut(c.req.param("id"));
    return c.json({ ok: true });
  });

  app.route("/", frontDoor.app);

  async function reload() {
    const next = loadConfig(state.paths.config);
    const problems = checkReferences(next);
    if (problems.length) throw new Error(`config.yaml has broken references:\n${problems.join("\n")}`);
    const before = config;
    config = next;
    const changed = changedAccounts(before, config);
    for (const id of changed) {
      await connectors.get(id)?.close();
      connectors.delete(id);
    }
    // Tokens issued for one host must not be sent to another.
    for (const id of movedAccounts(before, config))
      for (const key of [vaultKeys.oauthTokens(id), vaultKeys.oauthClient(id), vaultKeys.oauthDiscovery(id)])
        await vault.delete(key);
    await ensureProfileTokens();
    catalog.rebuild();
    // List tools again where the server changed; refreshMissing covers new accounts.
    await Promise.allSettled(
      [...changed].filter((id) => config.accounts[id]).map((id) => catalog.refresh(id)),
    );
    await catalog.refreshMissing();
  }

  const problems = checkReferences(config);
  if (problems.length) throw new Error(`config.yaml has broken references:\n${problems.join("\n")}`);
  catalog.loadCache();
  catalog.rebuild();
  const handle: GatewayHandle = {
    url,
    config: () => config,
    async updateConfig(mutate) {
      const draft = structuredClone(config);
      mutate(draft);
      const next = validateConfig(draft, state.paths.config);
      const broken = checkReferences(next);
      if (broken.length) throw new Error(broken.join("\n"));
      saveConfig(state.paths.config, next);
      await reload();
      return config;
    },
    accountState: (id) => connectors.get(id)?.state() ?? { status: "stopped" },
    toolCount: (id) => catalog.count(id),
    tools: (id) => catalog.listed(id),
    refreshAccount: (id) => catalog.refresh(id),
    resetPrivacy: (id) => frontDoor.resetPrivacy(id),
    oauth,
    vault,
    clientToken: (id) => ensureToken(vault, vaultKeys.clientToken(id)),
    keySource: vault.keySource,
    approvals,
    activity,
    pins,
  };

  // The UI answers / and /api/ui/* itself, ahead of the CLI's /api/* admin-token check.
  const root = new Hono();
  root.route(
    "/",
    createUiApi(handle, { db, bindHost: host, assets: opts.uiAssets ?? (await embeddedAssets()) }),
  );
  root.route("/", app);

  const server =
    opts.listen === false
      ? undefined
      : Bun.serve({ hostname: host, port, fetch: root.fetch, maxRequestBodySize: MCP_BODY_LIMIT });
  // List tools for accounts with no cache, in the background.
  void catalog.refreshMissing();

  return {
    app: root,
    url,
    config: () => config,
    vault,
    db,
    catalog,
    oauth,
    reload,
    handle,
    async close() {
      server?.stop(true);
      await frontDoor.close();
      await Promise.allSettled([...connectors.values()].map((c) => c.close()));
      // Connectors emit state events while closing; write them before the database goes.
      await activity.flush();
      db.close();
    },
  };
}

export { ALL_PROFILE };

/** Largest request body the gateway reads, on any route. */
export const MCP_BODY_LIMIT = 8 * 1024 * 1024;

const serverOf = (cfg: Config, accountId: string) => {
  const a = cfg.accounts[accountId];
  return a ? cfg.servers[a.server] : undefined;
};

/** Accounts whose own definition or whose server's definition differs between two configs. */
export function changedAccounts(before: Config, after: Config): Set<string> {
  const out = new Set<string>();
  for (const id of new Set([...Object.keys(before.accounts), ...Object.keys(after.accounts)])) {
    const was = JSON.stringify([before.accounts[id], serverOf(before, id)]);
    const is = JSON.stringify([after.accounts[id], serverOf(after, id)]);
    if (was !== is) out.add(id);
  }
  return out;
}

/** Accounts that still exist but whose remote server now has a different URL origin. */
export function movedAccounts(before: Config, after: Config): string[] {
  const origin = (cfg: Config, id: string) => {
    const s = serverOf(cfg, id);
    if (!s || s.transport === "stdio") return undefined;
    try {
      return new URL(s.url).origin;
    } catch {
      return undefined;
    }
  };
  return Object.keys(after.accounts).filter((id) => {
    const was = origin(before, id);
    return was !== undefined && was !== origin(after, id);
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

function page(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:16px system-ui;margin:3rem"><h1>${title}</h1><p>${body}</p></body>`;
}
