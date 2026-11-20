// Web UI auth: optional password (Argon2id), session cookie stored hashed in ui_sessions, CSRF token,
// Host and Origin checks. The password hash lives in the `settings` table of state.db.
import type { Database } from "bun:sqlite";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

export const SESSION_COOKIE = "pmcpg_session";
export const CSRF_HEADER = "x-csrf-token";
export const PASSWORD_SETTING = "ui.password-hash";
export const SETUP_DONE_SETTING = "ui.setup-done";
export const MIN_PASSWORD_LENGTH = 8;
/** Settings key prefix for one-time launch codes: `ui.launch:<sha256(code)>` = expiry (ms since epoch). */
export const LAUNCH_PREFIX = "ui.launch:";
/** A launch link works once, within this time. */
export const LAUNCH_TTL_MS = 15 * 60 * 1000;
/** Path of the launch link; the code goes in `k`. */
export const LAUNCH_PATH = "/launch";
/** Sessions end after this much inactivity. */
export const DEFAULT_IDLE_TIMEOUT_MS = 4 * 60 * 60 * 1000;
/** Most UI sessions kept at once. */
export const MAX_SESSIONS = 50;

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export function isLoopback(host: string): boolean {
  return LOOPBACK.has(host.toLowerCase()) || host.startsWith("127.");
}

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(sha256(a));
  const y = Buffer.from(sha256(b));
  return timingSafeEqual(x, y) && a === b;
}

