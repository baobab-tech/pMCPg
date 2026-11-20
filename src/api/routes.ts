// JSON API for the web UI, under /api/ui/*. Built only against GatewayHandle.
// Every route checks Host and Origin; every route except session/login/first password needs a session;
// every state-changing route needs the CSRF header.
import type { Database } from "bun:sqlite";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import { checkGuardedUrl } from "../connectors/guarded-fetch.ts";
import {
  type AccountDef,
  ALL_PROFILE,
  type Config,
  PrivacyLevel,
  ProfileDef,
  type ServerDef,
  Slug,
  TrustLevel,
} from "../core/config.ts";
import { profileIds, resolveProfile } from "../core/profiles.ts";
import type { GatewayHandle } from "../gateway/handle.ts";
import { rotateToken, rotationNotes } from "../gateway/tokens.ts";
import { rewriteAppTokens } from "../onboarding/clients.ts";
import { defaultScanEnv } from "../onboarding/importers.ts";
import { type ProbeResult, probeServer } from "../onboarding/probe.ts";
import { PolicyPreset } from "../policy/schema.ts";
import { vaultKeys } from "../vault/vault.ts";
import { assetResponse, embeddedAssets, SECURITY_HEADERS, type UiAssets } from "./assets.ts";
import {
  AuthError,
  clientAddress,
  csrfFor,
  hostOriginCheck,
  isLoopback,
  LAUNCH_PATH,
  UiAuth,
} from "./auth.ts";
import { profileUrl, snippets } from "./connect.ts";
import { type OnboardingOptions, registerOnboardingRoutes } from "./onboarding.ts";

export interface UiApiOptions {
  db: Database;
  /** Address the gateway binds. Non-loopback makes the UI password required. */
  bindHost: string;
  /** Extra hostnames accepted in Host (e.g. a LAN name). Loopback names and a non-wildcard bindHost are always accepted. */
  allowedHosts?: string[];
  idleTimeoutMs?: number;
  /** UI files. Default: the files embedded at build time. Pass {} to serve the API only. */
  assets?: UiAssets;
  /** Where to print the one-time setup code (non-loopback bind, no password yet). */
  log?: (line: string) => void;
  now?: () => number;
  /** Import/connect settings (tests pass a fake home). */
  onboarding?: OnboardingOptions;
  /** Finds a server's sign-in provider when a client secret is entered without one. Tests pass a fake. */
  probe?: (url: string, allowInsecure: boolean) => Promise<ProbeResult>;
}

export const API_PREFIX = "/api/ui";

/** Vault value for a client ID and secret the user entered, bound to one issuer. */
function enteredClient(clientId: string, clientSecret: string, issuer: string): string {
  return JSON.stringify({ client_id: clientId, client_secret: clientSecret, issuer, entered: true });
}
/** Largest request body the UI API reads. Its biggest bodies are pasted configs. */
export const UI_BODY_LIMIT = 1024 * 1024;

const LOOPBACK_NAMES = ["localhost", "127.0.0.1", "[::1]"];
const WILDCARD = new Set(["0.0.0.0", "::", "[::]"]);

