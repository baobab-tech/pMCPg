// Load and save config.yaml, and create the data directory.
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import type { z } from "zod";
import { Config } from "./config.ts";
import { tightenDataDir } from "./file-mode.ts";
import { checkReferences } from "./profiles.ts";

const isWindows = process.platform === "win32";

/** A config that cannot be used. `problems` are "<field path>: <message>" lines, never values. */
export class ConfigError extends Error {
  constructor(
    public readonly file: string,
    public readonly problems: string[],
  ) {
    super(
      `${file} has ${problems.length === 1 ? "a problem" : `${problems.length} problems`}:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
    this.name = "ConfigError";
  }
}

/**
 * Create the data directory with mode 0700 (owner only) and set its existing sensitive files to 0600.
 * POSIX only: on Windows the folder's ACL applies and nothing is changed.
 */
export function ensureDataDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (isWindows) return;
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Not the owner (e.g. a mounted Docker volume): keep its mode.
  }
  tightenDataDir(dir);
}

/** Read and validate config.yaml. A missing file gives the default (empty) config. */
export function loadConfig(file: string): Config {
  if (!existsSync(file)) return Config.parse({});
  let raw: unknown;
  try {
    raw = Bun.YAML.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(file, [`not valid YAML: ${(e as Error).message}`]);
  }
  return validateConfig(raw ?? {}, file);
}

/** Schema, raw-secret and reference checks. Throws ConfigError listing every problem. */
export function validateConfig(raw: unknown, file = "config.yaml"): Config {
  const parsed = Config.safeParse(raw);
  if (!parsed.success) throw new ConfigError(file, formatIssues(parsed.error.issues));
  const problems = [...findRawSecrets(parsed.data), ...checkReferences(parsed.data)];
  if (problems.length > 0) throw new ConfigError(file, problems);
  return parsed.data;
}

/**
 * Validate, then write atomically: temp file (0600) in the same directory, fsync, rename.
 * YAML comments in the old file are not kept.
 */
export function saveConfig(file: string, config: Config): void {
  const valid = validateConfig(config, file);
  const dir = dirname(file);
  ensureDataDir(dir);
  const tmp = `${file}.${process.pid}.${Date.now().toString(36)}.tmp`;
  const text = `${Bun.YAML.stringify(valid, null, 2)}\n`;
  const fd = openSync(tmp, "wx", 0o600);
  try {
    writeSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, file);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  if (!isWindows) {
    chmodSync(file, 0o600);
    const dfd = openSync(dir, "r");
    try {
      fsyncSync(dfd);
    } finally {
      closeSync(dfd);
    }
  }
}

function formatIssues(issues: z.core.$ZodIssue[]): string[] {
  return issues.map((i) => `${i.path.length ? i.path.join(".") : "(top level)"}: ${i.message}`);
}

// --- raw secret detection -------------------------------------------------

const SENSITIVE_NAME =
  /token|secret|passw(?:or)?d|pwd|api[-_]?key|auth|credential|private[-_]?key|access[-_]?key|cookie|session/i;
const KNOWN_TOKEN =
  /(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[abprs]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,}|glpat-[\w-]{20,}|eyJ[\w-]{8,}\.[\w-]{8,}\.)/;
const AUTH_SCHEME = /^(?:bearer|basic|token|digest)\b\s*/i;

const MOVE_TO_VAULT =
  "looks like a secret in plain text; enter it in the web UI (Servers, then the account) so it is kept in the vault, or use a vault:<key> reference";

/**
 * Field paths of values that look like secrets written in plain text: env, headers, URL parameters,
 * the URL itself (password, query, path) and stdio arguments. Values must be `vault:<key>` refs or use
 * `{{vault:<key>}}` placeholders.
 */
export function findRawSecrets(config: Config): string[] {
  const found: string[] = [];
  const check = (path: string, name: string, value: string) => {
    if (looksLikeRawSecret(name, value)) found.push(`${path}: ${MOVE_TO_VAULT}`);
  };
  for (const [id, server] of Object.entries(config.servers)) {
    if (server.transport !== "stdio") {
      for (const where of urlSecrets(server.url)) found.push(`servers.${id}.url: ${where} ${MOVE_TO_VAULT}`);
      continue;
    }
    for (const [k, v] of Object.entries(server.env)) check(`servers.${id}.env.${k}`, k, v);
    for (const i of new Set(argSecrets(server.args).map((s) => s.index)))
      found.push(`servers.${id}.args.${i}: ${MOVE_TO_VAULT}`);
  }
  for (const [id, account] of Object.entries(config.accounts)) {
    for (const [k, v] of Object.entries(account.env)) check(`accounts.${id}.env.${k}`, k, v);
    for (const [k, v] of Object.entries(account.urlParams ?? {}))
      check(`accounts.${id}.urlParams.${k}`, k, v);
    if (account.auth.type === "header")
      for (const [k, v] of Object.entries(account.auth.headers))
        check(`accounts.${id}.auth.headers.${k}`, k, v);
  }
  return found;
}

const KNOWN_TOKEN_RUN = new RegExp(`${KNOWN_TOKEN.source}[^\\s"'&,;]*`, "g");
const SECRET_FLAG = /^--?[\w-]*(?:token|secret|passw(?:or)?d|pwd|api[-_]?key|auth|credential)[\w-]*$/i;
const URL_PASSWORD = /^[a-z][\w+.-]*:\/\/[^/:@\s]+:([^@\s/]+)@/i;

export interface ArgSecret {
  index: number;
  start: number;
  end: number;
}

/**
 * Plain-text secrets in a command's arguments: passwords in URLs, `NAME=value` and `--flag=value`
 * pairs, the value after a secret-named flag (`--token x`), and known token formats anywhere.
 */
export function argSecrets(args: string[]): ArgSecret[] {
  const out: ArgSecret[] = [];
  args.forEach((a, index) => {
    if (/^\{\{vault:[\w./@-]+\}\}$/.test(a)) return;
    const url = URL_PASSWORD.exec(a);
    if (url?.[1] && !url[1].startsWith("{{")) {
      const start = a.indexOf(`:${url[1]}@`) + 1;
      out.push({ index, start, end: start + url[1].length });
      return;
    }
    const pair = /^(-{0,2}[\w.-]+)=(.+)$/.exec(a);
    if (pair?.[1] && pair[2] && looksLikeRawSecret(pair[1].replace(/^-+/, ""), pair[2])) {
      out.push({ index, start: a.length - pair[2].length, end: a.length });
      return;
    }
    const prev = args[index - 1];
    if (
      prev &&
      SECRET_FLAG.test(prev) &&
      !a.startsWith("-") &&
      looksLikeRawSecret(prev.replace(/^-+/, ""), a)
    ) {
      out.push({ index, start: 0, end: a.length });
      return;
    }
    for (const m of a.matchAll(KNOWN_TOKEN_RUN))
      out.push({ index, start: m.index, end: m.index + m[0].length });
  });
  return out;
}

/** The URL with known token formats in its path replaced by "KEY-REMOVED", for display. */
export function redactUrlPath(raw: string): string {
  try {
    const u = new URL(raw);
    u.pathname = decodeURIComponent(u.pathname).replace(KNOWN_TOKEN_RUN, "KEY-REMOVED");
    return u.toString();
  } catch {
    return raw;
  }
}

/** Where a URL carries a secret in plain text: "a password", "query parameter x", "the path". */
export function urlSecrets(raw: string): string[] {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return [];
  }
  const out: string[] = [];
  if (u.password) out.push("a password");
  for (const [k, v] of u.searchParams) if (looksLikeRawSecret(k, v)) out.push(`query parameter ${k}`);
  let path = u.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep it encoded
  }
  if (KNOWN_TOKEN.test(path)) out.push("the path");
  return out;
}

export function looksLikeRawSecret(name: string, value: string): boolean {
  if (value.startsWith("vault:")) return false;
  const rest = value.replace(/\{\{vault:[\w./@-]+\}\}/g, "").trim();
  if (rest === "") return false;
  if (KNOWN_TOKEN.test(rest)) return true;
  const bare = rest.replace(AUTH_SCHEME, "");
  if (/^(?:proxy-)?authorization$/i.test(name)) return bare !== "";
  if (SENSITIVE_NAME.test(name) && bare.length >= 8 && !/\s/.test(bare) && !/^[a-z]+:\/\//i.test(bare))
    return true;
  // Long random-looking string: mixed case and digits, no path or URL shape.
  return (
    /^[A-Za-z0-9_\-+/=.]{32,}$/.test(rest) &&
    /[a-z]/.test(rest) &&
    /[A-Z]/.test(rest) &&
    /\d/.test(rest) &&
    !rest.startsWith("/") &&
    !rest.startsWith(".")
  );
}