function randomToken(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

/** CSRF token bound to the session cookie. The cookie is HttpOnly, so a page cannot compute it. */
export function csrfFor(sessionValue: string): string {
  return createHash("sha256").update(`csrf:${sessionValue}`).digest("base64url");
}

function getSetting(db: Database, key: string): string | undefined {
  return db.query<{ value: string }, [string]>("SELECT value FROM settings WHERE key = ?").get(key)?.value;
}

function putSetting(db: Database, key: string, value: string): void {
  db.run(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

/**
 * A one-time code that opens the UI without a password. Written to state.db, so the CLI can create one
 * while the gateway runs (`pmcpg open`). Only its hash is stored. Without a password set, this link is
 * the only way into the UI: a local process that can reach the port but cannot write state.db gets nothing.
 */
export function createLaunchCode(db: Database, now = Date.now(), ttlMs = LAUNCH_TTL_MS): string {
  db.run("DELETE FROM settings WHERE key LIKE ? AND CAST(value AS INTEGER) < ?", [`${LAUNCH_PREFIX}%`, now]);
  const code = randomToken();
  putSetting(db, `${LAUNCH_PREFIX}${sha256(code)}`, String(now + ttlMs));
  return code;
}

/** Remove the UI password and end every session. Used by `pmcpg ui reset-password`. */
export function clearPassword(db: Database): void {
  db.run("DELETE FROM settings WHERE key = ?", [PASSWORD_SETTING]);
  db.run("DELETE FROM ui_sessions");
}

/** Set the UI password and end every session. */
export async function writePassword(db: Database, password: string): Promise<void> {
  checkPasswordStrength(password);
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" });
  db.transaction(() => {
    putSetting(db, PASSWORD_SETTING, hash);
    db.run("DELETE FROM ui_sessions");
  })();
}

export function checkPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH)
    throw new AuthError(400, `Use at least ${MIN_PASSWORD_LENGTH} characters.`);
}

export class AuthError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 429,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/** Failed guesses allowed per client before the backoff starts. */
export const FREE_FAILURES = 5;
/** Failed guesses allowed across all clients before the backoff applies to everyone. */
export const GLOBAL_FREE_FAILURES = 50;
/** Longest wait after a failure. Bounds how long anyone can lock the owner out. */
export const MAX_BACKOFF_MS = 60_000;
/** Failure counts reset after this long without a failure. */
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const MAX_TRACKED_CLIENTS = 1000;

interface Failures {
  count: number;
  last: number;
}

/**
 * Exponential backoff on password failures, per client and globally. After the free failures each
 * further failure waits 1 s, 2 s, 4 s and so on, up to MAX_BACKOFF_MS. `begin` counts the attempt as a
 * failure before verification and `succeed` takes it back, so check and count are one synchronous step.
 */
export class LoginThrottle {
  private readonly clients = new Map<string, Failures>();
  private global: Failures = { count: 0, last: 0 };

  /** Milliseconds to wait; 0 means the attempt may go ahead and is now counted. */
  begin(client: string, now: number): number {
    const own = current(this.clients.get(client), now);
    this.global = current(this.global, now);
    const wait = Math.max(waitFor(own, FREE_FAILURES, now), waitFor(this.global, GLOBAL_FREE_FAILURES, now));
    if (wait > 0) return wait;
    if (!this.clients.has(client) && this.clients.size >= MAX_TRACKED_CLIENTS) this.evict(now);
    this.clients.set(client, { count: own.count + 1, last: now });
    this.global = { count: this.global.count + 1, last: now };
    return 0;
  }

  /** The password was right: forget the client's failures and take its attempt off the global count. */
  succeed(client: string): void {
    this.clients.delete(client);
    this.global.count = Math.max(0, this.global.count - 1);
  }

  private evict(now: number): void {
    for (const [k, f] of this.clients) if (now - f.last > FAILURE_WINDOW_MS) this.clients.delete(k);
    if (this.clients.size < MAX_TRACKED_CLIENTS) return;
    let oldest: [string, Failures] | undefined;
    for (const e of this.clients) if (!oldest || e[1].last < oldest[1].last) oldest = e;
    if (oldest) this.clients.delete(oldest[0]);
  }
}

function current(f: Failures | undefined, now: number): Failures {
  return !f || now - f.last > FAILURE_WINDOW_MS ? { count: 0, last: 0 } : f;
}

function waitFor(f: Failures, free: number, now: number): number {
  if (f.count < free) return 0;
  const backoff = Math.min(1000 * 2 ** (f.count - free), MAX_BACKOFF_MS);
  return Math.max(0, f.last + backoff - now);
}

export interface UiAuthOptions {
  db: Database;
  /** Address the gateway binds. A non-loopback address makes the password required. */
  bindHost: string;
  idleTimeoutMs?: number;
  now?: () => number;
  /** Receives the one-time setup code (see setupCode). */
  onSetupCode?: (code: string) => void;
}

export class UiAuth {
  readonly db: Database;
  readonly passwordRequired: boolean;
  private readonly idleMs: number;
  private readonly now: () => number;
  private code: string | undefined;
  private readonly onSetupCode: (code: string) => void;
  private readonly throttle = new LoginThrottle();
  private verifying: Promise<unknown> = Promise.resolve();

  constructor(opts: UiAuthOptions) {
    this.db = opts.db;
    this.passwordRequired = !isLoopback(opts.bindHost);
    this.idleMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this.now = opts.now ?? Date.now;
    this.onSetupCode = opts.onSetupCode ?? (() => {});
    this.setupCode();
  }

  /**
   * One-time code that allows setting the first password when the password is required
   * (non-loopback bind) and none is set. Created on demand and reported through onSetupCode.
   */
  setupCode(): string | undefined {
    if (!this.passwordRequired || this.hasPassword()) {
      this.code = undefined;
      return undefined;
    }
    if (!this.code) {
      this.code = randomToken().slice(0, 12);
      this.onSetupCode(this.code);
    }
    return this.code;
  }

  hasPassword(): boolean {
    return getSetting(this.db, PASSWORD_SETTING) !== undefined;
  }

  setupDone(): boolean {
    return getSetting(this.db, SETUP_DONE_SETTING) === "1";
  }

  markSetupDone(): void {
    putSetting(this.db, SETUP_DONE_SETTING, "1");
  }

  /**
   * Check a password guess. `client` is the caller's address; failures count per client and globally
   * (see LoginThrottle). Verifications run one at a time.
   */
  async verifyPassword(password: unknown, client = "unknown"): Promise<boolean> {
    const hash = getSetting(this.db, PASSWORD_SETTING);
    if (!hash) return false;
    // Counted as a failure before the await, so parallel guesses cannot all pass the check.
    const wait = this.throttle.begin(client, this.now());
    if (wait > 0)
      throw new AuthError(429, `Too many attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`);
    const run = this.verifying.then(
      () => typeof password === "string" && password.length > 0 && Bun.password.verify(password, hash),
    );
    this.verifying = run.catch(() => false);
    const ok = (await run) === true;
    if (ok) this.throttle.succeed(client);
    return ok;
  }

  /** For destructive actions: no-op without a password, else the password must match. */
  async confirm(password: unknown, client?: string): Promise<void> {
    if (!this.hasPassword()) return;
    if (!(await this.verifyPassword(password, client)))
      throw new AuthError(403, "Enter your UI password to confirm this action.");
  }

  async setPassword(password: string): Promise<void> {
    await writePassword(this.db, password);
  }

  removePassword(): void {
    if (this.passwordRequired)
      throw new AuthError(400, "A password is required when the gateway is reachable from other machines.");
    clearPassword(this.db);
  }

  /** True once for a live launch code; the code is deleted either way. */
  redeemLaunchCode(code: unknown): boolean {
    if (typeof code !== "string" || code.length < 20 || code.length > 100) return false;
    const key = `${LAUNCH_PREFIX}${sha256(code)}`;
    return this.db.transaction(() => {
      const expires = getSetting(this.db, key);
      if (expires === undefined) return false;
      this.db.run("DELETE FROM settings WHERE key = ?", [key]);
      return Number(expires) >= this.now();
    })();
  }

  /**
   * Create a session; returns the cookie value. Only its hash is stored. Expired sessions go first, and
   * past MAX_SESSIONS the least recently used ones are ended.
   */
  createSession(): string {
    const value = randomToken();
    const t = this.now();
    this.db.transaction(() => {
      this.prune();
      this.db.run("INSERT INTO ui_sessions (id_hash, created_at, last_seen_at) VALUES (?, ?, ?)", [
        sha256(value),
        t,
        t,
      ]);
      this.db.run(
        "DELETE FROM ui_sessions WHERE id_hash NOT IN (SELECT id_hash FROM ui_sessions ORDER BY last_seen_at DESC LIMIT ?)",
        [MAX_SESSIONS],
      );
    })();
    return value;
  }

  /** True if the cookie names a live session; refreshes its idle timer. */
  touchSession(value: string | undefined): boolean {
    if (!value) return false;
    const id = sha256(value);
    const row = this.db
      .query<{ last_seen_at: number }, [string]>("SELECT last_seen_at FROM ui_sessions WHERE id_hash = ?")
      .get(id);
    if (!row) return false;
    const t = this.now();
    if (t - row.last_seen_at > this.idleMs) {
      this.db.run("DELETE FROM ui_sessions WHERE id_hash = ?", [id]);
      return false;
    }
    this.db.run("UPDATE ui_sessions SET last_seen_at = ? WHERE id_hash = ?", [t, id]);
    return true;
  }

  endSession(value: string | undefined): void {
    if (value) this.db.run("DELETE FROM ui_sessions WHERE id_hash = ?", [sha256(value)]);
  }

  /** Remove expired sessions. */
  prune(): void {
    this.db.run("DELETE FROM ui_sessions WHERE last_seen_at < ?", [this.now() - this.idleMs]);
  }

  setSessionCookie(c: Context, value: string): void {
    setCookie(c, SESSION_COOKIE, value, {
      httpOnly: true,
      sameSite: "Strict",
      path: "/",
      secure: new URL(c.req.url).protocol === "https:",
    });
  }

  clearSessionCookie(c: Context): void {
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
  }

  sessionValue(c: Context): string | undefined {
    return getCookie(c, SESSION_COOKIE);
  }

  checkCsrf(c: Context): boolean {
    const value = this.sessionValue(c);
    const given = c.req.header(CSRF_HEADER);
    return !!value && !!given && safeEqual(given, csrfFor(value));
  }
}

type RequestIp = (req: Request) => { address: string } | null;

const addresses = new WeakMap<Context, string>();

/**
 * The caller's IP address from the Bun server (passed as Hono's env), or "unknown" (tests).
 * Remembered per request: call it once before anything replaces `c.req.raw`.
 */
export function clientAddress(c: Context): string {
  const known = addresses.get(c);
  if (known) return known;
  const requestIP = (c.env as { requestIP?: RequestIp } | undefined)?.requestIP;
  let address = "unknown";
  try {
    address = requestIP?.call(c.env, c.req.raw)?.address ?? "unknown";
  } catch {}
  addresses.set(c, address);
  return address;
}

/** Hostname of a Host header or Origin URL, without port; IPv6 keeps its brackets. */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.split(":")[0] ?? "";
}

/**
 * Reject requests whose Host is not an allowed name (DNS rebinding). State-changing requests must also
 * carry an Origin (or Referer) on the same host.
 */
export function hostOriginCheck(allowedHosts: string[]): MiddlewareHandler {
  const allowed = new Set(allowedHosts.map((h) => h.toLowerCase()));
  return async (c, next) => {
    const host = c.req.header("host");
    if (!host || !allowed.has(hostnameOf(host))) return c.json({ error: "Host not allowed" }, 403);
    // Reads need only the Host check: other origins cannot read the response without CORS.
    if (["GET", "HEAD", "OPTIONS"].includes(c.req.method)) return next();
    const origin = c.req.header("origin") ?? refererOrigin(c.req.header("referer"));
    if (origin === undefined) return c.json({ error: "Missing Origin" }, 403);
    let o: URL;
    try {
      o = new URL(origin);
    } catch {
      return c.json({ error: "Origin not allowed" }, 403);
    }
    if (o.host.toLowerCase() !== host.toLowerCase()) return c.json({ error: "Origin not allowed" }, 403);
    await next();
  };
}

function refererOrigin(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try {
    return new URL(referer).origin;
  } catch {
    return "null";
  }
}
