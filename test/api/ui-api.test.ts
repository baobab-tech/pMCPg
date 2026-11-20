import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hono } from "hono";
import { csp, inlineScriptHashes, scanUiDir } from "../../src/api/assets.ts";
import {
  clearPassword,
  createLaunchCode,
  csrfFor,
  FREE_FAILURES,
  MAX_BACKOFF_MS,
  MAX_SESSIONS,
  SESSION_COOKIE,
  writePassword,
} from "../../src/api/auth.ts";
import { createUiApi, UI_BODY_LIMIT, type UiApiOptions } from "../../src/api/routes.ts";
import type { ApprovalRequest, ApprovalStore } from "../../src/store/approvals.ts";
import { openDb } from "../../src/store/db.ts";
import { type FakeHandle, fakeHandle } from "./fake-handle.ts";

const ORIGIN = "http://127.0.0.1:7431";

function newDb(): Database {
  return openDb(join(mkdtempSync(join(tmpdir(), "pmcpg-ui-")), "state.db"));
}

/** A browser-like client: keeps the cookie, sends Host, Origin and the CSRF token. */
class Browser {
  cookie = "";
  csrf = "";
  constructor(
    readonly app: Hono,
    readonly host = "127.0.0.1:7431",
    readonly origin: string | null = ORIGIN,
  ) {}