/** Thrown inside handlers for a readable 4xx. */
class ApiError extends Error {
  constructor(
    public readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

const id = Slug;
const secretPair = z.object({ name: z.string().min(1).max(200), value: z.string().max(10_000) });
const envPair = secretPair.extend({ secret: z.boolean().default(true) });
/** OAuth client registered by hand, for providers without dynamic registration. Secret goes to the vault. */
const oauthClient = {
  clientId: z.string().min(1).max(500).optional(),
  clientSecret: z.string().min(1).max(10_000).optional(),
  /** Authorization server (issuer URL) the secret belongs to. Default: the one the server names now. */
  clientIssuer: z.url().max(2000).optional(),
};

const AddServer = z
  .object({
    id,
    name: z.string().max(100).optional(),
    url: z.url().optional(),
    command: z.string().min(1).max(4000).optional(),
    transport: z.enum(["http", "sse"]).optional(),
    allowInsecure: z.boolean().optional(),
    /** Create the first account in the same step. */
    account: z
      .object({
        auth: z.enum(["none", "oauth", "header"]),
        headers: z.array(secretPair).default([]),
        env: z.array(envPair).default([]),
        /** URL query parameters (e.g. apiKey), values stored in the vault. */
        params: z.array(secretPair).default([]),
        ...oauthClient,
      })
      .optional(),
  })
  .refine((v) => !v.url !== !v.command, { message: "Give a URL or a command, not both." });

const AddAccount = z.object({
  server: id,
  /** Account id; default "<server>" or "<server>-<name>". */
  name: z.string().max(40).optional(),
  label: z.string().max(100).optional(),
  auth: z.enum(["none", "oauth", "header"]),
  headers: z.array(secretPair).default([]),
  env: z.array(envPair).default([]),
  params: z.array(secretPair).default([]),
  ...oauthClient,
});

const ProfileBody = z.object({
  name: z.string().max(100).optional(),
  accounts: z.array(id).optional(),
  privacy: PrivacyLevel.optional(),
  preset: PolicyPreset.optional(),
  readOnly: z.boolean().optional(),
});

const Confirm = z.object({ password: z.string().optional() });

/** Split a command line into words. Supports single and double quotes; no other shell syntax. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  for (const m of line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** Vault-safe fragment of a header or env name. */
function keyPart(name: string): string {
  return name.toLowerCase().replace(/[^\w.-]+/g, "-");
}

const headerKey = (accountId: string, name: string) =>
  vaultKeys.accountSecret(accountId, `header-${keyPart(name)}`);
const envKey = (accountId: string, name: string) =>
  vaultKeys.accountSecret(accountId, `env-${keyPart(name)}`);
const paramKey = (accountId: string, name: string) =>
  vaultKeys.accountSecret(accountId, `param-${keyPart(name)}`);
const PARAM_NAME = /^[A-Za-z0-9_.~-]{1,100}$/;

export function createUiApi(handle: GatewayHandle, opts: UiApiOptions): Hono {
  const log = opts.log ?? ((l: string) => process.stderr.write(`${l}\n`));
  const auth = new UiAuth({
    db: opts.db,
    bindHost: opts.bindHost,
    idleTimeoutMs: opts.idleTimeoutMs,
    now: opts.now,
    onSetupCode: (code) => log(`Web UI: set a password to continue. One-time setup code: ${code}`),
  });

  const hosts = [...LOOPBACK_NAMES, ...(opts.allowedHosts ?? [])];
  if (!WILDCARD.has(opts.bindHost) && !isLoopback(opts.bindHost)) hosts.push(opts.bindHost);

  const app = new Hono();
  const api = new Hono();

  api.use("*", hostOriginCheck(hosts));
  // Read the address before bodyLimit may replace the request object.
  api.use("*", async (c, next) => {
    clientAddress(c);
    await next();
  });
  api.use(
    "*",
    bodyLimit({ maxSize: UI_BODY_LIMIT, onError: (c) => c.json({ error: "Request too large." }, 413) }),
  );
  api.use("*", async (c, next) => {
    await next();
    c.header("cache-control", "no-store");
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) c.header(k, v);
  });

  // Session and CSRF. Public routes: GET /session, POST /login, POST /setup/password.
  const PUBLIC = new Set(["/session", "/login", "/setup/password"]);
  api.use("*", async (c, next) => {
    const sub = c.req.path.slice(API_PREFIX.length);
    const changes = !["GET", "HEAD"].includes(c.req.method);
    if (changes && !(c.req.header("content-type") ?? "").startsWith("application/json"))
      return c.json({ error: "Send JSON." }, 415);
    if (PUBLIC.has(sub)) return next();
    if (!auth.touchSession(auth.sessionValue(c))) return c.json({ error: "Sign in to continue." }, 401);
    if (changes && !auth.checkCsrf(c))
      return c.json({ error: "Missing or wrong CSRF token. Reload the page." }, 403);
    await next();
  });

  api.onError((e, c) => {
    if (e instanceof AuthError) return c.json({ error: e.message }, e.status);
    if (e instanceof ApiError) return c.json({ error: e.message }, e.status);
    if (e instanceof z.ZodError)
      return c.json(
        { error: e.issues.map((i) => `${i.path.join(".") || "request"}: ${i.message}`).join("\n") },
        400,
      );
    if (e instanceof SyntaxError) return c.json({ error: "Invalid JSON." }, 400);
    // updateConfig throws readable validation messages; they never contain secret values.
    return c.json({ error: e.message || "Something went wrong." }, 400);
  });

  const body = async <T extends z.ZodType>(c: { req: { json: () => Promise<unknown> } }, schema: T) =>
    schema.parse(await c.req.json()) as z.infer<T>;

  // ---- session ---------------------------------------------------------------

  function sessionInfo(value: string | undefined) {
    const passwordSet = auth.hasPassword();
    return {
      authenticated: !!value,
      passwordSet,
      passwordRequired: auth.passwordRequired,
      needsSetupCode: !passwordSet && auth.setupCode() !== undefined,
      /** No password and no session: only a launch link (`pmcpg open`) gets in. */
      needsLaunchLink: !value && !passwordSet && !auth.passwordRequired,
      setupDone: auth.setupDone(),
      csrf: value ? csrfFor(value) : undefined,
    };
  }

  // Never creates a session: without a password, sessions come only from a launch link (GET /launch).
  // Otherwise any local process could send a matching Origin header and become admin.
  api.get("/session", (c) => {
    let value = auth.sessionValue(c);
    if (!auth.touchSession(value)) value = undefined;
    return c.json(sessionInfo(value));
  });

  api.post("/login", async (c) => {
    const { password } = await body(c, z.object({ password: z.string().max(1000) }));
    if (!auth.hasPassword()) return c.json({ error: "No password is set." }, 400);
    if (!(await auth.verifyPassword(password, clientAddress(c))))
      return c.json({ error: "Wrong password." }, 401);
    auth.endSession(auth.sessionValue(c));
    const value = auth.createSession();
    auth.setSessionCookie(c, value);
    return c.json(sessionInfo(value));
  });

  api.post("/logout", (c) => {
    auth.endSession(auth.sessionValue(c));
    auth.clearSessionCookie(c);
    return c.json({ ok: true });
  });

  /** First password. Loopback bind: a session from a launch link. Otherwise: the setup code from the log. */
  api.post("/setup/password", async (c) => {
    const b = await body(c, z.object({ password: z.string().max(1000), setupCode: z.string().optional() }));
    if (auth.hasPassword()) return c.json({ error: "A password is already set." }, 409);
    const code = auth.setupCode();
    if (code !== undefined && b.setupCode !== code)
      return c.json({ error: "Wrong setup code. It is printed in the gateway's log." }, 403);
    if (code === undefined && !auth.touchSession(auth.sessionValue(c)))
      return c.json({ error: "Open pMCPg with the link from `pmcpg open`, then set the password." }, 401);
    await auth.setPassword(b.password);
    const value = auth.createSession();
    auth.setSessionCookie(c, value);
    return c.json(sessionInfo(value));
  });

  api.post("/setup/done", (c) => {
    auth.markSetupDone();
    return c.json({ ok: true });
  });

  /** Change or set the password while signed in. */
  api.post("/password", async (c) => {
    const b = await body(c, z.object({ current: z.string().optional(), password: z.string().max(1000) }));
    await auth.confirm(b.current, clientAddress(c));
    await auth.setPassword(b.password);
    const value = auth.createSession();
    auth.setSessionCookie(c, value);
    return c.json(sessionInfo(value));
  });

  api.delete("/password", async (c) => {
    const b = await body(c, Confirm);
    await auth.confirm(b.password, clientAddress(c));
    auth.removePassword();
    const value = auth.createSession();
    auth.setSessionCookie(c, value);
    return c.json(sessionInfo(value));
  });

  // ---- status ----------------------------------------------------------------

  api.get("/status", (c) => {
    const cfg = handle.config();
    const accounts = Object.keys(cfg.accounts).map((a) => ({
      id: a,
      state: handle.accountState(a),
      tools: handle.toolCount(a),
    }));
    return c.json({
      url: handle.url,
      servers: Object.keys(cfg.servers).length,
      accounts,
      profiles: profileIds(cfg).length,
      pendingApprovals: handle.approvals?.list({ status: "pending" }).length ?? null,
      quarantined: handle.pins?.quarantined().length ?? null,
      features: { approvals: !!handle.approvals, activity: !!handle.activity, pins: !!handle.pins },
    });
  });

  // ---- servers ---------------------------------------------------------------

  function serverView(cfg: Config, sid: string, s: ServerDef) {
    return {
      id: sid,
      name: s.name ?? sid,
      transport: s.transport,
      target: s.transport === "stdio" ? [s.command, ...s.args].join(" ") : s.url,
      allowInsecure: s.allowInsecure,
      trust: s.trust,
      accounts: Object.entries(cfg.accounts)
        .filter(([, a]) => a.server === sid)
        .map(([aid]) => aid),
    };
  }

  api.get("/servers", (c) => {
    const cfg = handle.config();
    return c.json(Object.entries(cfg.servers).map(([sid, s]) => serverView(cfg, sid, s)));
  });

  api.post("/servers", async (c) => {
    const b = await body(c, AddServer);
    let def: ServerDef;
    if (b.url) {
      def = {
        transport: b.transport ?? "http",
        url: b.url,
        trust: [],
        allowInsecure: b.allowInsecure ?? false,
        ...(b.name ? { name: b.name } : {}),
      };
    } else {
      const [command, ...args] = splitCommand(b.command as string);
      if (!command) throw new ApiError(400, "The command is empty.");
      def = {
        transport: "stdio",
        command,
        args,
        env: {},
        trust: [],
        allowInsecure: false,
        ...(b.name ? { name: b.name } : {}),
      };
    }
    let account: { id: string; def: AccountDef } | undefined;
    if (b.account) {
      if (b.account.auth === "oauth" && def.transport === "stdio")
        throw new ApiError(400, "Sign-in with a browser only works for servers reached by URL.");
      account = await prepareAccount(b.id, b.id, undefined, b.account, def);
    }
    await handle.updateConfig((d) => {
      if (d.servers[b.id]) throw new ApiError(409, `A server named "${b.id}" already exists.`);
      d.servers[b.id] = def;
      if (account) {
        if (d.accounts[account.id])
          throw new ApiError(409, `An account named "${account.id}" already exists.`);
        d.accounts[account.id] = account.def;
      }
    });
    const cfg = handle.config();
    return c.json(serverView(cfg, b.id, cfg.servers[b.id] as ServerDef), 201);
  });

  api.patch("/servers/:id", async (c) => {
    const sid = c.req.param("id");
    const b = await body(
      c,
      z.object({
        name: z.string().max(100).optional(),
        url: z.url().optional(),
        command: z.string().min(1).max(4000).optional(),
        allowInsecure: z.boolean().optional(),
        trust: z.array(TrustLevel).max(4).optional(),
      }),
    );
    await handle.updateConfig((d) => {
      const s = d.servers[sid];
      if (!s) throw new ApiError(404, `No server named "${sid}".`);
      if (b.name !== undefined) s.name = b.name || undefined;
      if (b.trust !== undefined) s.trust = [...new Set(b.trust)];
      if (b.allowInsecure !== undefined) s.allowInsecure = b.allowInsecure;
      if (b.url !== undefined) {
        if (s.transport === "stdio") throw new ApiError(400, "This server runs a command; it has no URL.");
        s.url = b.url;
      }
      if (b.command !== undefined) {
        if (s.transport !== "stdio")
          throw new ApiError(400, "This server is reached by URL; it has no command.");
        const [command, ...args] = splitCommand(b.command);
        if (!command) throw new ApiError(400, "The command is empty.");
        s.command = command;
        s.args = args;
      }
    });
    const cfg = handle.config();
    return c.json(serverView(cfg, sid, cfg.servers[sid] as ServerDef));
  });

  api.delete("/servers/:id", async (c) => {
    const sid = c.req.param("id");
    await auth.confirm((await body(c, Confirm)).password, clientAddress(c));
    const cfg = handle.config();
    if (!cfg.servers[sid]) throw new ApiError(404, `No server named "${sid}".`);
    const accounts = Object.entries(cfg.accounts)
      .filter(([, a]) => a.server === sid)
      .map(([aid]) => aid);
    for (const a of accounts) await forgetAccount(a, cfg.accounts[a] as AccountDef);
    await handle.updateConfig((d) => {
      for (const a of accounts) delete d.accounts[a];
      for (const p of Object.values(d.profiles)) p.accounts = p.accounts.filter((a) => !accounts.includes(a));
      delete d.servers[sid];
    });
    return c.json({ ok: true, removedAccounts: accounts });
  });

  /** List tools again for every account of the server and report the result. */
  api.post("/servers/:id/test", async (c) => {
    const sid = c.req.param("id");
    const cfg = handle.config();
    if (!cfg.servers[sid]) throw new ApiError(404, `No server named "${sid}".`);
    const accounts = Object.entries(cfg.accounts)
      .filter(([, a]) => a.server === sid)
      .map(([aid]) => aid);
    const results = await Promise.all(accounts.map(testAccount));
    return c.json({ results });
  });

  async function testAccount(aid: string) {
    let error: string | undefined;
    try {
      await withTimeout(handle.refreshAccount(aid), 60_000);
    } catch (e) {
      error = (e as Error).message;
    }
    const state = handle.accountState(aid);
    return { account: aid, state, tools: handle.toolCount(aid), ...(error ? { error } : {}) };
  }

  // ---- accounts --------------------------------------------------------------

  /** Store secret values in the vault and build the account definition with references only. */
  async function prepareAccount(
    server: string,
    aid: string,
    label: string | undefined,
    a: {
      auth: "none" | "oauth" | "header";
      headers: { name: string; value: string }[];
      env: z.infer<typeof envPair>[];
      params?: { name: string; value: string }[];
      clientId?: string;
      clientSecret?: string;
      clientIssuer?: string;
    },
    serverDef?: ServerDef,
  ): Promise<{ id: string; def: AccountDef }> {
    if (!Slug.safeParse(aid).success)
      throw new ApiError(
        400,
        `"${aid}" is not a valid account name: use lowercase letters, digits and dashes.`,
      );
    const env: Record<string, string> = {};
    for (const e of a.env) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.name))
        throw new ApiError(400, `"${e.name}" is not a valid variable name.`);
      if (e.secret) {
        const key = envKey(aid, e.name);
        await handle.vault.set(key, e.value);
        env[e.name] = `vault:${key}`;
      } else env[e.name] = e.value;
    }
    const urlParams: Record<string, string> = {};
    for (const p of a.params ?? []) {
      if (!PARAM_NAME.test(p.name)) throw new ApiError(400, `"${p.name}" is not a valid URL parameter name.`);
      const key = paramKey(aid, p.name);
      await handle.vault.set(key, p.value);
      urlParams[p.name] = `vault:${key}`;
    }
    let auth: AccountDef["auth"] = { type: "none" };
    if (a.auth === "oauth") {
      auth = { type: "oauth", ...(a.clientId ? { clientId: a.clientId } : {}) };
      if (a.clientSecret) {
        if (!a.clientId) throw new ApiError(400, "A client secret needs its client ID.");
        const issuer = await clientIssuerFor(serverDef, a.clientIssuer);
        await handle.vault.set(vaultKeys.oauthClient(aid), enteredClient(a.clientId, a.clientSecret, issuer));
      }
    } else if (a.clientId || a.clientSecret)
      throw new ApiError(400, "A client ID is only used with browser sign-in.");
    if (a.auth === "header") {
      if (a.headers.length === 0) throw new ApiError(400, "Add at least one header.");
      const headers: Record<string, string> = {};
      for (const h of a.headers) {
        if (!/^[A-Za-z0-9-]+$/.test(h.name))
          throw new ApiError(400, `"${h.name}" is not a valid header name.`);
        const key = headerKey(aid, h.name);
        await handle.vault.set(key, h.value);
        headers[h.name] = `{{vault:${key}}}`;
      }
      auth = { type: "header", headers };
    }
    return {
      id: aid,
      def: {
        server,
        auth,
        env,
        ...(Object.keys(urlParams).length ? { urlParams } : {}),
        ...(label ? { label } : {}),
      },
    };
  }

  /**
   * The issuer a client secret is bound to: the one given, else the one the server names now.
   * The gateway sends the secret only to that issuer's token endpoint.
   */
  async function clientIssuerFor(server: ServerDef | undefined, given?: string): Promise<string> {
    if (!server || server.transport === "stdio")
      throw new ApiError(400, "Sign-in with a browser only works for servers reached by URL.");
    const httpOrigin = server.allowInsecure ? new URL(server.url).origin : undefined;
    if (given) {
      const problem = checkGuardedUrl(given, httpOrigin);
      if (problem) throw new ApiError(400, `Sign-in provider: ${problem}.`);
      return given;
    }
    const probe = opts.probe ?? ((u: string, ai: boolean) => probeServer(u, { allowInsecure: ai }));
    const found = await probe(server.url, server.allowInsecure);
    if (found.ok && found.auth.type === "oauth") return found.auth.issuer;
    throw new ApiError(
      400,
      "Could not find the server's sign-in provider to tie the client secret to. Give its issuer URL as clientIssuer.",
    );
  }

  async function forgetAccount(aid: string, a: AccountDef) {
    if (a.auth.type === "oauth") await handle.oauth.signOut(aid).catch(() => {});
    for (const key of await handle.vault.list(`account/${aid}/`)) await handle.vault.delete(key);
  }

  async function accountView(cfg: Config, aid: string, a: AccountDef) {
    const server = cfg.servers[a.server];
    const stored = new Set(await handle.vault.list(`account/${aid}/`));
    const secretRef = (v: string) => /^vault:|\{\{vault:/.test(v);
    const refKey = (v: string) =>
      v.startsWith("vault:") ? v.slice(6) : /\{\{vault:([\w./@-]+)\}\}/.exec(v)?.[1];
    return {
      id: aid,
      label: a.label ?? null,
      server: a.server,
      serverName: server?.name ?? a.server,
      transport: server?.transport ?? null,
      auth: a.auth.type,
      signedIn: a.auth.type === "oauth" ? stored.has(vaultKeys.oauthTokens(aid)) : null,
      headers:
        a.auth.type === "header"
          ? Object.entries(a.auth.headers).map(([name, v]) => {
              const key = refKey(v);
              return { name, set: key ? stored.has(key) || !key.startsWith(`account/${aid}/`) : true };
            })
          : [],
      env: Object.entries(a.env).map(([name, v]) => {
        const key = refKey(v);
        return secretRef(v)
          ? { name, secret: true, set: key ? stored.has(key) || !key.startsWith(`account/${aid}/`) : false }
          : { name, secret: false, set: true, value: v };
      }),
      params: Object.entries(a.urlParams ?? {}).map(([name, v]) => {
        const key = refKey(v);
        return secretRef(v)
          ? { name, set: key ? stored.has(key) || !key.startsWith(`account/${aid}/`) : false }
          : { name, set: true };
      }),
      clientId: a.auth.type === "oauth" ? (a.auth.clientId ?? null) : null,
      state: handle.accountState(aid),
      tools: handle.toolCount(aid),
      profiles: profileIds(cfg).filter((p) => resolveProfile(cfg, p)?.accounts.includes(aid)),
    };
  }

  api.get("/accounts", async (c) => {
    const cfg = handle.config();
    return c.json(
      await Promise.all(Object.entries(cfg.accounts).map(([aid, a]) => accountView(cfg, aid, a))),
    );
  });

  api.post("/accounts", async (c) => {
    const b = await body(c, AddAccount);
    const cfg = handle.config();
    const server = cfg.servers[b.server];
    if (!server) throw new ApiError(404, `No server named "${b.server}".`);
    if (b.auth === "oauth" && server.transport === "stdio")
      throw new ApiError(400, "Sign-in with a browser only works for servers reached by URL.");
    const aid = b.name ? `${b.server}-${b.name.toLowerCase().replace(/[^a-z0-9-]+/g, "-")}` : b.server;
    if (cfg.accounts[aid])
      throw new ApiError(409, `An account named "${aid}" already exists. Give this one a name.`);
    const account = await prepareAccount(b.server, aid, b.label, b, server);
    await handle.updateConfig((d) => {
      d.accounts[account.id] = account.def;
    });
    const next = handle.config();
    return c.json(await accountView(next, aid, next.accounts[aid] as AccountDef), 201);
  });

  api.patch("/accounts/:id", async (c) => {
    const aid = c.req.param("id");
    const b = await body(
      c,
      z.object({
        label: z.string().max(100).optional(),
        /** New or replaced secret values. Values are written to the vault only. */
        headers: z.array(secretPair).optional(),
        env: z.array(envPair).optional(),
        params: z.array(secretPair).optional(),
        ...oauthClient,
      }),
    );
    const cfg = handle.config();
    const a = cfg.accounts[aid];
    if (!a) throw new ApiError(404, `No account named "${aid}".`);
    const headers: Record<string, string> = {};
    for (const h of b.headers ?? []) {
      if (!/^[A-Za-z0-9-]+$/.test(h.name)) throw new ApiError(400, `"${h.name}" is not a valid header name.`);
      if (a.auth.type !== "header" && a.auth.type !== "none")
        throw new ApiError(400, "This account signs in with a browser; it has no headers.");
      const key = headerKey(aid, h.name);
      await handle.vault.set(key, h.value);
      headers[h.name] = `{{vault:${key}}}`;
    }
    const env: Record<string, string> = {};
    for (const e of b.env ?? []) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(e.name))
        throw new ApiError(400, `"${e.name}" is not a valid variable name.`);
      if (e.secret) {
        const key = envKey(aid, e.name);
        await handle.vault.set(key, e.value);
        env[e.name] = `vault:${key}`;
      } else env[e.name] = e.value;
    }
    const params: Record<string, string> = {};
    for (const p of b.params ?? []) {
      if (!PARAM_NAME.test(p.name)) throw new ApiError(400, `"${p.name}" is not a valid URL parameter name.`);
      const key = paramKey(aid, p.name);
      await handle.vault.set(key, p.value);
      params[p.name] = `vault:${key}`;
    }
    if ((b.clientId || b.clientSecret) && a.auth.type !== "oauth")
      throw new ApiError(400, "A client ID is only used with browser sign-in.");
    if (b.clientSecret) {
      const cid = b.clientId ?? (a.auth.type === "oauth" ? a.auth.clientId : undefined);
      if (!cid) throw new ApiError(400, "A client secret needs its client ID.");
      const issuer = await clientIssuerFor(cfg.servers[a.server], b.clientIssuer);
      await handle.vault.set(vaultKeys.oauthClient(aid), enteredClient(cid, b.clientSecret, issuer));
    } else if (b.clientId && a.auth.type === "oauth" && b.clientId !== a.auth.clientId) {
      // A new client ID makes any earlier registration for this account stale.
      await handle.vault.delete(vaultKeys.oauthClient(aid));
    }
    await handle.updateConfig((d) => {
      const acc = d.accounts[aid] as AccountDef;
      if (b.label !== undefined) acc.label = b.label || undefined;
      if (Object.keys(params).length) acc.urlParams = { ...(acc.urlParams ?? {}), ...params };
      if (b.clientId && acc.auth.type === "oauth") acc.auth = { ...acc.auth, clientId: b.clientId };
      if (Object.keys(headers).length)
        acc.auth = {
          type: "header",
          headers: { ...(acc.auth.type === "header" ? acc.auth.headers : {}), ...headers },
        };
      Object.assign(acc.env, env);
    });
    const next = handle.config();
    return c.json(await accountView(next, aid, next.accounts[aid] as AccountDef));
  });

  /** Remove one header or env entry and its stored value. */
  api.post("/accounts/:id/remove-secret", async (c) => {
    const aid = c.req.param("id");
    const b = await body(c, z.object({ kind: z.enum(["header", "env", "param"]), name: z.string() }));
    const a = handle.config().accounts[aid];
    if (!a) throw new ApiError(404, `No account named "${aid}".`);
    await handle.vault.delete(
      b.kind === "header"
        ? headerKey(aid, b.name)
        : b.kind === "param"
          ? paramKey(aid, b.name)
          : envKey(aid, b.name),
    );
    await handle.updateConfig((d) => {
      const acc = d.accounts[aid] as AccountDef;
      if (b.kind === "env") delete acc.env[b.name];
      else if (b.kind === "param") {
        if (acc.urlParams) delete acc.urlParams[b.name];
      } else if (acc.auth.type === "header") {
        delete acc.auth.headers[b.name];
        if (Object.keys(acc.auth.headers).length === 0) acc.auth = { type: "none" };
      }
    });
    return c.json({ ok: true });
  });

  api.delete("/accounts/:id", async (c) => {
    const aid = c.req.param("id");
    await auth.confirm((await body(c, Confirm)).password, clientAddress(c));
    const a = handle.config().accounts[aid];
    if (!a) throw new ApiError(404, `No account named "${aid}".`);
    await forgetAccount(aid, a);
    await handle.updateConfig((d) => {
      delete d.accounts[aid];
      for (const p of Object.values(d.profiles)) p.accounts = p.accounts.filter((x) => x !== aid);
    });
    return c.json({ ok: true });
  });

  api.post("/accounts/:id/signin", async (c) => {
    const aid = c.req.param("id");
    const a = handle.config().accounts[aid];
    if (!a) throw new ApiError(404, `No account named "${aid}".`);
    if (a.auth.type !== "oauth") throw new ApiError(400, "This account does not sign in with a browser.");
    return c.json(await handle.oauth.beginSignIn(aid));
  });

  api.post("/accounts/:id/signout", async (c) => {
    const aid = c.req.param("id");
    if (!handle.config().accounts[aid]) throw new ApiError(404, `No account named "${aid}".`);
    await handle.oauth.signOut(aid);
    return c.json({ ok: true });
  });

  /** Tools the account's server offers, without input schemas. Empty until the gateway has listed them. */
  api.get("/accounts/:id/tools", (c) => {
    const aid = c.req.param("id");
    if (!handle.config().accounts[aid]) throw new ApiError(404, `No account named "${aid}".`);
    return c.json({
      account: aid,
      state: handle.accountState(aid),
      tools: handle.tools(aid).map((t) => ({
        name: t.name,
        ...(t.title ? { title: t.title } : {}),
        ...(t.description ? { description: t.description } : {}),
        ...(t.annotations ? { annotations: t.annotations } : {}),
      })),
    });
  });

  api.post("/accounts/:id/test", async (c) => {
    const aid = c.req.param("id");
    if (!handle.config().accounts[aid]) throw new ApiError(404, `No account named "${aid}".`);
    return c.json(await testAccount(aid));
  });

  // ---- profiles --------------------------------------------------------------

  function profileView(cfg: Config, pid: string) {
    const r = resolveProfile(cfg, pid);
    if (!r) throw new ApiError(404, `No profile named "${pid}".`);
    return {
      id: pid,
      name: r.def.name ?? pid,
      builtIn: pid === ALL_PROFILE,
      accounts: r.accounts,
      privacy: r.def.privacy,
      preset: r.def.policy.preset,
      customRules: r.def.policy.rules.length,
      readOnly: r.def.readOnly,
      url: profileUrl(handle.url, pid),
    };
  }

  api.get("/profiles", (c) => {
    const cfg = handle.config();
    return c.json(profileIds(cfg).map((p) => profileView(cfg, p)));
  });

  function applyProfile(def: ProfileDef, b: z.infer<typeof ProfileBody>, pid: string) {
    if (b.name !== undefined) def.name = b.name || undefined;
    if (b.privacy) def.privacy = b.privacy;
    if (b.preset) def.policy = { ...def.policy, preset: b.preset };
    if (b.readOnly !== undefined) def.readOnly = b.readOnly;
    if (b.accounts) {
      if (pid === ALL_PROFILE) throw new ApiError(400, `"All" always holds every account.`);
      def.accounts = [...new Set(b.accounts)];
    }
  }

  api.post("/profiles", async (c) => {
    const b = await body(c, ProfileBody.extend({ id }));
    if (b.id === ALL_PROFILE) throw new ApiError(409, `"all" is built in.`);
    await handle.updateConfig((d) => {
      if (d.profiles[b.id]) throw new ApiError(409, `A profile named "${b.id}" already exists.`);
      const def = ProfileDef.parse({});
      applyProfile(def, b, b.id);
      d.profiles[b.id] = def;
    });
    return c.json(profileView(handle.config(), b.id), 201);
  });

  api.patch("/profiles/:id", async (c) => {
    const pid = c.req.param("id");
    const b = await body(c, ProfileBody);
    await handle.updateConfig((d) => {
      if (pid !== ALL_PROFILE && !d.profiles[pid]) throw new ApiError(404, `No profile named "${pid}".`);
      const def = d.profiles[pid] ?? ProfileDef.parse({ name: "All" });
      applyProfile(def, b, pid);
      d.profiles[pid] = def;
    });
    return c.json(profileView(handle.config(), pid));
  });

  api.delete("/profiles/:id", async (c) => {
    const pid = c.req.param("id");
    await auth.confirm((await body(c, Confirm)).password, clientAddress(c));
    if (pid === ALL_PROFILE) throw new ApiError(400, `"All" is built in and cannot be removed.`);
    if (!handle.config().profiles[pid]) throw new ApiError(404, `No profile named "${pid}".`);
    await handle.updateConfig((d) => {
      delete d.profiles[pid];
    });
    await handle.vault.delete(vaultKeys.clientToken(pid));
    return c.json({ ok: true });
  });

  /** Connection details, with the client token. POST so the token is never in a cacheable GET. */
  api.post("/profiles/:id/connect", async (c) => {
    const pid = c.req.param("id");
    if (!resolveProfile(handle.config(), pid)) throw new ApiError(404, `No profile named "${pid}".`);
    const token = await handle.clientToken(pid);
    return c.json({ url: profileUrl(handle.url, pid), token, snippets: snippets(handle.url, pid, token) });
  });

  /** Replace the profile's client token. The old one stops working at once; app files holding it are updated. */
  api.post("/profiles/:id/token/rotate", async (c) => {
    const pid = c.req.param("id");
    await auth.confirm((await body(c, Confirm)).password, clientAddress(c));
    if (!resolveProfile(handle.config(), pid)) throw new ApiError(404, `No profile named "${pid}".`);
    const target = { profile: pid };
    const r = await rotateToken(handle.vault, target, handle.activity, "ui");
    const env = (opts.onboarding?.scanEnv ?? defaultScanEnv)();
    const rewrites = r.old ? rewriteAppTokens(r.old, r.token, env) : [];
    return c.json({
      url: profileUrl(handle.url, pid),
      token: r.token,
      snippets: snippets(handle.url, pid, r.token),
      notes: rotationNotes(target, rewrites),
    });
  });

  /** Forget masked values for one profile, or every profile without `profile`. Asks for the password when set. */
  api.post("/privacy/reset", async (c) => {
    const b = await body(c, Confirm.extend({ profile: id.optional() }));
    await auth.confirm(b.password, clientAddress(c));
    if (b.profile !== undefined && !resolveProfile(handle.config(), b.profile))
      throw new ApiError(404, `No profile named "${b.profile}".`);
    return c.json(handle.resetPrivacy(b.profile));
  });

  // ---- settings --------------------------------------------------------------

  api.get("/settings", (c) => {
    const cfg = handle.config();
    return c.json({
      host: cfg.gateway.host,
      port: cfg.gateway.port,
      url: handle.url,
      keySource: handle.keySource,
      passwordSet: auth.hasPassword(),
      passwordRequired: auth.passwordRequired,
    });
  });

  api.patch("/settings", async (c) => {
    const b = await body(
      c,
      z.object({
        host: z.string().min(1).max(255).optional(),
        port: z.number().int().min(1).max(65535).optional(),
        password: z.string().optional(),
      }),
    );
    const cfg = handle.config();
    const hostChanges = b.host !== undefined && b.host !== cfg.gateway.host;
    if (hostChanges) {
      await auth.confirm(b.password, clientAddress(c));
      if (!isLoopback(b.host as string) && !auth.hasPassword())
        throw new ApiError(400, "Set a UI password before making the gateway reachable from other machines.");
    }
    await handle.updateConfig((d) => {
      if (b.host !== undefined) d.gateway.host = b.host;
      if (b.port !== undefined) d.gateway.port = b.port;
    });
    return c.json({ ok: true, restartNeeded: true });
  });

  // ---- approvals, activity, quarantine (present once Phase 2 modules are wired) --------------------

  api.get("/approvals", (c) => {
    if (!handle.approvals) return c.json({ available: false, items: [] });
    const status = z
      .enum(["pending", "approved", "denied", "expired"])
      .optional()
      .parse(c.req.query("status") || undefined);
    return c.json({ available: true, items: handle.approvals.list({ status, limit: 200 }) });
  });

  api.post("/approvals/:id", async (c) => {
    if (!handle.approvals) throw new ApiError(404, "Approvals are not available yet.");
    const b = await body(c, z.object({ decision: z.enum(["approved", "denied"]) }));
    handle.approvals.decide(c.req.param("id"), b.decision);
    return c.json({ ok: true });
  });

  api.get("/activity", async (c) => {
    if (!handle.activity) return c.json({ available: false, items: [] });
    const q = z
      .object({
        type: z
          .enum([
            "search",
            "call",
            "account-state",
            "tools-changed",
            "token-refreshed",
            "token-rotated",
            "server-spawned",
            "server-exited",
            "privacy-reset",
          ])
          .optional(),
        profileId: z.string().optional(),
        accountId: z.string().optional(),
        before: z.coerce.number().int().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(Object.fromEntries(Object.entries(c.req.query()).filter(([, v]) => v !== "")));
    return c.json({ available: true, items: await handle.activity.query(q) });
  });

  api.get("/quarantine", (c) => {
    if (!handle.pins) return c.json({ available: false, items: [] });
    return c.json({ available: true, items: handle.pins.quarantined() });
  });

  api.post("/quarantine/:account/:tool", async (c) => {
    if (!handle.pins) throw new ApiError(404, "Tool review is not available yet.");
    const b = await body(c, z.object({ decision: z.enum(["approve", "reject"]) }));
    const accountId = c.req.param("account");
    const tool = c.req.param("tool");
    if (b.decision === "approve") handle.pins.approve(accountId, tool);
    else handle.pins.reject(accountId, tool);
    if (b.decision === "approve") await handle.refreshAccount(accountId).catch(() => {});
    return c.json({ ok: true });
  });

  registerOnboardingRoutes(api, handle, auth, opts.onboarding);
  api.all("*", (c) => c.json({ error: "Not found" }, 404));

  app.route(API_PREFIX, api);

  // UI files. Unknown paths fall through, so the front door and OAuth callback mounted on the same app keep working.
  const assetsReady = opts.assets ? Promise.resolve(opts.assets) : embeddedAssets();
  const hostCheck = hostOriginCheck(hosts);

  // Browsers keep cookies per host name, so a session made on 127.0.0.1 is missing on localhost.
  // UI pages and launch links opened on localhost move to 127.0.0.1, where `pmcpg open` signs in.
  const redirectLocalhost =
    opts.bindHost.startsWith("127.") || opts.bindHost === "0.0.0.0"
      ? (c: Context): Response | undefined => {
          const url = new URL(c.req.url);
          const host = c.req.header("host") ?? "";
          const m = /^localhost(:\d+)?$/i.exec(host);
          if (!m) return undefined;
          c.header("cache-control", "no-store");
          return c.redirect(`${url.protocol}//127.0.0.1${m[1] ?? ""}${url.pathname}${url.search}`, 302);
        }
      : () => undefined;

  // Launch link from `pmcpg open` or `pmcpg serve`: swaps a one-time code for a session cookie.
  app.get(LAUNCH_PATH, hostCheck, (c) => {
    const moved = redirectLocalhost(c);
    if (moved) return moved;
    const ok = !auth.hasPassword() && auth.redeemLaunchCode(c.req.query("k"));
    if (ok) {
      auth.endSession(auth.sessionValue(c));
      auth.setSessionCookie(c, auth.createSession());
    }
    c.header("cache-control", "no-store");
    c.header("referrer-policy", "no-referrer");
    return c.redirect(ok ? "/" : auth.hasPassword() ? "/login/" : "/setup/", 302);
  });
  app.on(["GET", "HEAD"], "*", async (c, next) => {
    if (c.req.path.startsWith(`${API_PREFIX}/`)) return next();
    const res = assetResponse(await assetsReady, c.req.method, c.req.path);
    if (!res) return next();
    let allowed = false;
    const blocked = await hostCheck(c, async () => {
      allowed = true;
    });
    if (!allowed) return blocked as Response;
    return redirectLocalhost(c) ?? res;
  });

  auth.prune();
  return app;
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Timed out. The server did not answer.")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
