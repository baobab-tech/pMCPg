import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLaunchCode, SESSION_COOKIE, writePassword } from "../../src/api/auth.ts";
import { createUiApi } from "../../src/api/routes.ts";
import { openDb } from "../../src/store/db.ts";
import { fakeHandle } from "./fake-handle.ts";

const SECRET = "sk-NEVER-IN-RESPONSES";

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "pmcpg-onb-"));
  const desktop = join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  mkdirSync(join(desktop, ".."), { recursive: true });
  writeFileSync(
    desktop,
    JSON.stringify({
      mcpServers: {
        notes: { command: "uvx", args: ["notes-mcp"], env: { NOTES_KEY: SECRET } },
        gw: { command: "/usr/local/bin/pmcpg", args: ["connect", "all"] },
      },
    }),
  );
  return { home, desktop };
}

async function setup(password?: string) {
  const db = openDb(join(mkdtempSync(join(tmpdir(), "pmcpg-onbdb-")), "state.db"));
  if (password) await writePassword(db, password);
  const handle = fakeHandle({});
  const { home, desktop } = fakeHome();
  const app = createUiApi(handle, {
    db,
    bindHost: "127.0.0.1",
    assets: {},
    log: () => {},
    onboarding: { scanEnv: () => ({ home, platform: "darwin" }), pmcpgCommand: () => ["/opt/pmcpg"] },
    // Fake probe: auth.example.org servers sign in with https://auth.example.org; others need a key.
    probe: async (url) =>
      new URL(url).hostname === "auth.example.org"
        ? {
            ok: true,
            url,
            transport: "http",
            auth: { type: "oauth", issuer: "https://auth.example.org", registration: "manual" },
            suggestedId: "auth",
          }
        : { ok: true, url, transport: "http", auth: { type: "header", hint: "" }, suggestedId: "x" },
  });
  let cookie = "";
  let csrf = "";
  const req = async (method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { host: "127.0.0.1:7431" };
    if (cookie) headers.cookie = `${SESSION_COOKIE}=${cookie}`;
    if (method !== "GET")
      Object.assign(headers, {
        origin: "http://127.0.0.1:7431",
        "content-type": "application/json",
        "x-csrf-token": csrf,
      });
    const res = await app.request(`http://127.0.0.1:7431/api/ui${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const m = res.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`));
    if (m) cookie = m[1] as string;
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: loose test reads
    const json: any = JSON.parse(text);
    if (typeof json?.csrf === "string") csrf = json.csrf;
    return { status: res.status, json, text };
  };
  if (password) await req("POST", "/login", { password });
  else {
    const res = await app.request(`http://127.0.0.1:7431/launch?k=${createLaunchCode(db)}`, {
      headers: { host: "127.0.0.1:7431" },
    });
    cookie = res.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
    await req("GET", "/session");
  }
  return { req, handle, desktop };
}