  async req(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
    const headers: Record<string, string> = { host: this.host };
    if (this.origin && method !== "GET") headers.origin = this.origin;
    if (this.cookie) headers.cookie = `${SESSION_COOKIE}=${this.cookie}`;
    if (this.csrf && method !== "GET") headers["x-csrf-token"] = this.csrf;
    if (method !== "GET") headers["content-type"] = "application/json";
    Object.assign(headers, extra);
    const res = await this.app.request(`http://${this.host}${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const set = res.headers.get("set-cookie");
    const m = set?.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
    if (m) this.cookie = m[1] as string;
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: test responses are read loosely
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
    if (json && typeof json === "object" && typeof json.csrf === "string") this.csrf = json.csrf;
    return { status: res.status, json, headers: res.headers };
  }
  /** Signs in the way `pmcpg open` does: a one-time launch link, then the session for the CSRF token. */
  async launch(code = createLaunchCode(db)) {
    const r = await this.req("GET", `/launch?k=${code}`);
    await this.get("/session");
    return r;
  }
  get = (p: string) => this.req("GET", `/api/ui${p}`);
  post = (p: string, b?: unknown) => this.req("POST", `/api/ui${p}`, b);
  patch = (p: string, b?: unknown) => this.req("PATCH", `/api/ui${p}`, b);
  del = (p: string, b?: unknown) => this.req("DELETE", `/api/ui${p}`, b);
}

let db: Database;
let handle: FakeHandle;

function api(opts: Partial<UiApiOptions> = {}) {
  return createUiApi(handle, { db, bindHost: "127.0.0.1", assets: {}, log: () => {}, ...opts });
}

beforeEach(() => {
  db = newDb();
  handle = fakeHandle({
    servers: {
      echo: { transport: "stdio", command: "echo-server" },
      linear: { transport: "http", url: "https://mcp.linear.app/mcp" },
    },
    accounts: { echo: { server: "echo" }, linear: { server: "linear", auth: { type: "oauth" } } },
    profiles: { work: { accounts: ["echo"] } },
  });
});

describe("session and password", () => {
  test("loopback without a password: opening the UI gives no session (WEB-1)", async () => {
    const b = new Browser(api());
    const s = await b.get("/session");
    expect(s.status).toBe(200);
    expect(s.json).toMatchObject({ authenticated: false, passwordSet: false, needsLaunchLink: true });
    expect(b.cookie).toBe("");
    expect((await b.get("/status")).status).toBe(401);
    // Nor can anyone set the first password without a session.
    expect((await b.post("/setup/password", { password: "long enough" })).status).toBe(401);
  });

  test("loopback without a password: a launch link gives a session, once", async () => {
    const b = new Browser(api());
    const code = createLaunchCode(db);
    const r = await b.launch(code);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    expect(r.headers.get("set-cookie")).toContain("HttpOnly");
    expect(r.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect((await b.get("/session")).json).toMatchObject({ authenticated: true, needsLaunchLink: false });
    expect((await b.get("/status")).status).toBe(200);
    const again = new Browser(b.app);
    expect((await again.launch(code)).headers.get("location")).toBe("/setup/");
    expect((await again.get("/status")).status).toBe(401);
    const forged = new Browser(b.app);
    expect((await forged.launch("x".repeat(43))).headers.get("location")).toBe("/setup/");
    expect(forged.cookie).toBe("");
  });

  test("launch links expire and do nothing once a password is set", async () => {
    const old = createLaunchCode(db, Date.now() - 60 * 60 * 1000);
    const b = new Browser(api());
    await b.launch(old);
    expect((await b.get("/status")).status).toBe(401);
    await writePassword(db, "correct horse");
    const c = new Browser(api());
    expect((await c.launch()).headers.get("location")).toBe("/login/");
    expect((await c.get("/status")).status).toBe(401);
  });

  test("session cookie is stored hashed", async () => {
    const b = new Browser(api());
    await b.launch();
    const rows = db.query<{ id_hash: string }, []>("SELECT id_hash FROM ui_sessions").all();
    expect(rows.length).toBe(1);
    expect(rows[0]?.id_hash).not.toBe(b.cookie);
  });

  test("with a password: no session until login; wrong password refused", async () => {
    await writePassword(db, "correct horse");
    const b = new Browser(api());
    expect((await b.get("/session")).json).toMatchObject({ authenticated: false, passwordSet: true });
    expect((await b.get("/status")).status).toBe(401);
    expect((await b.post("/login", { password: "nope" })).status).toBe(401);
    const ok = await b.post("/login", { password: "correct horse" });
    expect(ok.status).toBe(200);
    expect(ok.json.authenticated).toBe(true);
    expect((await b.get("/status")).status).toBe(200);
    await b.post("/logout");
    expect((await b.get("/status")).status).toBe(401);
  });

  test("password hash is Argon2id", async () => {
    await writePassword(db, "correct horse");
    const row = db
      .query<{ value: string }, []>("SELECT value FROM settings WHERE key = 'ui.password-hash'")
      .get();
    expect(row?.value.startsWith("$argon2id$")).toBe(true);
  });

  test("first password on loopback, then change it with the current one", async () => {
    const b = new Browser(api());
    await b.launch();
    expect((await b.post("/setup/password", { password: "short" })).status).toBe(400);
    expect((await b.post("/setup/password", { password: "long enough" })).status).toBe(200);
    expect((await b.post("/setup/password", { password: "another one" })).status).toBe(409);
    expect((await b.post("/password", { current: "wrong", password: "brand new pw" })).status).toBe(403);
    expect((await b.post("/password", { current: "long enough", password: "brand new pw" })).status).toBe(
      200,
    );
    const other = new Browser(api());
    expect((await other.post("/login", { password: "brand new pw" })).status).toBe(200);
  });

  test("non-loopback bind: password required, first one needs the setup code from the log", async () => {
    const lines: string[] = [];
    const app = api({ bindHost: "0.0.0.0", allowedHosts: ["gateway.lan"], log: (l) => lines.push(l) });
    const code = lines.join("").match(/setup code: (\S+)/)?.[1];
    expect(code).toBeDefined();
    const b = new Browser(app, "gateway.lan:7431", "http://gateway.lan:7431");
    const s = await b.get("/session");
    expect(s.json).toMatchObject({ authenticated: false, passwordRequired: true, needsSetupCode: true });
    expect((await b.get("/status")).status).toBe(401);
    expect((await b.post("/setup/password", { password: "long enough", setupCode: "guess" })).status).toBe(
      403,
    );
    expect((await b.post("/setup/password", { password: "long enough", setupCode: code })).status).toBe(200);
    expect((await b.get("/status")).status).toBe(200);
    // The password cannot be removed while it is required.
    expect((await b.del("/password", { password: "long enough" })).status).toBe(400);
  });

  test("idle sessions expire", async () => {
    let now = 1_000_000;
    const b = new Browser(api({ idleTimeoutMs: 1000, now: () => now }));
    await writePassword(db, "correct horse");
    await b.post("/login", { password: "correct horse" });
    now += 500;
    expect((await b.get("/status")).status).toBe(200);
    now += 1500;
    expect((await b.get("/status")).status).toBe(401);
  });

  test("reset-password helpers clear the hash and every session", async () => {
    await writePassword(db, "correct horse");
    const b = new Browser(api());
    await b.post("/login", { password: "correct horse" });
    clearPassword(db);
    expect((await b.get("/status")).status).toBe(401);
    expect((await new Browser(api()).get("/session")).json.passwordSet).toBe(false);
  });

  test("login is throttled after repeated failures", async () => {
    await writePassword(db, "correct horse");
    const b = new Browser(api());
    let last = 0;
    for (let i = 0; i < 11; i++) last = (await b.post("/login", { password: `x${i}` })).status;
    expect(last).toBe(429);
  });

  test("parallel wrong logins get only the free guesses through (WEB-2)", async () => {
    await writePassword(db, "correct horse");
    const app = api();
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => new Browser(app).post("/login", { password: `x${i}` })),
    );
    expect(results.filter((r) => r.status === 401).length).toBe(FREE_FAILURES);
    expect(results.filter((r) => r.status === 429).length).toBe(40 - FREE_FAILURES);
  });

  test("the throttle lifts after the backoff; the right password resets it (WEB-2)", async () => {
    await writePassword(db, "correct horse");
    let now = 1_000_000;
    const b = new Browser(api({ now: () => now }));
    for (let i = 0; i < FREE_FAILURES + 3; i++) await b.post("/login", { password: `x${i}` });
    expect((await b.post("/login", { password: "correct horse" })).status).toBe(429);
    now += MAX_BACKOFF_MS;
    expect((await b.post("/login", { password: "correct horse" })).status).toBe(200);
    expect((await b.post("/login", { password: "wrong" })).status).toBe(401);
  });

  test("request bodies over the limit get 413 before they are parsed (WEB-3)", async () => {
    await writePassword(db, "correct horse");
    const b = new Browser(api());
    const r = await b.post("/login", { password: "x".repeat(UI_BODY_LIMIT) });
    expect(r.status).toBe(413);
  });

  test("session rows are capped (WEB-3)", async () => {
    const app = api();
    for (let i = 0; i < MAX_SESSIONS + 10; i++) await new Browser(app).launch();
    const n = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM ui_sessions").get()?.n;
    expect(n).toBe(MAX_SESSIONS);
  });
});

describe("request checks", () => {
  test("Host must be a loopback name (DNS rebinding)", async () => {
    const b = new Browser(api(), "evil.example:7431", null);
    expect((await b.get("/session")).status).toBe(403);
  });

  test("cross-origin requests are refused", async () => {
    const good = new Browser(api());
    await good.launch();
    const evil = new Browser(good.app, "127.0.0.1:7431", "http://evil.example");
    evil.cookie = good.cookie;
    evil.csrf = good.csrf;
    expect((await evil.post("/profiles", { id: "x" })).status).toBe(403);
  });

  test("state changes need an Origin", async () => {
    const b = new Browser(api(), "127.0.0.1:7431", null);
    await b.get("/session");
    expect((await b.post("/profiles", { id: "x" })).status).toBe(403);
  });

  test("state changes need the CSRF token bound to the session", async () => {
    const b = new Browser(api());
    await b.launch();
    expect(b.csrf).toBe(csrfFor(b.cookie));
    const token = b.csrf;
    b.csrf = "";
    expect((await b.post("/profiles", { id: "x" })).status).toBe(403);
    b.csrf = "wrong";
    expect((await b.post("/profiles", { id: "x" })).status).toBe(403);
    b.csrf = token;
    expect((await b.post("/profiles", { id: "x" })).status).toBe(201);
  });

  test("bodies must be JSON", async () => {
    const b = new Browser(api());
    await b.launch();
    const r = await b.req("POST", "/api/ui/profiles", undefined, { "content-type": "text/plain" });
    expect(r.status).toBe(415);
  });

  test("API responses are not cached", async () => {
    const b = new Browser(api());
    expect((await b.get("/session")).headers.get("cache-control")).toBe("no-store");
  });
});

async function signedIn(opts: Partial<UiApiOptions> = {}): Promise<Browser> {
  const b = new Browser(api(opts));
  await b.launch();
  return b;
}

describe("config edits", () => {
  test("add a remote server with an API key header: value in the vault, reference in config", async () => {
    const b = await signedIn();
    const r = await b.post("/servers", {
      id: "search",
      url: "https://api.search.example/mcp",
      account: { auth: "header", headers: [{ name: "X-Api-Key", value: "sk-secret-value-123" }] },
    });
    expect(r.status).toBe(201);
    const cfg = handle.config();
    expect(cfg.servers.search).toMatchObject({ transport: "http", url: "https://api.search.example/mcp" });
    expect(cfg.accounts.search?.auth).toEqual({
      type: "header",
      headers: { "X-Api-Key": "{{vault:account/search/header-x-api-key}}" },
    });
    expect(await handle.vault.get("account/search/header-x-api-key")).toBe("sk-secret-value-123");
    expect(JSON.stringify(cfg)).not.toContain("sk-secret-value-123");
  });

  test("secret values are never returned", async () => {
    const b = await signedIn();
    await b.post("/servers", {
      id: "search",
      url: "https://api.search.example/mcp",
      account: { auth: "header", headers: [{ name: "Authorization", value: "Bearer sk-abcdef0123456789" }] },
    });
    const accounts = await b.get("/accounts");
    expect(JSON.stringify(accounts.json)).not.toContain("sk-abcdef0123456789");
    const search = accounts.json.find((a: { id: string }) => a.id === "search");
    expect(search.headers).toEqual([{ name: "Authorization", set: true }]);
  });

  test("add a stdio server by command, with env secrets and plain values", async () => {
    const b = await signedIn();
    const r = await b.post("/servers", {
      id: "files",
      command: `npx -y "@acme/files mcp" --root /tmp`,
      account: {
        auth: "none",
        env: [
          { name: "API_TOKEN", value: "abc123secretvalue", secret: true },
          { name: "LOG_LEVEL", value: "info", secret: false },
        ],
      },
    });
    expect(r.status).toBe(201);
    const cfg = handle.config();
    expect(cfg.servers.files).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@acme/files mcp", "--root", "/tmp"],
    });
    expect(cfg.accounts.files?.env).toEqual({
      API_TOKEN: "vault:account/files/env-api_token",
      LOG_LEVEL: "info",
    });
  });

  test("invalid input gives a readable 400 and saves nothing", async () => {
    const b = await signedIn();
    const before = handle.config();
    expect((await b.post("/servers", { id: "Bad Name", url: "https://x.example" })).status).toBe(400);
    expect((await b.post("/servers", { id: "x", url: "https://x.example", command: "y" })).status).toBe(400);
    const dup = await b.post("/servers", { id: "echo", command: "other" });
    expect(dup.status).toBe(409);
    expect(dup.json.error).toContain("already exists");
    expect(handle.config()).toBe(before);
  });

  test("oauth accounts need a URL server", async () => {
    const b = await signedIn();
    expect((await b.post("/accounts", { server: "echo", name: "two", auth: "oauth" })).status).toBe(400);
    expect((await b.post("/accounts", { server: "linear", name: "personal", auth: "oauth" })).status).toBe(
      201,
    );
    expect(handle.config().accounts["linear-personal"]?.auth).toEqual({ type: "oauth" });
  });

  test("rotate a secret: PATCH writes the vault only", async () => {
    const b = await signedIn();
    await b.post("/servers", {
      id: "search",
      url: "https://api.search.example/mcp",
      account: { auth: "header", headers: [{ name: "X-Api-Key", value: "first" }] },
    });
    expect(
      (await b.patch("/accounts/search", { headers: [{ name: "X-Api-Key", value: "second" }] })).status,
    ).toBe(200);
    expect(await handle.vault.get("account/search/header-x-api-key")).toBe("second");
  });

  test("profiles: create, pick accounts, privacy and policy preset", async () => {
    const b = await signedIn();
    const r = await b.post("/profiles", {
      id: "briefing",
      name: "Briefing",
      accounts: ["echo", "linear"],
      privacy: "strict",
      preset: "careful",
    });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({
      id: "briefing",
      privacy: "strict",
      preset: "careful",
      accounts: ["echo", "linear"],
    });
    expect(r.json.url).toBe("http://127.0.0.1:7431/p/briefing/mcp");
    expect((await b.patch("/profiles/briefing", { accounts: ["nope"] })).status).toBe(400);
    expect((await b.patch("/profiles/all", { privacy: "off" })).json.privacy).toBe("off");
    expect((await b.patch("/profiles/all", { accounts: ["echo"] })).status).toBe(400);
    const list = await b.get("/profiles");
    expect(list.json.map((p: { id: string }) => p.id)).toEqual(["all", "work", "briefing"]);
  });

  test("destructive actions re-check the password when one is set", async () => {
    await writePassword(db, "correct horse");
    const b = new Browser(api());
    await b.post("/login", { password: "correct horse" });
    expect((await b.del("/profiles/work", {})).status).toBe(403);
    expect((await b.del("/profiles/work", { password: "wrong" })).status).toBe(403);
    expect((await b.del("/profiles/work", { password: "correct horse" })).status).toBe(200);
    expect(handle.config().profiles.work).toBeUndefined();
  });

  test("forget masked values: one profile or all; unknown profiles are refused", async () => {
    const b = await signedIn();
    const one = await b.post("/privacy/reset", { profile: "work" });
    expect(one.status).toBe(200);
    expect(one.json).toEqual({ sessions: 1, placeholders: 3 });
    expect((await b.post("/privacy/reset", {})).status).toBe(200);
    expect((await b.post("/privacy/reset", { profile: "all" })).status).toBe(200);
    expect((await b.post("/privacy/reset", { profile: "ghost" })).status).toBe(404);
    expect((await b.post("/privacy/reset", { profile: "../x" })).status).toBe(400);
    expect(handle.calls.filter((c) => c.startsWith("resetPrivacy"))).toEqual([
      "resetPrivacy work",
      "resetPrivacy *",
      "resetPrivacy all",
    ]);
  });

  test("forget masked values needs a session, the CSRF token and the password when set", async () => {
    expect((await new Browser(api()).post("/privacy/reset", {})).status).toBe(401);
    const b = await signedIn();
    b.csrf = "";
    expect((await b.post("/privacy/reset", {})).status).toBe(403);
    await writePassword(db, "correct horse");
    const p = new Browser(api());
    await p.post("/login", { password: "correct horse" });
    expect((await p.post("/privacy/reset", {})).status).toBe(403);
    expect((await p.post("/privacy/reset", { password: "correct horse" })).status).toBe(200);
    expect(handle.calls.filter((c) => c.startsWith("resetPrivacy"))).toEqual(["resetPrivacy *"]);
  });

  test("delete a server removes its accounts, their secrets and profile references", async () => {
    const b = await signedIn();
    await handle.vault.set("account/echo/env-x", "v");
    expect((await b.del("/servers/echo", {})).status).toBe(200);
    const cfg = handle.config();
    expect(cfg.servers.echo).toBeUndefined();
    expect(cfg.accounts.echo).toBeUndefined();
    expect(cfg.profiles.work?.accounts).toEqual([]);
    expect(await handle.vault.list("account/echo/")).toEqual([]);
  });

  test("test a server lists tools again for each account", async () => {
    const b = await signedIn();
    const r = await b.post("/servers/echo/test");
    expect(r.json.results).toEqual([{ account: "echo", state: { status: "connected" }, tools: 2 }]);
    expect(handle.calls).toContain("refresh echo");
  });

  test("settings: bind address change needs a password first", async () => {
    const b = await signedIn();
    expect((await b.patch("/settings", { port: 8000 })).json.restartNeeded).toBe(true);
    expect(handle.config().gateway.port).toBe(8000);
    expect((await b.patch("/settings", { host: "0.0.0.0" })).status).toBe(400);
    expect(handle.config().gateway.host).toBe("127.0.0.1");
  });
});

describe("sign-in and connect", () => {
  test("sign-in start returns the authorization URL", async () => {
    const b = await signedIn();
    const r = await b.post("/accounts/linear/signin");
    expect(r.json.authorizationUrl).toBe("https://auth.example/authorize?account=linear");
    expect(handle.calls).toContain("signin linear");
    expect((await b.post("/accounts/echo/signin")).status).toBe(400);
    expect((await b.post("/accounts/nope/signin")).status).toBe(404);
  });

  test("sign out", async () => {
    const b = await signedIn();
    expect((await b.post("/accounts/linear/signout")).status).toBe(200);
    expect(handle.calls).toContain("signout linear");
  });

  test("connect gives URL, token and snippets", async () => {
    const b = await signedIn();
    const r = await b.post("/profiles/work/connect");
    expect(r.json.url).toBe("http://127.0.0.1:7431/p/work/mcp");
    expect(r.json.token).toBe("tok-work");
    const byId = Object.fromEntries(r.json.snippets.map((s: { id: string; code: string }) => [s.id, s.code]));
    // Snippets for apps that can run a command use the bridge and carry no token.
    expect(byId["claude-code"]).toBe("claude mcp add --scope user pmcpg-work -- pmcpg connect work");
    expect(byId.vscode).not.toContain("tok-work");
    expect(byId.http).toContain("Bearer tok-work");
    expect(JSON.parse(byId["claude-desktop"])).toEqual({
      mcpServers: { "pmcpg-work": { command: "pmcpg", args: ["connect", "work"] } },
    });
    const all = await b.post("/profiles/all/connect");
    expect(all.json.url).toBe("http://127.0.0.1:7431/mcp");
  });

  test("rotate a profile token (VLT-3): new token, app files rewritten, password confirmed", async () => {
    const home = mkdtempSync(join(tmpdir(), "pmcpg-ui-rotate-"));
    const cursor = join(home, ".cursor", "mcp.json");
    mkdirSync(join(cursor, ".."), { recursive: true });
    const b = await signedIn({ onboarding: { scanEnv: () => ({ home, platform: "darwin" }) } });
    const old = (await b.post("/profiles/work/connect")).json.token as string;
    writeFileSync(
      cursor,
      JSON.stringify({
        mcpServers: { "pmcpg-work": { url: "x", headers: { Authorization: `Bearer ${old}` } } },
      }),
    );
    expect((await b.post("/profiles/nope/token/rotate")).status).toBe(404);
    const r = await b.post("/profiles/work/token/rotate");
    expect(r.status).toBe(200);
    expect(r.json.token).not.toBe(old);
    expect(await handle.clientToken("work")).toBe(r.json.token);
    expect(readFileSync(cursor, "utf8")).toContain(`Bearer ${r.json.token}`);
    expect(readFileSync(cursor, "utf8")).not.toContain(old);
    expect(r.json.notes.join("\n")).toContain("Cursor");
    expect(r.json.notes.join("\n")).not.toContain(r.json.token);

    expect((await b.post("/setup/password", { password: "correct horse battery" })).status).toBe(200);
    expect((await b.post("/profiles/work/token/rotate")).status).toBe(403);
    expect((await b.post("/profiles/work/token/rotate", { password: "correct horse battery" })).status).toBe(
      200,
    );
  });
});

describe("approvals, activity, quarantine", () => {
  test("report unavailable when the stores are not wired", async () => {
    const b = await signedIn();
    expect((await b.get("/approvals")).json).toEqual({ available: false, items: [] });
    expect((await b.get("/activity")).json).toEqual({ available: false, items: [] });
    expect((await b.get("/quarantine")).json).toEqual({ available: false, items: [] });
    expect((await b.get("/status")).json.features).toEqual({
      approvals: false,
      activity: false,
      pins: false,
    });
  });

  test("approvals: list and decide when the store exists", async () => {
    const items: ApprovalRequest[] = [
      {
        id: "a1",
        createdAt: 1,
        profileId: "work",
        tool: "echo__send_email",
        reason: "Sends data out",
        status: "pending",
      },
    ];
    const store: ApprovalStore = {
      create: () => items[0] as ApprovalRequest,
      wait: async () => "approved",
      decide(id, d) {
        const it = items.find((i) => i.id === id);
        if (it) it.status = d;
      },
      list: (f) => items.filter((i) => !f?.status || i.status === f.status),
      subscribe: () => () => {},
    };
    handle.approvals = store;
    const b = await signedIn();
    expect((await b.get("/approvals?status=pending")).json.items.length).toBe(1);
    expect((await b.post("/approvals/a1", { decision: "denied" })).status).toBe(200);
    expect(items[0]?.status).toBe("denied");
  });
});

describe("static UI", () => {
  function exportDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "pmcpg-out-"));
    writeFileSync(
      join(dir, "index.html"),
      `<html><script src="/_next/a.js"></script><script>self.x=1</script></html>`,
    );
    mkdirSync(join(dir, "servers"));
    writeFileSync(join(dir, "servers", "index.html"), "<html>servers</html>");
    mkdirSync(join(dir, "_next", "static"), { recursive: true });
    writeFileSync(join(dir, "_next", "static", "app.js"), "console.log(1)");
    return dir;
  }

  test("inline script hashes go into the CSP", () => {
    const hashes = inlineScriptHashes(`<script>self.x=1</script><script src="/a.js"></script>`);
    expect(hashes).toEqual([
      `'sha256-${new Bun.CryptoHasher("sha256").update("self.x=1").digest("base64")}'`,
    ]);
    expect(csp(hashes)).toContain(`script-src 'self' ${hashes[0]}`);
  });

  test("serves pages with CSP, assets with caching, and falls through otherwise", async () => {
    const app = api({ assets: scanUiDir(exportDir()) });
    app.get("/mcp", (c) => c.text("front door"));
    const get = (p: string, host = "127.0.0.1:7431") =>
      app.request(`http://${host}${p}`, { headers: { host } });
    const home = await get("/");
    expect(home.status).toBe(200);
    expect(home.headers.get("content-security-policy")).toContain("'sha256-");
    expect(home.headers.get("content-security-policy")).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect((await get("/servers")).status).toBe(308);
    expect(await (await get("/servers/")).text()).toBe("<html>servers</html>");
    expect((await get("/_next/static/app.js")).headers.get("cache-control")).toContain("immutable");
    expect(await (await get("/mcp")).text()).toBe("front door");
    expect((await get("/", "evil.example")).status).toBe(403);
  });

