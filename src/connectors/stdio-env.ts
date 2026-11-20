// Environment, PATH and command resolution for stdio servers.
import { accessSync, constants, statSync } from "node:fs";
import path from "node:path";
import { getDefaultEnvironment } from "@modelcontextprotocol/client/stdio";
import { resolveSecrets, type Vault } from "../vault/vault.ts";

/** System variables passed to servers on top of the SDK's defaults. */
const EXTRA_VARS =
  process.platform === "win32"
    ? [
        "ALLUSERSPROFILE",
        "COMMONPROGRAMFILES",
        "COMMONPROGRAMFILES(X86)",
        "COMPUTERNAME",
        "NUMBER_OF_PROCESSORS",
        "OS",
        "PROCESSOR_IDENTIFIER",
        "TMP",
      ]
    : ["LANG", "LC_ALL", "LC_CTYPE", "TMPDIR", "TZ"];

/** Allow-listed system variables from the gateway's environment. */
export function systemEnvironment(): Record<string, string> {
  const env = getDefaultEnvironment();
  for (const key of EXTRA_VARS) {
    const value = process.env[key];
    if (value !== undefined && !value.startsWith("()")) env[key] = value;
  }
  return env;
}

const MARK = "__PMCPG_PATH__";
let loginPath: Promise<string | undefined> | undefined;

/**
 * PATH as the user's login shell sets it (nvm, pyenv, uv, Homebrew).
 * Read once per process; undefined on Windows, on timeout or on failure.
 */
export function loginShellPath(timeoutMs = 5000): Promise<string | undefined> {
  loginPath ??= readLoginShellPath(timeoutMs);
  return loginPath;
}

/** Test hook: forget the cached login shell PATH. */
export function resetLoginShellPath(): void {
  loginPath = undefined;
}

async function readLoginShellPath(timeoutMs: number): Promise<string | undefined> {
  const shell = process.env.SHELL;
  if (process.platform === "win32" || !shell || !path.isAbsolute(shell)) return undefined;
  try {
    const proc = Bun.spawn([shell, "-ilc", `echo ${MARK}; printenv PATH; echo ${MARK}`], {
      env: getDefaultEnvironment(),
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      timeout: timeoutMs,
      killSignal: "SIGKILL",
    });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const parts = out.split(MARK);
    const value = parts.length >= 3 ? parts[1]?.trim() : undefined;
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Login shell PATH first, then entries from the gateway's PATH that it lacks. */
export async function effectivePath(): Promise<string> {
  const own = process.env.PATH ?? "";
  const login = await loginShellPath();
  if (!login) return own;
  const seen = new Set(login.split(path.delimiter));
  const extra = own.split(path.delimiter).filter((p) => p && !seen.has(p));
  return [login, ...extra].join(path.delimiter);
}

export interface ResolveOptions {
  PATH: string;
  PATHEXT?: string;
  cwd?: string;
  platform?: NodeJS.Platform;
}

/**
 * Absolute path of `command`, searched like the OS would: through PATH, and on
 * Windows through PATHEXT (so "npx" finds "npx.cmd"). Undefined if not found.
 */
export function resolveCommand(command: string, opts: ResolveOptions): string | undefined {
  const win = (opts.platform ?? process.platform) === "win32";
  const exts = win ? ["", ...(opts.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)] : [""];
  const candidates = (base: string) =>
    exts.flatMap((e) => (win && e ? [base + e.toLowerCase(), base + e] : [base]));
  const hasSep = command.includes("/") || (win && command.includes("\\"));
  if (hasSep || path.isAbsolute(command)) {
    const base = path.resolve(opts.cwd ?? process.cwd(), command);
    return candidates(base).find((c) => isExecutable(c, win));
  }
  for (const dir of opts.PATH.split(win ? ";" : ":")) {
    if (!dir) continue;
    const hit = candidates(path.join(dir.replace(/^"|"$/g, ""), command)).find((c) => isExecutable(c, win));
    if (hit) return hit;
  }
  return undefined;
}

function isExecutable(file: string, win: boolean): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (!win) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const VAULT_PLACEHOLDER = /\{\{vault:([\w./@-]+)\}\}/g;

export interface SpawnEnv {
  env: Record<string, string>;
  /** Values resolved from the vault, for redacting stderr and error messages. */
  secrets: string[];
}

/** Arguments with `{{vault:...}}` placeholders resolved, and the resolved values for redaction. */
export async function resolveArgs(
  args: string[],
  vault: Vault,
): Promise<{ args: string[]; secrets: string[] }> {
  const secrets: string[] = [];
  const out: string[] = [];
  for (const raw of args) {
    for (const m of raw.matchAll(VAULT_PLACEHOLDER)) {
      const secret = m[1] ? await vault.get(m[1]) : undefined;
      if (secret) secrets.push(secret);
    }
    out.push(await resolveSecrets(raw, vault));
  }
  return { args: out, secrets };
}

/**
 * Child environment: allow-listed system variables, then server env, then
 * account env. "vault:" refs and "{{vault:...}}" placeholders resolve here.
 */
export async function buildEnv(
  serverEnv: Record<string, string>,
  accountEnv: Record<string, string>,
  vault: Vault,
  PATH: string,
): Promise<SpawnEnv> {
  const env: Record<string, string> = { ...systemEnvironment(), PATH };
  const secrets: string[] = [];
  for (const layer of [serverEnv, accountEnv]) {
    for (const [key, raw] of Object.entries(layer)) {
      env[key] = await resolveSecrets(raw, vault);
      const refs = raw.startsWith("vault:")
        ? [raw.slice(6)]
        : [...raw.matchAll(VAULT_PLACEHOLDER)].map((m) => m[1]);
      for (const ref of refs) {
        const secret = ref ? await vault.get(ref) : undefined;
        if (secret) secrets.push(secret);
      }
    }
  }
  return { env, secrets };
}
