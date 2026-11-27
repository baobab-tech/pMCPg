// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${NAME} is the placeholder syntax other apps read
// Export the server list for other AI apps, as a backup or to share. Reads config only, never the vault:
// every env and header value becomes a placeholder, and OAuth servers keep only their URL.
import type { AccountDef, Config, ServerDef } from "../core/config.ts";

export const EXPORT_FORMATS = [
  "mcp-json",
  "vscode",
  "claude-desktop",
  "gemini",
  "zed",
  "codex",
  "goose",
  "pmcpg",
] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const FORMAT_INFO: Record<ExportFormat, { label: string; file: string; hint: string }> = {
  "mcp-json": {
    label: "Claude Code, LM Studio, Windsurf and most apps",
    file: "mcp.json",
    hint: "The common mcpServers format. Claude Code reads it as .mcp.json and fills ${NAME} from your environment.",
  },
  vscode: {
    label: "VS Code",
    file: "mcp.json",
    hint: "VS Code asks for each key the first time a server starts.",
  },
  "claude-desktop": {
    label: "Claude Desktop",
    file: "claude_desktop_config.json",
    hint: "Command servers only. Add web servers in Claude Desktop under Settings, Connectors.",
  },
  gemini: { label: "Gemini CLI", file: "settings.json", hint: "Goes in ~/.gemini/settings.json." },
  zed: { label: "Zed", file: "settings.json", hint: "Goes in Zed's settings.json." },
  codex: {
    label: "Codex",
    file: "config.toml",
    hint: "Goes in ~/.codex/config.toml. Codex reads keys from environment variables of the same name.",
  },
  goose: {
    label: "Goose",
    file: "config.yaml",
    hint: "Add the extensions to ~/.config/goose/config.yaml, then run goose configure to enter keys.",
  },
  pmcpg: {
    label: "pMCPg (config.yaml)",
    file: "pmcpg-servers.yaml",
    hint: "Servers and accounts for another pMCPg: import it there under Import, From a file.",
  },
};

export interface ExportOptions {
  /** For sharing: one entry per server, no account labels, home folder written as ${HOME}. */
  share?: boolean;
  /** Home folder to hide when sharing. */
  home?: string;
}

export interface ExportResult {
  filename: string;
  content: string;
  /** How many servers the file holds. */
  count: number;
  /** Servers left out, with the reason. */
  skipped: { name: string; reason: string }[];
  /** Placeholders the user fills in after importing. */
  placeholders: string[];
  /** Servers that sign in through the browser: the importing app asks again. */
  signIn: string[];
}

/** Commands that resolve from PATH on any machine; a full path to them is machine-specific. */
const PORTABLE = /^(npx|npm|pnpm|bunx|bun|uvx|uv|node|deno|docker|podman|python3?|pipx)(\.exe|\.cmd)?$/i;

/** One server as the export sees it: commands and URLs kept, values reduced to placeholder names. */
interface Entry {
  name: string;
  server: ServerDef;
  /** Env var name to placeholder name. Values are never kept. */
  env: Record<string, string>;
  /** Header name to its value with placeholders, e.g. "Bearer ${GITHUB_AUTHORIZATION}". */
  headers: Record<string, { scheme?: string; ref: string }>;
  args: string[];
  oauth: boolean;
}