describe("onboarding API", () => {
  test("needs a session", async () => {
    const { req } = await setup("long-password-1");
    // setup() logged in; a fresh client without the cookie is refused.
    const db = openDb(":memory:");
    const app = createUiApi(fakeHandle({}), { db, bindHost: "127.0.0.1", assets: {}, log: () => {} });
    await writePassword(db, "long-password-1");
    const res = await app.request("http://127.0.0.1:7431/api/ui/import/scan", {
      headers: { host: "127.0.0.1:7431" },
    });
    expect(res.status).toBe(401);
    expect((await req("GET", "/import/scan")).status).toBe(200);
  });

  test("scan lists apps and servers, hides the gateway's own entry, never returns secret values", async () => {
    const { req } = await setup();
    const r = await req("GET", "/import/scan");
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(SECRET);
    expect(r.json.candidates.map((c: { suggestedId: string }) => c.suggestedId)).toEqual(["notes"]);
    expect(r.json.candidates[0].envNames).toEqual(["NOTES_KEY"]);
    expect(r.json.apps.find((a: { id: string }) => a.id === "claude-desktop").servers).toBe(1);
    expect(r.json.note).toContain("claude.ai");
  });

  test("import by key adds the server; unknown keys are ignored", async () => {
    const { req, handle } = await setup();
    const { json } = await req("GET", "/import/scan");
    const r = await req("POST", "/import/apply", { keys: [json.candidates[0].key, "made-up-key"] });
    expect(r.status).toBe(200);
    expect(r.json.outcomes).toHaveLength(1);
    expect(r.json.outcomes[0].missingValues).toEqual(["NOTES_KEY"]);
    expect(handle.config().servers.notes).toMatchObject({ transport: "stdio", command: "uvx" });
    expect((await req("GET", "/import/scan")).json.candidates[0].alreadyAdded).toBe(true);
  });

  test("connect Claude Desktop: plan suggests removing imported entries; apply needs the password", async () => {
    const { req, desktop } = await setup("long-password-1");
    const { json } = await req("GET", "/import/scan");
    await req("POST", "/import/apply", { keys: [json.candidates[0].key] });
    const plan = await req("GET", "/connect/claude-desktop/plan?profile=all");
    expect(plan.json.suggestedRemove).toEqual(["notes"]);
    expect(plan.json.preview).toContain("/opt/pmcpg");
    expect((await req("POST", "/connect/claude-desktop", { profile: "all", remove: ["notes"] })).status).toBe(
      403,
    );
    const ok = await req("POST", "/connect/claude-desktop", {
      profile: "all",
      remove: ["notes"],
      password: "long-password-1",
    });
    expect(ok.status).toBe(200);
    const doc = JSON.parse(readFileSync(desktop, "utf8"));
    expect(Object.keys(doc.mcpServers).sort()).toEqual(["gw", "pmcpg"]);
  });

  test("probe rejects bad input readably", async () => {
    const { req } = await setup();
    const r = await req("POST", "/probe", { url: "not a url" });
    expect(r.json.ok).toBe(false);
  });
});

