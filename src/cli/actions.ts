// Implementations of the CLI commands that need gateway state. Registered in commands.ts by path.
import { type Config, ProfileDef, Slug } from "../core/config.ts";
import { loadConfig, saveConfig, validateConfig } from "../core/config-store.ts";
import { profileIds, resolveProfile } from "../core/profiles.ts";
import { frontDoorUrl, runBridge } from "../frontdoor/bridge.ts";
import { openBrowser } from "../gateway/browser.ts";
import { ensureToken, openState, startGateway } from "../gateway/runtime.ts";
import { type ProbeResult, probeServer } from "../onboarding/probe.ts";
import { vaultKeys } from "../vault/vault.ts";
import { EXIT_ERROR, EXIT_OK, EXIT_USAGE, type Io, type Parsed } from "./cli.ts";
import { uiLink } from "./commands-ui.ts";
import { readSecret } from "./secret-input.ts";

type Action = (p: Parsed, io: Io) => Promise<number>;

const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? [v] : []);

/** Split a command line into words. Supports single and double quotes; no other shell syntax. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3] ?? "");
  return out;
}

/** Account id for a server and an optional account name: "linear" or "linear-work". */
export function accountId(server: string, name?: string): string {
  return name ? `${server}-${name}` : server;
}

async function edit(io: Io, change: (c: Config) => string | undefined): Promise<number> {
  const { paths: p, db } = await openState();
  db.close();
  const cfg = loadConfig(p.config);
  const problem = change(cfg);
  if (problem) {
    io.err(problem);
    return EXIT_USAGE;
  }
  saveConfig(p.config, validateConfig(cfg, p.config));
  await notifyReload(io);
  return EXIT_OK;
}

/** Ask a running service to reload config.yaml. Silent when the service is not running. */
export async function notifyReload(io: Io): Promise<void> {
  const r = await api("POST", "/api/reload").catch(() => undefined);
  if (r && !r.ok) io.err(`The running gateway rejected the new config: ${await r.text()}`);
}

async function api(method: string, path: string): Promise<Response> {
  return adminApi(method, path);
}

