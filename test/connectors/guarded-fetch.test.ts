import { afterEach, describe, expect, test } from "bun:test";
import type { ConnectorDeps } from "../../src/connectors/connector.ts";
import { checkGuardedUrl, type FetchLike, guardedFetch } from "../../src/connectors/guarded-fetch.ts";
import {
  ClientIssuerMismatchError,
  createOAuthController,
  revokeTokens,
  VaultOAuthProvider,
} from "../../src/connectors/oauth.ts";
import type { AccountDef, ServerDef } from "../../src/core/config.ts";
import { probeServer } from "../../src/onboarding/probe.ts";
import { type Vault, vaultKeys } from "../../src/vault/vault.ts";
import { type OAuthServerFixture, startOAuthServer } from "../fixtures/oauth-server.ts";

class MemoryVault implements Vault {
  readonly keySource = "env" as const;
  readonly data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k);
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async delete(k: string) {
    return this.data.delete(k);
  }
  async list(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

const servers: ReturnType<typeof Bun.serve>[] = [];
let fx: OAuthServerFixture | undefined;
afterEach(async () => {
  for (const s of servers.splice(0)) s.stop(true);
  await fx?.stop();
  fx = undefined;
});

/** Local fake server on 127.0.0.1; records each request it gets. */
function serve(handler: (req: Request) => Response | Promise<Response>) {
  const seen: { method: string; path: string; body: string; auth: string | null }[] = [];
  const s = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    async fetch(req) {
      const body = await req.text();
      seen.push({
        method: req.method,
        path: new URL(req.url).pathname,
        body,
        auth: req.headers.get("authorization"),
      });
      return handler(req);
    },
  });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.port}`, seen };
}

/** Records the URLs the guard lets through to the network. */
function recording() {
  const urls: string[] = [];
  const f: FetchLike = (u, init) => {
    urls.push(String(u));
    return fetch(u, init);
  };
  return { urls, f };
}

describe("checkGuardedUrl", () => {
  test("https anywhere, http only to loopback or the allowed origin", () => {
    expect(checkGuardedUrl("https://as.example.org/x")).toBeUndefined();
    expect(checkGuardedUrl("http://127.0.0.1:9/x")).toBeUndefined();
    expect(checkGuardedUrl("http://localhost:9/x")).toBeUndefined();
    expect(checkGuardedUrl("http://[::1]:9/x")).toBeUndefined();
    expect(checkGuardedUrl("http://as.example.org/x")).toMatch(/plain http/);
    expect(checkGuardedUrl("http://10.0.0.5/admin")).toMatch(/plain http/);
    expect(checkGuardedUrl("http://192.168.1.2:8080/x", "http://192.168.1.2:8080")).toBeUndefined();
    expect(checkGuardedUrl("http://192.168.1.3:8080/x", "http://192.168.1.2:8080")).toMatch(/plain http/);
    expect(checkGuardedUrl("file:///etc/passwd")).toMatch(/scheme/);
    expect(checkGuardedUrl("https://u:p@as.example.org/")).toMatch(/credentials/);
  });
});

describe("guardedFetch", () => {
  test("plain http to a non-loopback host is refused before any request", async () => {
    const { urls, f } = recording();
    await expect(guardedFetch({ fetch: f })("http://as.example.org/.well-known/x")).rejects.toThrow(
      /plain http/,
    );
    expect(urls).toEqual([]);
  });

  test("GET follows a redirect only to an allowed URL, each hop checked", async () => {
    const b = serve(() => Response.json({ ok: true }));
    const a = serve((req) => {
      const p = new URL(req.url).pathname;
      if (p === "/to-b") return Response.redirect(`${b.url}/meta`, 302);
      if (p === "/to-http") return Response.redirect("http://10.0.0.5/admin", 302);
      return Response.redirect(`${a.url}/loop`, 302);
    });
    const { urls, f } = recording();
    const g = guardedFetch({ fetch: f });
    expect(await (await g(`${a.url}/to-b`)).json()).toEqual({ ok: true });
    await expect(g(`${a.url}/to-http`)).rejects.toThrow(/plain http to 10\.0\.0\.5/);
    expect(urls).not.toContain("http://10.0.0.5/admin");
    await expect(g(`${a.url}/loop`)).rejects.toThrow(/more than 3 redirects/);
  });

  test("POST does not follow a redirect to another origin", async () => {
    const b = serve(() => new Response("ok"));
    const a = serve((req) =>
      new URL(req.url).pathname === "/same"
        ? new Response("done")
        : new Response(null, { status: 307, headers: { location: `${b.url}/steal` } }),
    );
    const g = guardedFetch();
    await expect(g(`${a.url}/x`, { method: "POST", body: "token=t-secret" })).rejects.toThrow(
      /refusing to follow a POST redirect/,
    );
    expect(b.seen).toEqual([]);
  });

  test("POST follows a same-origin 307", async () => {
    const a = serve((req) =>
      new URL(req.url).pathname === "/same"
        ? new Response("done")
        : new Response(null, { status: 307, headers: { location: "/same" } }),
    );
    const res = await guardedFetch()(`${a.url}/x`, { method: "POST", body: "a=1" });
    expect(await res.text()).toBe("done");
    expect(a.seen.map((r) => [r.path, r.body])).toEqual([
      ["/x", "a=1"],
      ["/same", "a=1"],
    ]);
  });

  test("times out against a hanging host", async () => {
    const a = serve(() => new Promise<Response>(() => {}));
    const started = Date.now();
    await expect(guardedFetch({ timeoutMs: 200 })(`${a.url}/hang`)).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3000);
  });

  test("caps the body, declared or streamed", async () => {
    const big = "x".repeat(4096);
    const a = serve((req) => {
      if (new URL(req.url).pathname === "/declared") return new Response(big);
      const stream = new ReadableStream({
        start(c) {
          for (let i = 0; i < 8; i++) c.enqueue(new TextEncoder().encode(big.slice(0, 512)));
          c.close();
        },
      });
      return new Response(stream);
    });
    const g = guardedFetch({ maxBytes: 1024 });
    await expect(g(`${a.url}/declared`)).rejects.toThrow(/larger than 1024 bytes/);
    const streamed = await g(`${a.url}/streamed`);
    await expect(streamed.text()).rejects.toThrow(/larger than 1024 bytes/);
    expect(await (await guardedFetch({ maxBytes: 8192 })(`${a.url}/declared`)).text()).toBe(big);
  });
});

describe("discovery (NET-1)", () => {
  test("probe does not fetch a resource_metadata URL over plain http to a LAN host", async () => {
    const a = serve(
      () =>
        new Response("unauthorized", {
          status: 401,
          headers: { "www-authenticate": 'Bearer resource_metadata="http://10.0.0.5/internal-admin?x=1"' },
        }),
    );
    const { urls, f } = recording();
    const r = await probeServer(`${a.url}/mcp`, { allowInsecure: true, fetch: f });
    expect(r.ok).toBe(true);
    expect(urls.some((u) => u.includes("10.0.0.5"))).toBe(false);
  });

  test("probe gives up on a hanging metadata host instead of hanging", async () => {
    const hang = serve(() => new Promise<Response>(() => {}));
    const a = serve(
      () =>
        new Response("unauthorized", {
          status: 401,
          headers: { "www-authenticate": `Bearer resource_metadata="${hang.url}/.well-known/x"` },
        }),
    );
    const started = Date.now();
    const r = await probeServer(`${a.url}/mcp`, { allowInsecure: true, timeoutMs: 300 });
    expect(r.ok).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

const ACCOUNT = "acme-work";
const oauthAccount: AccountDef = { server: "acme", auth: { type: "oauth" }, env: {} };

function deps(vault: Vault): ConnectorDeps {
  return {
    vault,
    events: { emit: () => {} },
    gatewayUrl: "http://127.0.0.1:7431",
    openBrowser: async () => {},
  };
}

/** Seeds signed-in state whose AS metadata names `revocation_endpoint`. */
async function seedSignedIn(vault: MemoryVault, issuer: string, revocation: string) {
  await vault.set(
    vaultKeys.oauthTokens(ACCOUNT),
    JSON.stringify({ access_token: "at-1", refresh_token: "rt-1", token_type: "Bearer", issuer }),
  );
  await vault.set(
    vaultKeys.oauthClient(ACCOUNT),
    JSON.stringify({ client_id: "cid", client_secret: "cs-1", issuer, entered: true }),
  );
  await vault.set(
    vaultKeys.oauthDiscovery(ACCOUNT),
    JSON.stringify({
      authorizationServerUrl: issuer,
      authorizationServerMetadata: {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        response_types_supported: ["code"],
        revocation_endpoint: revocation,
      },
    }),
  );
}

describe("revocation (OAU-1)", () => {
  test("a redirect to another origin is not followed; the token never reaches it", async () => {
    const b = serve(() => new Response("ok"));
    const a = serve(() => new Response(null, { status: 307, headers: { location: `${b.url}/` } }));
    const vault = new MemoryVault();
    await seedSignedIn(vault, a.url, `${a.url}/revoke`);
    const provider = new VaultOAuthProvider(ACCOUNT, { vault, gatewayUrl: "http://127.0.0.1:7431" });
    expect(await revokeTokens(provider)).toBe(0);
    expect(a.seen.length).toBe(2);
    expect(b.seen).toEqual([]);
  });

  test("an http endpoint on a non-loopback host is never called", async () => {
    const vault = new MemoryVault();
    await seedSignedIn(vault, "https://as.example.org", "http://as.example.org/revoke");
    const { urls, f } = recording();
    const provider = new VaultOAuthProvider(ACCOUNT, { vault, gatewayUrl: "http://127.0.0.1:7431" });
    expect(await revokeTokens(provider, f)).toBe(0);
    expect(urls).toEqual([]);
  });
});

describe("entered client secret (OAU-2)", () => {
  function controllerFor(vault: MemoryVault, server: ServerDef, f?: FetchLike) {
    return createOAuthController(
      deps(vault),
      (id) => (id === ACCOUNT ? { account: oauthAccount, server } : undefined),
      {},
      { fetch: f },
    );
  }

  test("is not sent to a different issuer: clear error, nothing registered, entry kept", async () => {
    fx = startOAuthServer();
    const vault = new MemoryVault();
    const entered = JSON.stringify({
      client_id: "cid-manual",
      client_secret: "cs-SECRET",
      issuer: "https://idp.example.org",
      entered: true,
    });
    await vault.set(vaultKeys.oauthClient(ACCOUNT), entered);
    const sent: string[] = [];
    const f: FetchLike = async (u, init) => {
      sent.push(`${u} ${new Headers(init?.headers).get("authorization") ?? ""} ${init?.body ?? ""}`);
      return fetch(u, init);
    };
    const server: ServerDef = { transport: "http", url: fx.mcpUrl, allowInsecure: true, trust: [] };
    const err = await controllerFor(vault, server, f)
      .beginSignIn(ACCOUNT)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ClientIssuerMismatchError);
    expect(err.message).toContain("https://idp.example.org");
    expect(err.message).toContain(fx.issuer);
    expect(err.message).not.toContain("cs-SECRET");
    expect(sent.join("\n")).not.toContain("cs-SECRET");
    expect(sent.join("\n")).not.toContain(btoa("cid-manual:cs-SECRET"));
    expect(fx.counters.registrations).toBe(0);
    expect(await vault.get(vaultKeys.oauthClient(ACCOUNT))).toBe(entered);
  });

  test("a secret saved without an issuer is refused, not bound to the first issuer", async () => {
    fx = startOAuthServer();
    const vault = new MemoryVault();
    await vault.set(
      vaultKeys.oauthClient(ACCOUNT),
      JSON.stringify({ client_id: "cid-old", client_secret: "cs-OLD" }),
    );
    const server: ServerDef = { transport: "http", url: fx.mcpUrl, allowInsecure: true, trust: [] };
    await expect(controllerFor(vault, server).beginSignIn(ACCOUNT)).rejects.toThrow(
      /enter the client secret again/,
    );
    expect(JSON.parse((await vault.get(vaultKeys.oauthClient(ACCOUNT))) as string).issuer).toBeUndefined();
  });

  test("is used with its own issuer, and kept on sign-out", async () => {
    fx = startOAuthServer();
    const vault = new MemoryVault();
    await vault.set(
      vaultKeys.oauthClient(ACCOUNT),
      JSON.stringify({ client_id: "cid-manual", client_secret: "cs-1", issuer: fx.issuer, entered: true }),
    );
    const server: ServerDef = { transport: "http", url: fx.mcpUrl, allowInsecure: true, trust: [] };
    const controller = controllerFor(vault, server);
    const { authorizationUrl } = await controller.beginSignIn(ACCOUNT);
    expect(new URL(authorizationUrl).searchParams.get("client_id")).toBe("cid-manual");
    expect(fx.counters.registrations).toBe(0);
    await controller.signOut(ACCOUNT);
    expect(JSON.parse((await vault.get(vaultKeys.oauthClient(ACCOUNT))) as string).client_secret).toBe(
      "cs-1",
    );
    expect(await vault.get(vaultKeys.oauthDiscovery(ACCOUNT))).toBeUndefined();
  });
});
