// Point AI apps at the gateway. Every change is planned first (shown to the user), then applied with a backup.
// Only the app's MCP server list is touched; every other setting in its file is kept as is.
// Every app that can launch a command gets the stdio bridge (`pmcpg connect <profile>`), which reads the
// profile token itself: no token is written into another app's files. HTTP with a bearer token is an
// explicit fallback for the file-based apps only.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { effectivePath, resolveCommand, systemEnvironment } from "../connectors/stdio-env.ts";
import { claudeDesktopDirs, type ScanEnv, vscodeUserDir } from "./importers.ts";

export type ConnectApp = "claude-desktop" | "claude-code" | "lm-studio" | "cursor" | "vscode";

/** "stdio": the app runs `pmcpg connect <profile>`. "http": the app holds the URL and the profile token. */
export type ConnectTransport = "stdio" | "http";

export interface ConnectPlan {
  app: ConnectApp;
  transport: ConnectTransport;
  /** File that will change. Undefined when the app is set up by a command instead (Claude Code). */
  file?: string;
  /** Name of the gateway entry in the app. */
  entryName: string;
  /** Entries removed from the app because the gateway now provides them. */
  remove: string[];
  /** The app's MCP section after the change, secrets shown as "•••". For the confirm screen. */
  preview?: string;
  /** Commands to run instead of a file change (Claude Code). */
  commands?: string[];
  /** Plain-language steps after applying, e.g. "Quit and reopen Claude Desktop." */
  after: string[];
}

export interface ConnectInput {
  profile: string;
  /** http://127.0.0.1:7431 */
  gatewayUrl: string;
  token: string;
  /** Command line that runs pmcpg, e.g. ["/usr/local/bin/pmcpg"] or [bun, main.ts] in development. */
  pmcpg: string[];
  /** Entry names in the app to remove (already imported into the gateway). */
  remove?: string[];
  entryName?: string;
  /** Default "stdio". "http" writes the token into the app's file; Claude Code and Claude Desktop refuse it. */
  transport?: ConnectTransport;
}

/** How this process can be started again from another app's config. Absolute paths: GUI apps have a short PATH. */
export function selfCommand(): string[] {
  const compiled = !/(^|[\\/])bun(\.exe)?$/i.test(process.execPath);
  // Development: `bun src/cli/main.ts`, so the app runs bun with the absolute path of main.ts.
  return compiled ? [process.execPath] : [process.execPath, Bun.main];
}

/** The stdio bridge command line for a profile. */
function bridge(i: ConnectInput): { command: string; args: string[] } {
  const [command, ...rest] = i.pmcpg;
  if (!command || !isAbsolute(command)) throw new Error("The pmcpg command must be an absolute path.");
  return { command, args: [...rest, "connect", i.profile] };
}

/** Entry names go into argv of `claude mcp …`; a leading "-" would read as an option. */
function checkName(name: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point.
  if (!name || name.startsWith("-") || /[\x00-\x1f]/.test(name))
    throw new Error(`Invalid entry name: ${name}`);
  return name;
}

const mask = (s: string, token: string) => s.split(token).join("•••");

