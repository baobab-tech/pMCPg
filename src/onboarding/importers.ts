// Read MCP server lists from AI apps on this computer. Read-only.
// Keeps names, commands, args and URLs. Environment variable and header VALUES are never read into results:
// only their names, so the user can fill them in the gateway's vault.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { argSecrets, redactUrlPath, urlSecrets } from "../core/config-store.ts";

export type AppId = "claude-desktop" | "claude-code" | "lm-studio" | "cursor" | "vscode";

export const APP_LABELS: Record<AppId, string> = {
  "claude-desktop": "Claude Desktop",
  "claude-code": "Claude Code",
  "lm-studio": "LM Studio",
  cursor: "Cursor",
  vscode: "VS Code",
};

export type FoundServer =
  | { transport: "stdio"; command: string; args: string[] }
  | { transport: "http" | "sse"; url: string };

export interface Found {
  app: AppId;
  /** Name the app uses for this server. */
  name: string;
  /** File it came from. */
  file: string;
  /** Claude Code project path, for project-scoped servers. */
  project?: string;
  server: FoundServer;
  envNames: string[];
  headerNames: string[];
  /** Query parameters that looked like secrets, removed from the URL (names only). */
  secretParams?: string[];
  /** A key or token is part of the URL path; the server cannot be imported without copying it. */
  secretInUrl?: boolean;
  /** The app ran it through `mcp-remote`; imported as the remote URL instead. */
  viaMcpRemote?: boolean;
  /** Claude Desktop extension (.mcpb). */
  extension?: boolean;
}

export interface Candidate {
  /** Stable key for selection: the URL, or the command line. */
  key: string;
  suggestedId: string;
  server: FoundServer;
  envNames: string[];
  headerNames: string[];
  secretParams: string[];
  /** See Found.secretInUrl. */
  secretInUrl?: boolean;
  foundIn: Pick<Found, "app" | "name" | "file" | "project" | "viaMcpRemote" | "extension">[];
}

export interface ScanEnv {
  home: string;
  platform: NodeJS.Platform;
  /** %APPDATA% on Windows. */
  appData?: string;
  /** %LOCALAPPDATA% on Windows (Microsoft Store build of Claude). */
  localAppData?: string;
}

