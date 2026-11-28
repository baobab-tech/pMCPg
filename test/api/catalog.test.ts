import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLaunchCode, SESSION_COOKIE } from "../../src/api/auth.ts";
import { createUiApi } from "../../src/api/routes.ts";
import type { CatalogView } from "../../src/catalog/schema.ts";
import { openDb } from "../../src/store/db.ts";
import { BUILT_ENTRY, BUNDLE_ENTRY, KEYED_ENTRY, uiCatalogView } from "../fixtures/catalog-ui-view.ts";
import { type FakeHandle, fakeHandle } from "./fake-handle.ts";

const SECRET = "sk-CATALOG-NEVER-IN-CONFIG";
const HOST = "127.0.0.1:7431";
const ORIGIN = `http://${HOST}`;

let handle: FakeHandle;
let fetches: number;

function setup(raw: unknown = {}, refreshed: CatalogView = uiCatalogView({ source: "network" })) {
  fetches = 0;
  const base = fakeHandle(raw);
  handle = Object.assign(base, {
    catalog: async () => uiCatalogView(),
    refreshCatalog: async () => {
      fetches++;
      return refreshed;
    },
  });
  const db = openDb(join(mkdtempSync(join(tmpdir(), "pmcpg-cat-")), "state.db"));
  const app = createUiApi(handle, { db, bindHost: "127.0.0.1", assets: {}, log: () => {} });
  let cookie = "";
  let csrf = "";
  const req = async (
    method: string,
    path: string,
    body?: unknown,
    over: { host?: string; origin?: string | null; csrf?: string } = {},
  ) => {
    const headers: Record<string, string> = { host: over.host ?? HOST };
    if (cookie) headers.cookie = `${SESSION_COOKIE}=${cookie}`;
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      headers["x-csrf-token"] = over.csrf ?? csrf;
      const origin = over.origin === undefined ? ORIGIN : over.origin;
      if (origin) headers.origin = origin;
    }
    const res = await app.request(`http://${over.host ?? HOST}/api/ui${path}`, {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    const text = await res.text();
    // biome-ignore lint/suspicious/noExplicitAny: loose test reads
    const json: any = JSON.parse(text);
    if (typeof json?.csrf === "string") csrf = json.csrf;
    return { status: res.status, json, text };
  };
  const signIn = async () => {
    const res = await app.request(`http://${HOST}/launch?k=${createLaunchCode(db)}`, {
      headers: { host: HOST },
    });
    cookie = res.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
    await req("GET", "/session");
  };
  return { req, signIn };
}

describe("catalog API", () => {
  let req: ReturnType<typeof setup>["req"];
  beforeEach(async () => {
    const s = setup();
    req = s.req;
    await s.signIn();
  });

  test("GET /catalog reads the cache and never fetches", async () => {
    const r = await req("GET", "/catalog");
    expect(r.status).toBe(200);
    expect(fetches).toBe(0);
    expect(r.json.source).toBe("cache");
    expect(r.json.fetchedAt).toBe("2026-11-20T10:00:00.000Z");
    expect(r.json.enabled).toBe(true);
    expect(r.json.presets[0].id).toBe("grants-research");
    const linear = r.json.entries.find((e: { name: string }) => e.name === "app.linear/linear");
    expect(linear).toMatchObject({
      title: "Linear",
      tier: "approved",
      auth: { type: "oauth", registration: "dcr" },
      trust: ["private-data", "can-send"],
      available: true,
      kind: "remote",
      target: "https://mcp.linear.app/mcp",
      serverId: "linear",
      credentials: [],
      addedAs: null,
    });
    const grants = r.json.entries.find((e: { name: string }) => e.name === "io.github.example/grants-search");
    expect(grants.kind).toBe("package");
    expect(grants.target).toBe("npx -y @example/grants-mcp@0.4.2 --read-only");
    expect(grants.credentials).toEqual([{ name: "GRANTS_API_KEY", required: true, secret: true }]);
    const bundle = r.json.entries.find((e: { name: string }) => e.name === BUNDLE_ENTRY);
    expect(bundle.available).toBe(false);
    expect(bundle.reason).toContain("mcpb");
  });

  test("POST /catalog/refresh fetches and passes the error through", async () => {
    const s = setup({}, uiCatalogView({ source: "cache", error: "Could not reach pmcpg.io." }));
    await s.signIn();
    const r = await s.req("POST", "/catalog/refresh");
    expect(r.status).toBe(200);
    expect(fetches).toBe(1);
    expect(r.json.error).toBe("Could not reach pmcpg.io.");
  });

  test("refresh is refused when the catalog is off", async () => {
    const s = setup({ catalog: { enabled: false } });
    await s.signIn();
    const r = await s.req("POST", "/catalog/refresh");
    expect(r.status).toBe(400);
    expect(fetches).toBe(0);
    expect((await s.req("GET", "/catalog")).json.enabled).toBe(false);
  });

  test("adds a package with its secret in the vault only", async () => {
    const r = await req("POST", "/catalog/add", {
      name: "io.github.example/grants-search",
      trust: ["external-content", "private-data"],
      values: [{ name: "GRANTS_API_KEY", value: SECRET }],
    });
    expect(r.status).toBe(201);
    expect(r.text).not.toContain(SECRET);
    const cfg = handle.config();
    expect(cfg.servers["grants-search"]).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@example/grants-mcp@0.4.2", "--read-only"],
      env: { GRANTS_REGION: "ca" },
      trust: ["external-content", "private-data"],
    });
    const ref = cfg.accounts["grants-search"]?.env.GRANTS_API_KEY ?? "";
    expect(ref.startsWith("vault:")).toBe(true);
    expect(handle.vault.data.get(ref.slice(6))).toBe(SECRET);
    expect(JSON.stringify(cfg)).not.toContain(SECRET);
    expect(handle.calls.join("\n")).not.toContain(SECRET);
    // The entry now shows as added, and a new add gets a free name.
    const list = await req("GET", "/catalog");
    const grants = list.json.entries.find(
      (e: { name: string }) => e.name === "io.github.example/grants-search",
    );
    expect(grants.addedAs).toBe("grants-search");
    expect(grants.serverId).toBe("grants-search-2");
  });

  test("a required value must be given", async () => {
    const r = await req("POST", "/catalog/add", { name: "io.github.example/grants-search" });
    expect(r.status).toBe(400);
    expect(r.json.error).toContain("GRANTS_API_KEY");
    expect(handle.config().servers["grants-search"]).toBeUndefined();
  });

  test("names the entry does not ask for are refused", async () => {
    const r = await req("POST", "/catalog/add", {
      name: BUILT_ENTRY,
      values: [{ name: "OTHER", value: SECRET }],
    });
    expect(r.status).toBe(400);
    expect(handle.vault.data.size).toBe(0);
  });

  test("adds a remote key server with Bearer and raises privacy", async () => {
    const r = await req("POST", "/catalog/add", {
      name: KEYED_ENTRY,
      values: [{ name: "Authorization", value: SECRET }],
      privacy: { profile: "all", level: "strict" },
    });
    expect(r.status).toBe(201);
    expect(r.json.privacy).toBe("strict");
    const cfg = handle.config();
    const auth = cfg.accounts.notes?.auth;
    expect(auth?.type).toBe("header");
    const ref = auth?.type === "header" ? (auth.headers.Authorization ?? "") : "";
    const key = /\{\{vault:([^}]+)\}\}/.exec(ref)?.[1] ?? "";
    expect(handle.vault.data.get(key)).toBe(`Bearer ${SECRET}`);
    expect(cfg.profiles.all?.privacy).toBe("strict");
    expect(JSON.stringify(cfg)).not.toContain(SECRET);
  });

  test("privacy is never lowered", async () => {
    const s = setup({ profiles: { all: { privacy: "strict" } } });
    await s.signIn();
    const r = await s.req("POST", "/catalog/add", {
      name: BUILT_ENTRY,
      privacy: { profile: "all", level: "off" },
    });
    expect(r.status).toBe(201);
    expect(handle.config().profiles.all?.privacy).toBe("strict");
  });

  test("adds an OAuth server with browser sign-in", async () => {
    const r = await req("POST", "/catalog/add", { name: "app.linear/linear" });
    expect(r.status).toBe(201);
    expect(r.json.auth).toBe("oauth");
    expect(handle.config().servers.linear).toMatchObject({
      transport: "http",
      url: "https://mcp.linear.app/mcp",
    });
  });

  test("unknown and unrunnable entries are refused", async () => {
    expect((await req("POST", "/catalog/add", { name: "com.example/missing" })).status).toBe(404);
    expect((await req("POST", "/catalog/add", { name: BUNDLE_ENTRY })).status).toBe(400);
  });
});

describe("catalog request checks", () => {
  test("a foreign Host is refused", async () => {
    const s = setup();
    await s.signIn();
    expect((await s.req("GET", "/catalog", undefined, { host: "evil.example:7431" })).status).toBe(403);
    expect((await s.req("POST", "/catalog/refresh", {}, { host: "evil.example:7431" })).status).toBe(403);
  });

  test("a foreign or missing Origin is refused", async () => {
    const s = setup();
    await s.signIn();
    for (const origin of ["http://evil.example", null]) {
      expect((await s.req("POST", "/catalog/add", { name: BUILT_ENTRY }, { origin })).status).toBe(403);
      expect((await s.req("POST", "/catalog/refresh", {}, { origin })).status).toBe(403);
    }
    expect(fetches).toBe(0);
    expect(handle.config().servers.files).toBeUndefined();
  });

  test("CSRF token and session are required", async () => {
    const s = setup();
    expect((await s.req("GET", "/catalog")).status).toBe(401);
    await s.signIn();
    expect((await s.req("POST", "/catalog/add", { name: BUILT_ENTRY }, { csrf: "wrong" })).status).toBe(403);
  });
});