function envName(s: string): string {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Last segment of a vault key, as an env-style name: account/x/env/ARG_1_SECRET -> ARG_1_SECRET. */
function refName(key: string): string {
  return envName(key.split("/").pop() ?? key) || "SECRET";
}

const PLACEHOLDER = "\uE000"; // marks a placeholder inside args until the format picks its syntax

function argWithRefs(arg: string): string {
  if (/^vault:[\w./@-]+$/.test(arg)) return `${PLACEHOLDER}${refName(arg.slice(6))}${PLACEHOLDER}`;
  return arg.replace(
    /\{\{vault:([\w./@-]+)\}\}/g,
    (_, key: string) => `${PLACEHOLDER}${refName(key)}${PLACEHOLDER}`,
  );
}

function hideHome(s: string, home: string | undefined): string {
  if (!home || home.length < 2) return s;
  return s.split(home).join("${HOME}");
}

function portableCommand(cmd: string): string {
  const base = cmd.split(/[\\/]/).pop() ?? cmd;
  return PORTABLE.test(base) ? base.replace(/\.(exe|cmd)$/i, "") : cmd;
}

function buildEntries(config: Config, opts: ExportOptions): Entry[] {
  const byServer = new Map<string, [string, AccountDef][]>();
  for (const [id, a] of Object.entries(config.accounts)) {
    if (!config.servers[a.server]) continue;
    byServer.set(a.server, [...(byServer.get(a.server) ?? []), [id, a]]);
  }
  const entries: Entry[] = [];
  for (const [sid, server] of Object.entries(config.servers)) {
    const accounts = byServer.get(sid) ?? [];
    // Sharing writes one entry per server; a backup keeps each account, since each is its own sign-in.
    const groups: [string, [string, AccountDef][]][] =
      opts.share || accounts.length <= 1 ? [[sid, accounts]] : accounts.map(([id, a]) => [id, [[id, a]]]);
    for (const [name, accs] of groups) {
      const env: Record<string, string> = {};
      const headers: Entry["headers"] = {};
      let args: string[] = [];
      if (server.transport === "stdio") {
        for (const k of Object.keys(server.env)) env[k] = envName(k) || "VALUE";
        for (const [, a] of accs) for (const k of Object.keys(a.env)) env[k] = envName(k) || "VALUE";
        args = server.args.map(argWithRefs);
        if (opts.share) args = args.map((a) => hideHome(a, opts.home));
      }
      for (const [, a] of accs) {
        if (a.auth.type !== "header") continue;
        for (const [h, v] of Object.entries(a.auth.headers)) {
          const scheme = v.match(/^(Bearer|Basic|Token)\s+\{\{vault:[\w./@-]+\}\}$/i)?.[1];
          headers[h] = { ...(scheme ? { scheme } : {}), ref: envName(`${sid}_${h}`) };
        }
      }
      const oauth = accs.some(([, a]) => a.auth.type === "oauth");
      let srv = server;
      if (server.transport === "stdio") {
        const command = opts.share
          ? hideHome(portableCommand(server.command), opts.home)
          : portableCommand(server.command);
        srv = { ...server, command, cwd: opts.share ? undefined : server.cwd };
      }
      entries.push({ name, server: srv, env, headers, args, oauth });
    }
  }
  return entries;
}

type Ref = (name: string) => string;

function argsWith(e: Entry, ref: Ref): string[] {
  return e.args.map((a) => a.replace(/\uE000([A-Z0-9_]+)\uE000/g, (_, n: string) => ref(n)));
}

function argNames(e: Entry): string[] {
  return e.args.flatMap((a) => [...a.matchAll(/\uE000([A-Z0-9_]+)\uE000/g)].map((m) => m[1] as string));
}

function headerValues(e: Entry, ref: Ref): Record<string, string> {
  return Object.fromEntries(
    Object.entries(e.headers).map(([h, v]) => [h, v.scheme ? `${v.scheme} ${ref(v.ref)}` : ref(v.ref)]),
  );
}

function envValues(e: Entry, ref: Ref): Record<string, string> {
  return Object.fromEntries(Object.entries(e.env).map(([k, n]) => [k, ref(n)]));
}

function placeholderNames(e: Entry): string[] {
  return [...Object.values(e.env), ...argNames(e), ...Object.values(e.headers).map((h) => h.ref)];
}

function nonEmpty<T extends object>(o: T): T | undefined {
  return Object.keys(o).length ? o : undefined;
}

const dollar: Ref = (n) => `\${${n}}`;

/** The common `{ command, args, env } | { url, headers }` entry. */
function mcpEntry(e: Entry, ref: Ref, withType: boolean): Record<string, unknown> {
  const s = e.server;
  if (s.transport === "stdio")
    return {
      ...(withType ? { type: "stdio" } : {}),
      command: s.command,
      args: argsWith(e, ref),
      ...(nonEmpty(e.env) ? { env: envValues(e, ref) } : {}),
      ...(s.cwd ? { cwd: s.cwd } : {}),
    };
  return {
    ...(withType ? { type: s.transport } : {}),
    url: s.url,
    ...(nonEmpty(e.headers) ? { headers: headerValues(e, ref) } : {}),
  };
}

function toml(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(toml).join(", ")}]`;
  if (v && typeof v === "object")
    return `{ ${Object.entries(v)
      .map(([k, x]) => `${tomlKey(k)} = ${toml(x)}`)
      .join(", ")} }`;
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  return JSON.stringify(String(v));
}

function tomlKey(k: string): string {
  return /^[A-Za-z0-9_-]+$/.test(k) ? k : JSON.stringify(k);
}

function codex(entries: Entry[]): string {
  const blocks = entries.map((e) => {
    const s = e.server;
    const lines = [`[mcp_servers.${tomlKey(e.name)}]`];
    if (s.transport === "stdio") {
      lines.push(`command = ${toml(s.command)}`, `args = ${toml(argsWith(e, dollar))}`);
      // Codex forwards these from its own environment: no value in the file.
      const forward = [...new Set([...Object.keys(e.env), ...argNames(e)])];
      if (forward.length) lines.push(`env_vars = ${toml(forward)}`);
      if (s.cwd) lines.push(`cwd = ${toml(s.cwd)}`);
    } else {
      lines.push(`url = ${toml(s.url)}`);
      const rest: Record<string, string> = {};
      for (const [h, v] of Object.entries(e.headers)) {
        if (h.toLowerCase() === "authorization" && v.scheme?.toLowerCase() === "bearer")
          lines.push(`bearer_token_env_var = ${toml(v.ref)}`);
        else rest[h] = v.ref;
      }
      if (nonEmpty(rest)) lines.push(`env_http_headers = ${toml(rest)}`);
    }
    return lines.join("\n");
  });
  return `${blocks.join("\n\n")}\n`;
}

function goose(entries: Entry[]): string {
  const extensions = Object.fromEntries(
    entries.map((e) => {
      const s = e.server;
      const ext =
        s.transport === "stdio"
          ? {
              name: e.name,
              type: "stdio",
              enabled: true,
              cmd: s.command,
              args: argsWith(e, dollar),
              // Goose keeps these in its own secret store; goose configure asks for them.
              env_keys: [...new Set([...Object.keys(e.env), ...argNames(e)])],
              timeout: 300,
            }
          : {
              name: e.name,
              type: s.transport === "sse" ? "sse" : "streamable_http",
              enabled: true,
              uri: s.url,
              ...(nonEmpty(e.headers) ? { headers: headerValues(e, dollar) } : {}),
              timeout: 300,
            };
      return [e.name, ext];
    }),
  );
  return `${Bun.YAML.stringify({ extensions }, null, 2)}\n`;
}

/** Keep a value only when it is a vault reference; plain values are dropped like every other format. */
function refOnly(v: string): string {
  return v.startsWith("vault:") || /\{\{vault:[\w./@-]+\}\}/.test(v) ? v : "";
}

function pmcpgYaml(config: Config, opts: ExportOptions): string {
  const servers = Object.fromEntries(
    Object.entries(config.servers).map(([id, s]) => {
      if (s.transport !== "stdio") return [id, s];
      const strip = (x: string) => (opts.share ? hideHome(x, opts.home) : x);
      return [
        id,
        {
          ...s,
          command: strip(s.command),
          args: s.args.map(strip),
          env: Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, refOnly(v)])),
          cwd: opts.share ? undefined : s.cwd,
        },
      ];
    }),
  );
  const accounts = Object.fromEntries(
    Object.entries(config.accounts).map(([id, a]) => [
      id,
      {
        server: a.server,
        ...(a.label && !opts.share ? { label: a.label } : {}),
        auth:
          a.auth.type === "header"
            ? {
                type: "header",
                headers: Object.fromEntries(Object.entries(a.auth.headers).map(([k, v]) => [k, refOnly(v)])),
              }
            : a.auth,
        env: Object.fromEntries(Object.entries(a.env).map(([k, v]) => [k, refOnly(v)])),
        ...(a.urlParams
          ? { urlParams: Object.fromEntries(Object.entries(a.urlParams).map(([k, v]) => [k, refOnly(v)])) }
          : {}),
      },
    ]),
  );
  const doc = JSON.parse(JSON.stringify({ version: 1, servers, accounts }));
  return `${Bun.YAML.stringify(doc, null, 2)}\n`;
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`;