describe("account secrets: OAuth client and URL parameters", () => {
  test("client ID in config, client secret and URL parameter values only in the vault", async () => {
    const { req, handle } = await setup();
    expect(
      (
        await req("POST", "/servers", {
          id: "manual",
          url: "https://auth.example.org/mcp",
          account: { auth: "oauth", clientId: "cid-1", clientSecret: "csecret-XYZ" },
        })
      ).status,
    ).toBe(201);
    expect(handle.config().accounts.manual?.auth).toEqual({ type: "oauth", clientId: "cid-1" });
    expect(await handle.vault.get("account/manual/oauth/client")).toBe(
      JSON.stringify({
        client_id: "cid-1",
        client_secret: "csecret-XYZ",
        issuer: "https://auth.example.org",
        entered: true,
      }),
    );

    const r = await req("POST", "/servers", {
      id: "keyed",
      url: "https://k.example.org/mcp",
      account: { auth: "none", params: [{ name: "apiKey", value: "K-SECRET" }] },
    });
    expect(r.status).toBe(201);
    expect(handle.config().accounts.keyed?.urlParams).toEqual({ apiKey: "vault:account/keyed/param-apikey" });
    expect(JSON.stringify(handle.config())).not.toContain("K-SECRET");
    expect(JSON.stringify(handle.config())).not.toContain("csecret-XYZ");
    expect(r.text).not.toContain("K-SECRET");

    const list = await req("GET", "/accounts");
    const keyed = list.json.find((a: { id: string }) => a.id === "keyed");
    expect(keyed.params).toEqual([{ name: "apiKey", set: true }]);
    expect(list.text).not.toContain("K-SECRET");

    expect(
      (await req("POST", "/accounts/keyed/remove-secret", { kind: "param", name: "apiKey" })).status,
    ).toBe(200);
    expect(handle.config().accounts.keyed?.urlParams).toEqual({});
    expect(await handle.vault.get("account/keyed/param-apikey")).toBeUndefined();
  });

  test("a client secret is bound to an issuer: given, or found by probing; refused without one", async () => {
    const { req, handle } = await setup();
    const given = await req("POST", "/servers", {
      id: "given",
      url: "https://other.example.org/mcp",
      account: { auth: "oauth", clientId: "c", clientSecret: "s-1", clientIssuer: "https://idp.example.org" },
    });
    expect(given.status).toBe(201);
    expect(JSON.parse((await handle.vault.get("account/given/oauth/client")) as string).issuer).toBe(
      "https://idp.example.org",
    );

    const noIssuer = await req("POST", "/servers", {
      id: "unknown",
      url: "https://other.example.org/mcp",
      account: { auth: "oauth", clientId: "c", clientSecret: "s-2" },
    });
    expect(noIssuer.status).toBe(400);
    expect(noIssuer.text).toContain("clientIssuer");
    expect(noIssuer.text).not.toContain("s-2");
    expect(await handle.vault.get("account/unknown/oauth/client")).toBeUndefined();

    const http = await req("POST", "/servers", {
      id: "plain",
      url: "https://other.example.org/mcp",
      account: { auth: "oauth", clientId: "c", clientSecret: "s-3", clientIssuer: "http://idp.example.org" },
    });
    expect(http.status).toBe(400);

    const patched = await req("PATCH", "/accounts/given", { clientSecret: "s-4" });
    expect(patched.status).toBe(400);
    const patched2 = await req("PATCH", "/accounts/given", {
      clientSecret: "s-4",
      clientIssuer: "https://idp2.example.org",
    });
    expect(patched2.status).toBe(200);
    expect(JSON.parse((await handle.vault.get("account/given/oauth/client")) as string)).toEqual({
      client_id: "c",
      client_secret: "s-4",
      issuer: "https://idp2.example.org",
      entered: true,
    });
  });

  test("a client ID on a non-OAuth account is refused", async () => {
    const { req } = await setup();
    const r = await req("POST", "/servers", {
      id: "x",
      url: "https://x.example.org/mcp",
      account: { auth: "none", clientId: "c" },
    });
    expect(r.status).toBe(400);
  });

  test("imported secret query parameters get a vault-backed URL parameter slot", async () => {
    const { req, handle } = await setup();
    const home = mkdtempSync(join(tmpdir(), "pmcpg-onbq-"));
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { q: { url: "https://q.example.org/mcp?api_key=SECRET-Q" } } }),
    );
    const { applyImport } = await import("../../src/onboarding/apply.ts");
    const { mergeFound, scanApps } = await import("../../src/onboarding/importers.ts");
    const out = await applyImport(handle, mergeFound(scanApps({ home, platform: "linux" })), {
      probe: async (url) => ({ ok: true, url, transport: "http", auth: { type: "none" }, suggestedId: "q" }),
    });
    expect(out[0]?.missingValues).toEqual(["?api_key"]);
    expect(handle.config().accounts.q?.urlParams).toEqual({ api_key: "vault:account/q/param-api_key" });
    expect(JSON.stringify(handle.config())).not.toContain("SECRET-Q");
    // The value can then be set through the API.
    expect((await req("PATCH", "/accounts/q", { params: [{ name: "api_key", value: "V" }] })).status).toBe(
      200,
    );
    expect(await handle.vault.get("account/q/param-api_key")).toBe("V");
  });
});

describe("GET /accounts/:id/tools", () => {
  test("lists tools without input schemas; 404 for unknown accounts", async () => {
    const { req, handle } = await setup();
    await req("POST", "/servers", { id: "t", url: "https://t.example.org/mcp", account: { auth: "none" } });
    handle.toolCounts.set("t", 2);
    const r = await req("GET", "/accounts/t/tools");
    expect(r.status).toBe(200);
    expect(r.json.account).toBe("t");
    expect(r.json.state).toBeDefined();
    expect(r.json.tools.map((t: { name: string }) => t.name)).toEqual(["tool_1", "tool_2"]);
    expect(r.json.tools[0].annotations).toEqual({ readOnlyHint: true });
    for (const t of r.json.tools) expect(t.inputSchema).toBeUndefined();
    expect((await req("GET", "/accounts/nope/tools")).status).toBe(404);
  });
});