/** Calls the running gateway's local admin API with the admin token from the vault. */
export async function adminApi(method: string, path: string, body?: unknown): Promise<Response> {
  const { config, vault, db } = await openState();
  const token = await vault.get(vaultKeys.adminToken());
  db.close();
  if (!token) throw new Error("gateway has never run");
  return fetch(`http://127.0.0.1:${config.gateway.port}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(5000),
  });
}

export const actions: Record<string, Action> = {
  async serve(p, io) {
    const port = str(p.values.port) ? Number(p.values.port) : undefined;
    const gw = await startGateway({ host: str(p.values.host), port });
    const cfg = gw.config();
    io.out(`pMCPg running at ${gw.url}`);
    io.out(`  web UI: ${uiLink(gw.db, str(p.values.host) ?? cfg.gateway.host, port ?? cfg.gateway.port)}`);
    io.out("  (later: `pmcpg open`)");
    for (const id of profileIds(cfg))
      io.out(`  profile ${id}: ${frontDoorUrl(port ?? cfg.gateway.port, id)}`);
    io.out("Stop with Ctrl+C.");
    await new Promise<void>((resolve) => {
      const stop = () => resolve();
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
    });
    await gw.close();
    return EXIT_OK;
  },

  async connect(p) {
    const profile = p.positionals[0] as string;
    const { config, vault, db } = await openState();
    const bridge = await runBridge({
      profile,
      port: config.gateway.port,
      getToken: async (id) => {
        const t = await vault.get(vaultKeys.clientToken(id));
        if (!t) throw new Error(`No token for profile ${id}. Start the gateway once with "pmcpg serve".`);
        return t;
      },
    });
    await new Promise<void>((resolve) => process.stdin.once("close", resolve));
    await bridge.close();
    db.close();
    return EXIT_OK;
  },

  "server add": async (p, io) => {
    const name = p.positionals[0] as string;
    const url = str(p.values.url);
    const command = str(p.values.command);
    if (!Slug.safeParse(name).success)
      return usage(io, `Invalid server name "${name}": use lowercase letters, digits and dashes.`);
    if (!url === !command) return usage(io, "Give exactly one of --url or --command.");
    let local = false;
    let probed: ProbeResult | undefined;
    if (url) {
      try {
        const h = new URL(url).hostname;
        local = h === "localhost" || h === "127.0.0.1" || h === "[::1]";
      } catch {
        return usage(io, "--url is not a valid URL.");
      }
      probed = await probeServer(url, { allowInsecure: local });
      if (!probed.ok) return fail(io, probed.error);
      const a = probed.auth;
      io.out(
        a.type === "none"
          ? "No sign-in needed."
          : a.type === "oauth"
            ? `Signs in with ${new URL(a.issuer).host}. Next: pmcpg account signin ${name}`
            : `Needs a key. Next: pmcpg account add ${name} --header Authorization`,
      );
    }
    return edit(io, (c) => {
      if (c.servers[name]) return `Server "${name}" already exists.`;
      if (url)
        c.servers[name] = {
          transport: probed?.ok ? probed.transport : "http",
          url,
          trust: [],
          allowInsecure: local,
        };
      else {
        const [cmd, ...args] = splitCommand(command as string);
        c.servers[name] = {
          transport: "stdio",
          command: cmd as string,
          args,
          env: {},
          trust: [],
          allowInsecure: false,
        };
      }
      io.out(`Added server ${name}. Next: pmcpg account add ${name}  (or account signin for OAuth)`);
      return undefined;
    });
  },
  "server list": async (_p, io) => {
    const { config, db } = await openState();
    db.close();
    for (const [id, s] of Object.entries(config.servers))
      io.out(`${id}\t${s.transport}\t${s.transport === "stdio" ? [s.command, ...s.args].join(" ") : s.url}`);
    return EXIT_OK;
  },
  "server remove": async (p, io) => {
    const name = p.positionals[0] as string;
    return edit(io, (c) => {
      if (!c.servers[name]) return `No server named "${name}".`;
      const used = Object.entries(c.accounts)
        .filter(([, a]) => a.server === name)
        .map(([id]) => id);
      if (used.length) return `Remove its accounts first: ${used.join(", ")}`;
      delete c.servers[name];
      return undefined;
    });
  },

  "account add": async (p, io) => {
    const server = p.positionals[0] as string;
    const id = accountId(server, str(p.values.name));
    const { config, vault, db } = await openState();
    try {
      if (!config.servers[server]) return usage(io, `No server named "${server}".`);
      if (config.accounts[id]) return usage(io, `Account "${id}" already exists.`);
      const headers: Record<string, string> = {};
      for (const h of list(p.values.header)) {
        const key = vaultKeys.accountSecret(id, `header-${h.toLowerCase()}`);
        await vault.set(key, await readSecret(`Value for header ${h}`));
        headers[h] = `{{vault:${key}}}`;
      }
      const env: Record<string, string> = {};
      for (const e of list(p.values.env)) {
        const key = vaultKeys.accountSecret(id, `env-${e}`);
        await vault.set(key, await readSecret(`Value for ${e}`));
        env[e] = `vault:${key}`;
      }
      config.accounts[id] = {
        server,
        ...(str(p.values.label) ? { label: str(p.values.label) } : {}),
        auth: Object.keys(headers).length ? { type: "header", headers } : { type: "none" },
        env,
      };
    } finally {
      db.close();
    }
    return edit(io, (c) => {
      c.accounts[id] = config.accounts[id] as Config["accounts"][string];
      io.out(`Added account ${id}. Secrets are in the vault, not in config.yaml.`);
      return undefined;
    });
  },
  "account signin": async (p, io) => {
    const server = p.positionals[0] as string;
    const id = accountId(server, str(p.values.name));
    const code = await edit(io, (c) => {
      const s = c.servers[server];
      if (!s) return `No server named "${server}".`;
      if (s.transport === "stdio") return `"${server}" is a local server; use "pmcpg account add".`;
      const existing = c.accounts[id];
      if (existing && existing.auth.type !== "oauth") return `Account "${id}" does not use OAuth.`;
      if (!existing) c.accounts[id] = { server, auth: { type: "oauth" }, env: {} };
      return undefined;
    });
    if (code !== EXIT_OK) return code;
    const r = await api("POST", `/api/accounts/${id}/signin`).catch(() => undefined);
    if (!r)
      return fail(
        io,
        `Start the gateway first ("pmcpg serve" or "pmcpg service install"), then run this again.`,
      );
    const body = (await r.json()) as { authorizationUrl?: string; error?: string };
    if (!body.authorizationUrl) return fail(io, body.error ?? "Sign-in could not start.");
    io.out(`Opening your browser to sign in to ${server} as account ${id}.`);
    io.out(`If it does not open, visit:\n${body.authorizationUrl}`);
    await openBrowser(body.authorizationUrl);
    return EXIT_OK;
  },
  "account list": async (_p, io) => {
    const { config, db } = await openState();
    db.close();
    for (const [id, a] of Object.entries(config.accounts))
      io.out(`${id}\tserver=${a.server}\tauth=${a.auth.type}${a.label ? `\t${a.label}` : ""}`);
    return EXIT_OK;
  },
  "account remove": async (p, io) => {
    const id = p.positionals[0] as string;
    await api("POST", `/api/accounts/${id}/signout`).catch(() => undefined);
    const { vault, db } = await openState();
    for (const key of await vault.list(`account/${id}/`)) await vault.delete(key);
    db.close();
    return edit(io, (c) => {
      if (!c.accounts[id]) return `No account named "${id}".`;
      delete c.accounts[id];
      for (const prof of Object.values(c.profiles)) prof.accounts = prof.accounts.filter((a) => a !== id);
      return undefined;
    });
  },

  "profile create": async (p, io) => {
    const name = p.positionals[0] as string;
    if (!Slug.safeParse(name).success || name === "all") return usage(io, `Invalid profile name "${name}".`);
    const privacy = str(p.values.privacy) ?? "standard";
    const parsed = ProfileDef.safeParse({ privacy });
    if (!parsed.success) return usage(io, "Privacy must be off, standard or strict.");
    return edit(io, (c) => {
      if (c.profiles[name]) return `Profile "${name}" already exists.`;
      c.profiles[name] = parsed.data;
      return undefined;
    });
  },
  "profile add": async (p, io) => {
    const [name, ...accounts] = p.positionals as [string, ...string[]];
    return edit(io, (c) => {
      const prof = c.profiles[name];
      if (!prof) return `No profile named "${name}".`;
      const missing = accounts.filter((a) => !c.accounts[a]);
      if (missing.length) return `No account named: ${missing.join(", ")}`;
      prof.accounts = [...new Set([...prof.accounts, ...accounts])];
      return undefined;
    });
  },
  "profile list": async (_p, io) => {
    const { config, db } = await openState();
    db.close();
    for (const id of profileIds(config)) {
      const r = resolveProfile(config, id);
      io.out(
        `${id}\tprivacy=${r?.def.privacy}\t${frontDoorUrl(config.gateway.port, id)}\t${r?.accounts.join(", ")}`,
      );
    }
    return EXIT_OK;
  },
  "profile remove": async (p, io) => {
    const name = p.positionals[0] as string;
    const { vault, db } = await openState();
    await vault.delete(vaultKeys.clientToken(name));
    db.close();
    return edit(io, (c) => {
      if (!c.profiles[name]) return `No profile named "${name}".`;
      delete c.profiles[name];
      return undefined;
    });
  },
  "profile token": async (p, io) => {
    const name = p.positionals[0] as string;
    const { config, vault, db } = await openState();
    try {
      if (!resolveProfile(config, name)) return usage(io, `No profile named "${name}".`);
      const token = await ensureToken(vault, vaultKeys.clientToken(name));
      io.out(`URL:    ${frontDoorUrl(config.gateway.port, name)}`);
      io.out(`Header: Authorization: Bearer ${token}`);
      return EXIT_OK;
    } finally {
      db.close();
    }
  },
};

function usage(io: Io, msg: string): number {
  io.err(msg);
  return EXIT_USAGE;
}
function fail(io: Io, msg: string): number {
  io.err(msg);
  return EXIT_ERROR;
}