export function exportServers(config: Config, format: ExportFormat, opts: ExportOptions = {}): ExportResult {
  const all = buildEntries(config, opts);
  const skipped: ExportResult["skipped"] = [];
  let entries = all;
  if (format === "claude-desktop") {
    entries = all.filter((e) => e.server.transport === "stdio");
    for (const e of all)
      if (e.server.transport !== "stdio")
        skipped.push({
          name: e.name,
          reason: "Web server: add it in Claude Desktop under Settings, Connectors",
        });
  }
  const names = [...new Set(entries.flatMap(placeholderNames))].sort();
  const map = (f: (e: Entry) => unknown) => Object.fromEntries(entries.map((e) => [e.name, f(e)]));

  let content: string;
  let placeholders = names;
  switch (format) {
    case "mcp-json":
      content = json({ mcpServers: map((e) => mcpEntry(e, dollar, true)) });
      break;
    case "claude-desktop":
      content = json({ mcpServers: map((e) => mcpEntry(e, dollar, false)) });
      break;
    case "vscode": {
      const id = (n: string) => n.toLowerCase().replace(/_/g, "-");
      content = json({
        inputs: names.map((n) => ({ type: "promptString", id: id(n), description: n, password: true })),
        servers: map((e) => mcpEntry(e, (n) => `\${input:${id(n)}}`, true)),
      });
      break;
    }
    case "gemini":
      content = json({
        mcpServers: map((e) => {
          const s = e.server;
          if (s.transport === "stdio") return mcpEntry(e, dollar, false);
          const headers = nonEmpty(e.headers) ? { headers: headerValues(e, dollar) } : {};
          return s.transport === "http" ? { httpUrl: s.url, ...headers } : { url: s.url, ...headers };
        }),
      });
      break;
    case "zed":
      content = json({ context_servers: map((e) => mcpEntry(e, dollar, false)) });
      break;
    case "codex":
      content = codex(entries);
      break;
    case "goose":
      content = goose(entries);
      break;
    case "pmcpg":
      content = pmcpgYaml(config, opts);
      placeholders = [];
      break;
  }
  return {
    filename: FORMAT_INFO[format].file,
    content,
    count: format === "pmcpg" ? Object.keys(config.servers).length : entries.length,
    skipped,
    placeholders,
    signIn: entries.filter((e) => e.oauth).map((e) => e.name),
  };
}