export function defaultScanEnv(): ScanEnv {
  return {
    home: homedir(),
    platform: process.platform,
    appData: process.env.APPDATA,
    localAppData: process.env.LOCALAPPDATA,
  };
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
const keysOf = (v: unknown): string[] => (isObj(v) ? Object.keys(v) : []);

/** `npx -y mcp-remote https://x/mcp --header "Authorization: Bearer ${KEY}"` -> the URL and header names. */
export function unwrapMcpRemote(
  command: string,
  args: string[],
): { url: string; headerNames: string[] } | undefined {
  const all = [command, ...args];
  const i = all.findIndex((a) => /(^|\/|@)mcp-remote(@[\w.-]+)?$/.test(a));
  if (i < 0) return undefined;
  const url = all.slice(i + 1).find((a) => /^https?:\/\//.test(a));
  if (!url) return undefined;
  const headerNames: string[] = [];
  all.forEach((a, j) => {
    if (a === "--header" && all[j + 1]) {
      const name = (all[j + 1] as string).split(":")[0]?.trim();
      if (name) headerNames.push(name);
    }
  });
  return { url, headerNames };
}

const SECRET_PARAM =
  /(key|token|secret|password|passwd|pass|pwd|auth|credential|signature|sig|session|sid|jwt)$/i;

/**
 * Remove query parameters that look like secrets, so they never land in config.yaml: by name, or by a
 * value that looks like a key. A user name and password in the URL are removed too (`hadPassword`).
 */
export function stripSecretParams(raw: string): { url: string; removed: string[]; hadPassword?: boolean } {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { url: raw, removed: [] };
  }
  const hadPassword = u.password !== "";
  u.username = "";
  u.password = "";
  const removed = [...u.searchParams.entries()]
    .filter(
      ([k, v]) =>
        SECRET_PARAM.test(k.replace(/[-_]/g, "")) ||
        urlSecrets(`https://x/?${k}=${encodeURIComponent(v)}`).length,
    )
    .map(([k]) => k);
  for (const k of removed) u.searchParams.delete(k);
  return { url: u.toString(), removed: [...new Set(removed)], ...(hadPassword ? { hadPassword } : {}) };
}

/** Marker for a secret removed from an argument; applyImport turns it into a vault reference. */
export const ARG_SECRET_MARKER = /\{\{arg-secret:([A-Z0-9_]+)\}\}/g;

/**
 * Replace plain-text secrets in arguments with `{{arg-secret:ARG_n_SECRET}}` markers. The names become
 * values the user fills in after import, like env values. The secret itself is never kept.
 */
export function redactArgs(args: string[]): { args: string[]; names: string[] } {
  const spans = argSecrets(args);
  if (!spans.length) return { args, names: [] };
  const names: string[] = [];
  const out = args.map((a, i) => {
    const mine = spans.filter((s) => s.index === i).sort((x, y) => y.start - x.start);
    let v = a;
    mine.forEach((s, j) => {
      const name = `ARG_${i + 1}${mine.length > 1 ? `_${mine.length - j}` : ""}_SECRET`;
      names.push(name);
      v = `${v.slice(0, s.start)}{{arg-secret:${name}}}${v.slice(s.end)}`;
    });
    return v;
  });
  return { args: out, names: names.sort() };
}

/** URL fields of a Found: secret parameters and passwords removed, secrets in the path flagged. */
function cleanUrl(url: string) {
  const clean = stripSecretParams(url);
  // A key in the path cannot be moved to the vault; the server is listed without it and not imported.
  const keyInPath = urlSecrets(clean.url).includes("the path");
  return {
    url: keyInPath ? redactUrlPath(clean.url) : clean.url,
    extra: {
      ...(clean.removed.length ? { secretParams: clean.removed } : {}),
      ...(keyInPath ? { secretInUrl: true } : {}),
    },
    // user:password in the URL is HTTP Basic auth: ask for an Authorization header instead.
    headerNames: clean.hadPassword ? ["Authorization"] : [],
  };
}

/** One server entry in the common `{ command, args, env } | { url | serverUrl, type, headers }` shape. */
export function parseEntry(
  app: AppId,
  name: string,
  file: string,
  raw: unknown,
  project?: string,
): Found | undefined {
  if (!isObj(raw)) return undefined;
  const base = { app, name, file, ...(project ? { project } : {}) };
  const url =
    typeof raw.url === "string" ? raw.url : typeof raw.serverUrl === "string" ? raw.serverUrl : undefined;
  if (url) {
    const clean = cleanUrl(url);
    const transport =
      raw.type === "sse" || raw.transport === "sse" || /\/sse\/?$/.test(clean.url) ? "sse" : "http";
    return {
      ...base,
      server: { transport, url: clean.url },
      envNames: [],
      headerNames: [...new Set([...keysOf(raw.headers), ...clean.headerNames])],
      ...clean.extra,
    };
  }
  if (typeof raw.command !== "string" || !raw.command) return undefined;
  const args = strs(raw.args);
  const remote = unwrapMcpRemote(raw.command, args);
  if (remote) {
    const clean = cleanUrl(remote.url);
    return {
      ...base,
      server: { transport: "http", url: clean.url },
      ...clean.extra,
      envNames: [],
      headerNames: [...new Set([...remote.headerNames, ...clean.headerNames])],
      viaMcpRemote: true,
    };
  }
  const redacted = redactArgs(args);
  return {
    ...base,
    server: { transport: "stdio", command: raw.command, args: redacted.args },
    envNames: [...new Set([...keysOf(raw.env), ...redacted.names])],
    headerNames: [],
  };
}

function fromMap(app: AppId, file: string, map: unknown, project?: string): Found[] {
  return Object.entries(isObj(map) ? map : {})
    .map(([name, raw]) => parseEntry(app, name, file, raw, project))
    .filter((f): f is Found => !!f);
}

export function claudeDesktopDirs(env: ScanEnv): string[] {
  if (env.platform === "darwin") return [join(env.home, "Library", "Application Support", "Claude")];
  if (env.platform === "win32") {
    const dirs = [join(env.appData ?? join(env.home, "AppData", "Roaming"), "Claude")];
    const pkgs = join(env.localAppData ?? join(env.home, "AppData", "Local"), "Packages");
    try {
      for (const d of readdirSync(pkgs))
        if (d.startsWith("Claude_")) dirs.push(join(pkgs, d, "LocalCache", "Roaming", "Claude"));
    } catch {
      // no Store build
    }
    return dirs;
  }
  return [join(env.home, ".config", "Claude")];
}

function scanClaudeDesktop(env: ScanEnv): Found[] {
  const out: Found[] = [];
  for (const dir of claudeDesktopDirs(env)) {
    const file = join(dir, "claude_desktop_config.json");
    const cfg = readJson(file);
    if (isObj(cfg)) out.push(...fromMap("claude-desktop", file, cfg.mcpServers));
    // Desktop extensions (.mcpb): manifest.json in each extension folder. Settings (may hold secrets) are not read.
    const extDir = join(dir, "Claude Extensions");
    let exts: string[] = [];
    try {
      exts = readdirSync(extDir);
    } catch {
      continue;
    }
    for (const id of exts) {
      const mf = join(extDir, id, "manifest.json");
      const m = readJson(mf);
      if (!isObj(m) || !isObj(m.server) || !isObj(m.server.mcp_config)) continue;
      const mc = m.server.mcp_config;
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder used by .mcpb manifests
      const sub = (s: string) => s.replaceAll("${__dirname}", join(extDir, id));
      if (typeof mc.command !== "string") continue;
      out.push({
        app: "claude-desktop",
        name: typeof m.display_name === "string" ? m.display_name : typeof m.name === "string" ? m.name : id,
        file: mf,
        server: { transport: "stdio", command: sub(mc.command), args: strs(mc.args).map(sub) },
        envNames: [...new Set([...keysOf(mc.env), ...keysOf(m.user_config)])],
        headerNames: [],
        extension: true,
      });
    }
  }
  return out;
}

/**
 * Claude Code asks before it runs a server from a project's `.mcp.json`: anyone who can commit to the
 * repository can put a command there. Only servers the user approved in Claude Code are imported. The
 * answers live in `~/.claude.json` (per project) and in the project's `.claude/settings*.json`.
 */
export function projectServerApproved(name: string, sources: unknown[]): boolean {
  let all = false;
  const enabled = new Set<string>();
  const disabled = new Set<string>();
  for (const src of sources) {
    if (!isObj(src)) continue;
    if (src.enableAllProjectMcpServers === true) all = true;
    for (const n of strs(src.enabledMcpjsonServers)) enabled.add(n);
    for (const n of strs(src.disabledMcpjsonServers)) disabled.add(n);
  }
  if (disabled.has(name)) return false;
  return all || enabled.has(name);
}

function scanClaudeCode(env: ScanEnv): Found[] {
  const file = join(env.home, ".claude.json");
  const cfg = readJson(file);
  if (!isObj(cfg)) return [];
  const out = fromMap("claude-code", file, cfg.mcpServers);
  for (const [path, p] of Object.entries(isObj(cfg.projects) ? cfg.projects : {})) {
    if (isObj(p)) out.push(...fromMap("claude-code", file, p.mcpServers, path));
    const shared = join(path, ".mcp.json");
    if (existsSync(shared)) {
      const s = readJson(shared);
      const approvals = [
        p,
        readJson(join(path, ".claude", "settings.json")),
        readJson(join(path, ".claude", "settings.local.json")),
      ];
      if (isObj(s))
        out.push(
          ...fromMap("claude-code", shared, s.mcpServers, path).filter((f) =>
            projectServerApproved(f.name, approvals),
          ),
        );
    }
  }
  return out;
}

function scanSimple(app: AppId, file: string, key: "mcpServers" | "servers"): Found[] {
  const cfg = readJson(file);
  return isObj(cfg) ? fromMap(app, file, cfg[key]) : [];
}

export function vscodeUserDir(env: ScanEnv): string {
  if (env.platform === "darwin") return join(env.home, "Library", "Application Support", "Code", "User");
  if (env.platform === "win32")
    return join(env.appData ?? join(env.home, "AppData", "Roaming"), "Code", "User");
  return join(env.home, ".config", "Code", "User");
}

export function scanApps(env: ScanEnv = defaultScanEnv()): Found[] {
  return [
    ...scanClaudeDesktop(env),
    ...scanClaudeCode(env),
    ...scanSimple("lm-studio", join(env.home, ".lmstudio", "mcp.json"), "mcpServers"),
    ...scanSimple("cursor", join(env.home, ".cursor", "mcp.json"), "mcpServers"),
    ...scanSimple("vscode", join(vscodeUserDir(env), "mcp.json"), "servers"),
  ];
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "server"
  );
}