function readJsonFile(file: string): Record<string, unknown> {
  if (!existsSync(file)) return {};
  const parsed = JSON.parse(readFileSync(file, "utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`${file} is not a JSON object; not changing it.`);
  return parsed as Record<string, unknown>;
}

interface FileTarget {
  file: string;
  key: "mcpServers" | "servers";
  entry: (i: ConnectInput, transport: ConnectTransport) => Record<string, unknown>;
  /** The app's file accepts a URL plus headers as a fallback. */
  http: boolean;
  after: string[];
}

const profileUrl = (i: ConnectInput) => `${i.gatewayUrl}/p/${i.profile}/mcp`;
const bearer = (i: ConnectInput) => ({ Authorization: `Bearer ${i.token}` });

function fileTarget(app: ConnectApp, env: ScanEnv): FileTarget | undefined {
  // Cursor, LM Studio and Claude Desktop share the `mcpServers` shape.
  const mcpServers = (i: ConnectInput, t: ConnectTransport) =>
    t === "http" ? { url: profileUrl(i), headers: bearer(i) } : bridge(i);
  switch (app) {
    case "claude-desktop":
      return {
        file: join(claudeDesktopDirs(env)[0] as string, "claude_desktop_config.json"),
        key: "mcpServers",
        entry: mcpServers,
        // Claude Desktop's file accepts local commands only.
        http: false,
        after: ["Quit Claude Desktop completely and open it again."],
      };
    case "lm-studio":
      return {
        file: join(env.home, ".lmstudio", "mcp.json"),
        key: "mcpServers",
        entry: mcpServers,
        http: true,
        after: ["LM Studio picks up the change on its own; if not, restart it."],
      };
    case "cursor":
      return {
        file: join(env.home, ".cursor", "mcp.json"),
        key: "mcpServers",
        entry: mcpServers,
        http: true,
        after: ["Open Cursor Settings → MCP and check pmcpg is enabled."],
      };
    case "vscode":
      return {
        file: join(vscodeUserDir(env), "mcp.json"),
        key: "servers",
        entry: (i, t) =>
          t === "http"
            ? { type: "http", url: profileUrl(i), headers: bearer(i) }
            : { type: "stdio", ...bridge(i) },
        http: true,
        after: ["In VS Code, run “MCP: List Servers” and start pmcpg."],
      };
    default:
      return undefined;
  }
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`;
}

const defaultEntryName = (profile: string) => (profile === "all" ? "pmcpg" : `pmcpg-${profile}`);

function transportFor(app: ConnectApp, t: FileTarget | undefined, input: ConnectInput): ConnectTransport {
  const transport = input.transport ?? "stdio";
  if (transport === "http" && !t?.http)
    throw new Error(`${app} is connected through the stdio bridge only; HTTP is not offered for it.`);
  return transport;
}

/** `claude mcp …` argument lists. Names sit after `--` or are checked, so none reads as an option. */
function claudeCodeArgs(input: ConnectInput, entryName: string, remove: string[]) {
  const b = bridge(input);
  return {
    replace: ["mcp", "remove", "--scope", "user", "--", checkName(entryName)],
    add: [
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      checkName(entryName),
      "--",
      b.command,
      ...b.args,
    ],
    remove: remove.map((n) => ["mcp", "remove", "--scope", "user", "--", checkName(n)]),
  };
}

export function planConnect(app: ConnectApp, input: ConnectInput, env: ScanEnv): ConnectPlan {
  const entryName = input.entryName ?? defaultEntryName(input.profile);
  const remove = (input.remove ?? []).filter((n) => n !== entryName);
  if (app === "claude-code") {
    transportFor(app, undefined, input);
    const a = claudeCodeArgs(input, entryName, remove);
    return {
      app,
      transport: "stdio",
      entryName,
      remove,
      commands: [a.add, ...a.remove].map((c) => ["claude", ...c].map(shellQuote).join(" ")),
      after: ["Start a new Claude Code session; run /mcp to check pmcpg is connected."],
    };
  }
  const t = fileTarget(app, env);
  if (!t) throw new Error(`Unknown app: ${app}`);
  const transport = transportFor(app, t, input);
  const next = applyToJson(readJsonFile(t.file), t, transport, input, entryName, remove);
  return {
    app,
    transport,
    file: t.file,
    entryName,
    remove,
    preview: mask(JSON.stringify({ [t.key]: next[t.key] }, null, 2), input.token),
    after: t.after,
  };
}

function applyToJson(
  doc: Record<string, unknown>,
  t: FileTarget,
  transport: ConnectTransport,
  input: ConnectInput,
  entryName: string,
  remove: string[],
): Record<string, unknown> {
  const current = doc[t.key];
  const servers: Record<string, unknown> =
    typeof current === "object" && current !== null && !Array.isArray(current)
      ? { ...(current as Record<string, unknown>) }
      : {};
  for (const n of remove) delete servers[n];
  servers[entryName] = t.entry(input, transport);
  return { ...doc, [t.key]: servers };
}

export interface ApplyResult {
  file?: string;
  backup?: string;
  /** For Claude Code: commands run and their exit codes. */
  ran?: { command: string; code: number }[];
}

/** Runs one program (absolute path) with an explicit environment and no shell. Returns the exit code. */
export type Exec = (argv: string[], env: Record<string, string>) => Promise<number>;

const spawnExec: Exec = async (argv, env) =>
  Bun.spawn(argv, { env, stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exited;

/** Absolute path of `claude` and the minimal environment to run it with. */
export async function claudeLauncher(): Promise<{ claude: string; env: Record<string, string> }> {
  // The login shell PATH finds `claude` and the `node` it needs when the gateway runs as a service.
  const PATH = await effectivePath();
  const env = { ...systemEnvironment(), PATH };
  const claude = resolveCommand("claude", { PATH, PATHEXT: process.env.PATHEXT });
  if (!claude)
    throw new Error("Claude Code's `claude` command was not found. Install Claude Code, then try again.");
  return { claude, env };
}

/** Apply a connect change. Files: backup, then atomic write. Claude Code: runs `claude mcp …` (no shell). */
export async function applyConnect(
  app: ConnectApp,
  input: ConnectInput,
  env: ScanEnv,
  now = new Date(),
  exec: Exec = spawnExec,
  launcher: () => Promise<{ claude: string; env: Record<string, string> }> = claudeLauncher,
): Promise<ApplyResult> {
  const entryName = input.entryName ?? defaultEntryName(input.profile);
  const remove = (input.remove ?? []).filter((n) => n !== entryName);
  if (app === "claude-code") {
    transportFor(app, undefined, input);
    const a = claudeCodeArgs(input, entryName, remove);
    const { claude, env: childEnv } = await launcher();
    const ran: { command: string; code: number }[] = [];
    const run = async (args: string[]) => {
      const code = await exec([claude, ...args], childEnv);
      ran.push({ command: ["claude", ...args].map(shellQuote).join(" "), code });
    };
    // Re-adding replaces an existing entry of the same name.
    await run(a.replace);
    ran.pop();
    await run(a.add);
    for (const r of a.remove) await run(r);
    return { ran };
  }
  const t = fileTarget(app, env);
  if (!t) throw new Error(`Unknown app: ${app}`);
  const transport = transportFor(app, t, input);
  const doc = readJsonFile(t.file);
  const next = applyToJson(doc, t, transport, input, entryName, remove);
  const backup = writeWithBackup(t.file, next, now);
  return { file: t.file, ...(backup ? { backup } : {}) };
}

/** Backup (when the file exists), then atomic write at 0600. Returns the backup path. */
function writeWithBackup(file: string, doc: Record<string, unknown>, now: Date): string | undefined {
  mkdirSync(dirname(file), { recursive: true });
  let backup: string | undefined;
  if (existsSync(file)) {
    backup = `${file}.pmcpg-backup-${now.toISOString().replace(/[:.]/g, "-")}`;
    copyFileSync(file, backup);
  }
  const tmp = `${file}.pmcpg-tmp`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
  return backup;
}

const TOKEN_APPS: ConnectApp[] = ["claude-desktop", "lm-studio", "cursor", "vscode"];

/** Replace `from` with `to` in every string under `v`. Counts the strings changed. */
function replaceToken(v: unknown, from: string, to: string, hits: { n: number }): unknown {
  if (typeof v === "string") {
    if (!v.includes(from)) return v;
    hits.n++;
    return v.split(from).join(to);
  }
  if (Array.isArray(v)) return v.map((x) => replaceToken(x, from, to, hits));
  if (typeof v === "object" && v !== null)
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, replaceToken(x, from, to, hits)]));
  return v;
}

export interface TokenRewrite {
  app: ConnectApp;
  file: string;
  /** MCP entries in the app that held the old token. */
  entries: string[];
  backup?: string;
  /** Set when the file could not be read or written; the app needs reconnecting by hand. */
  error?: string;
}

/**
 * After a profile token is rotated: put the new token into every app file that holds the old one
 * (HTTP fallback entries written by `connect-app --http`, or pasted by hand). Only the MCP server
 * section changes; each changed file is backed up first. Stdio bridge entries hold no token.
 * Claude Code is not scanned: pmcpg only ever gives it the stdio bridge.
 */
export function rewriteAppTokens(
  oldToken: string,
  newToken: string,
  env: ScanEnv,
  now = new Date(),
): TokenRewrite[] {
  const out: TokenRewrite[] = [];
  if (!oldToken) return out;
  for (const app of TOKEN_APPS) {
    const t = fileTarget(app, env);
    if (!t || !existsSync(t.file)) continue;
    let doc: Record<string, unknown>;
    try {
      doc = readJsonFile(t.file);
    } catch {
      continue;
    }
    const servers = doc[t.key];
    if (typeof servers !== "object" || servers === null || Array.isArray(servers)) continue;
    const entries: string[] = [];
    const next: Record<string, unknown> = {};
    for (const [name, entry] of Object.entries(servers)) {
      const hits = { n: 0 };
      next[name] = replaceToken(entry, oldToken, newToken, hits);
      if (hits.n) entries.push(name);
    }
    if (!entries.length) continue;
    try {
      const backup = writeWithBackup(t.file, { ...doc, [t.key]: next }, now);
      out.push({ app, file: t.file, entries, ...(backup ? { backup } : {}) });
    } catch (e) {
      out.push({ app, file: t.file, entries, error: (e as NodeJS.ErrnoException).code ?? "write failed" });
    }
  }
  return out;
}