describe("paste cloud connectors", () => {
  test("prompt, parse (no fetching), then import the picked entries", async () => {
    const { req, handle } = await setup();
    let hits = 0;
    const keyed = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: () => {
        hits++;
        return new Response("unauthorized", { status: 401 });
      },
    });
    try {
      expect((await req("GET", "/import/paste")).json.prompt).toContain("```json");
      const local = `http://127.0.0.1:${keyed.port}/mcp`;
      const text = `\`\`\`json\n[{"name":"Local","url":"${local}?api_key=PASTED-SECRET"},{"name":"Linear"},{"name":"Web search"},{"name":"Mystery"},{"name":"Evil","url":"http://evil.example/mcp"}]\n\`\`\``;
      const parsed = await req("POST", "/import/paste", { text });
      expect(parsed.status).toBe(200);
      expect(hits).toBe(0);
      expect(parsed.text).not.toContain("PASTED-SECRET");
      expect(
        parsed.json.servers.map((s: { name: string; status: string }) => `${s.name}:${s.status}`),
      ).toEqual([
        "Local:ready",
        "Linear:ready",
        "Web search:built-in",
        "Mystery:url-needed",
        "Evil:rejected",
      ]);
      const local0 = parsed.json.servers[0];
      expect(local0.alreadyAdded).toBe(false);

      const applied = await req("POST", "/import/paste/apply", {
        servers: [{ name: local0.name, url: local0.url, secretParams: local0.secretParams }],
      });
      expect(applied.status).toBe(200);
      expect(applied.json.outcomes[0]).toMatchObject({
        status: "added",
        accountId: "local",
        missingValues: ["Authorization", "?api_key"],
      });
      expect(hits).toBeGreaterThan(0);
      expect(handle.config().servers.local).toMatchObject({ transport: "http", url: local });
      expect(JSON.stringify(handle.config())).not.toContain("PASTED-SECRET");
      expect((await req("POST", "/import/paste", { text })).json.servers[0].alreadyAdded).toBe(true);
    } finally {
      keyed.stop(true);
    }
  });

  test("apply re-checks URLs from the client", async () => {
    const { req, handle } = await setup();
    const r = await req("POST", "/import/paste/apply", {
      servers: [{ name: "Evil", url: "http://evil.example/mcp" }],
    });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("https");
    expect(Object.keys(handle.config().servers)).toEqual([]);
    expect((await req("POST", "/import/paste/apply", { servers: [] })).status).toBe(400);
    expect(
      (
        await req("POST", "/import/paste/apply", {
          servers: [{ name: "x", url: "https://x.example/mcp", secretParams: ["bad name!"] }],
        })
      ).status,
    ).toBe(400);
  });

  test("oversized requests are refused", async () => {
    const { req } = await setup();
    expect((await req("POST", "/import/paste", { text: "x".repeat(300_000) })).status).toBe(400);
  });
});

describe("GET /connect/status", () => {
  test("installed and connected per app, with the profile the entry uses", async () => {
    const { req } = await setup();
    const r = await req("GET", "/connect/status");
    expect(r.status).toBe(200);
    const desktop = r.json.find((a: { app: string }) => a.app === "claude-desktop");
    // The fake Claude Desktop config has `pmcpg connect all`.
    expect(desktop).toEqual({
      app: "claude-desktop",
      label: "Claude Desktop",
      installed: true,
      connected: true,
      profiles: ["all"],
    });
    const lms = r.json.find((a: { app: string }) => a.app === "lm-studio");
    expect(lms).toMatchObject({ installed: false, connected: false, profiles: [] });
    expect(r.text).not.toContain(SECRET);
  });
});