/** Flags that only skip install prompts; they do not make a different server. */
const NOISE_ARGS = new Set(["-y", "--yes"]);

export function keyOf(s: FoundServer): string {
  if (s.transport === "stdio") {
    const cmd = s.command.split(/[\\/]/).pop() ?? s.command;
    // A package launcher is the same server wherever it is installed: /opt/homebrew/bin/npx and npx match.
    const launcher = ["npx", "pnpx", "bunx", "uvx"].includes(cmd);
    const args = launcher ? s.args.filter((a) => !NOISE_ARGS.has(a)) : s.args;
    return [launcher ? cmd : s.command, ...args].join("\u0000");
  }
  const u = new URL(s.url);
  u.hash = "";
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}${u.search}`;
}

/** Merge what several apps list into one entry per distinct server. Remote servers first. */
export function mergeFound(found: Found[]): Candidate[] {
  const byKey = new Map<string, Candidate>();
  for (const f of found) {
    const key = keyOf(f.server);
    const c = byKey.get(key);
    const where = {
      app: f.app,
      name: f.name,
      file: f.file,
      ...(f.project ? { project: f.project } : {}),
      ...(f.viaMcpRemote ? { viaMcpRemote: true } : {}),
      ...(f.extension ? { extension: true } : {}),
    };
    if (c) {
      c.foundIn.push(where);
      c.envNames = [...new Set([...c.envNames, ...f.envNames])];
      c.headerNames = [...new Set([...c.headerNames, ...f.headerNames])];
      c.secretParams = [...new Set([...c.secretParams, ...(f.secretParams ?? [])])];
      if (f.secretInUrl) c.secretInUrl = true;
    } else {
      byKey.set(key, {
        key,
        suggestedId: slug(f.name),
        server: f.server,
        envNames: [...f.envNames],
        headerNames: [...f.headerNames],
        secretParams: [...(f.secretParams ?? [])],
        ...(f.secretInUrl ? { secretInUrl: true } : {}),
        foundIn: [where],
      });
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      Number(a.server.transport === "stdio") - Number(b.server.transport === "stdio") ||
      a.suggestedId.localeCompare(b.suggestedId),
  );
}

/** True for entries that point at this gateway (its URL, or `pmcpg connect`): importing them would loop. */
export function isThisGateway(server: FoundServer, gatewayPort: number): boolean {
  if (server.transport === "stdio") {
    const cmd =
      server.command
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.(exe|cmd|js)$/i, "") ?? "";
    const args = server.args.map(
      (a) =>
        a
          .split(/[\\/]/)
          .pop()
          ?.replace(/\.(exe|cmd|js)$/i, "") ?? a,
    );
    const all = [cmd, ...args];
    // Development runs start the CLI from source: `bun …/src/cli/main.ts connect <profile>`.
    const isSelf = (a: string, j: number) =>
      a === "pmcpg" ||
      a === "private-mcp-gateway" ||
      (a === "main.ts" && /[\\/]src[\\/]cli[\\/]main\.ts$/.test(server.args[j - 1] ?? ""));
    const i = all.findIndex(isSelf);
    return i >= 0 && all[i + 1] === "connect";
  }
  const u = new URL(server.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  return local && Number(u.port || (u.protocol === "https:" ? 443 : 80)) === gatewayPort;
}

/** Profile a gateway entry points at: from `/p/<id>/mcp` or `pmcpg connect <id>`; undefined for the universal /mcp. */
export function gatewayProfileOf(server: FoundServer): string | undefined {
  if (server.transport === "stdio") {
    const i = server.args.indexOf("connect");
    return i >= 0 ? server.args[i + 1] : undefined;
  }
  return /\/p\/([a-z0-9-]+)\/mcp\/?$/.exec(new URL(server.url).pathname)?.[1];
}

export interface AppStatus {
  app: AppId;
  label: string;
  /** The app's settings folder or file exists on this computer. */
  installed: boolean;
  /** The app has an entry pointing at this gateway. */
  connected: boolean;
  /** Profiles its gateway entries use ("all" for the universal URL). */
  profiles: string[];
}

/** Which AI apps are on this computer and which already point at this gateway. Read-only. */
export function appStatus(env: ScanEnv, gatewayPort: number): AppStatus[] {
  const found = scanApps(env);
  const installedPaths: Record<AppId, string[]> = {
    "claude-desktop": claudeDesktopDirs(env),
    "claude-code": [join(env.home, ".claude.json"), join(env.home, ".claude")],
    "lm-studio": [join(env.home, ".lmstudio")],
    cursor: [join(env.home, ".cursor")],
    vscode: [vscodeUserDir(env)],
  };
  return (Object.keys(APP_LABELS) as AppId[]).map((app) => {
    const mine = found.filter((f) => f.app === app && !f.project && isThisGateway(f.server, gatewayPort));
    return {
      app,
      label: APP_LABELS[app],
      installed: installedPaths[app].some((p) => existsSync(p)),
      connected: mine.length > 0,
      profiles: [...new Set(mine.map((f) => gatewayProfileOf(f.server) ?? "all"))],
    };
  });
}