  test("pages and launch links on localhost move to 127.0.0.1; API, MCP and other binds do not", async () => {
    const app = api({ assets: scanUiDir(exportDir()) });
    app.get("/mcp", (c) => c.text("front door"));
    const get = (p: string, host = "localhost:7431") =>
      app.request(`http://${host}${p}`, { headers: { host } });

    const page = await get("/servers/?x=1");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("http://127.0.0.1:7431/servers/?x=1");

    const code = createLaunchCode(db);
    const launch = await get(`/launch?k=${code}`);
    expect(launch.headers.get("location")).toBe(`http://127.0.0.1:7431/launch?k=${code}`);
    expect(launch.headers.get("set-cookie")).toBeNull();
    // The code was not spent on localhost, so it still works on 127.0.0.1.
    expect((await new Browser(app).req("GET", `/launch?k=${code}`)).headers.get("location")).toBe("/");

    expect(await (await get("/mcp")).text()).toBe("front door");
    expect((await get("/api/ui/session")).status).toBe(200);
    expect((await get("/", "127.0.0.1:7431")).status).toBe(200);

    const v6 = api({ bindHost: "::1", assets: scanUiDir(exportDir()) });
    expect((await v6.request("http://localhost:7431/", { headers: { host: "localhost:7431" } })).status).toBe(
      200,
    );
  });
});
