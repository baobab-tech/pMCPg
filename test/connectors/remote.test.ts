import { afterEach, describe, expect, test } from "bun:test";
import type { ConnectorDeps } from "../../src/connectors/connector.ts";
import { createOAuthController, type VaultTokens } from "../../src/connectors/oauth.ts";
import { createRemoteConnector, remoteConnectorFactory } from "../../src/connectors/remote.ts";
import { checkRemoteUrl } from "../../src/connectors/remote-url.ts";
import type { AccountDef, ServerDef } from "../../src/core/config.ts";
import { GatewayError } from "../../src/core/types.ts";
import type { GatewayEvent } from "../../src/store/events.ts";
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

const ACCOUNT = "acme-work";
const oauthAccount: AccountDef = { server: "acme", auth: { type: "oauth" }, env: {} };

function remoteServer(url: string, allowInsecure = true): ServerDef {
  return { transport: "http", url, allowInsecure, trust: [] };
}

function setup(fx: OAuthServerFixture) {
  const vault = new MemoryVault();
  const events: GatewayEvent[] = [];
  const opened: string[] = [];
  const deps: ConnectorDeps = {
    vault,
    events: { emit: (e) => events.push(e) },
    gatewayUrl: "http://127.0.0.1:7431",
    openBrowser: async (u) => {
      opened.push(u);
    },
  };
  const server = remoteServer(fx.mcpUrl);
  const controller = createOAuthController(deps, (id) =>
    id === ACCOUNT ? { account: oauthAccount, server } : undefined,
  );
  return { vault, events, opened, deps, server, controller };
}

/** Plays the browser: follows the authorization URL and returns the callback URL it redirects to. */
async function approve(authorizationUrl: string): Promise<URL> {
  const res = await fetch(authorizationUrl, { redirect: "manual" });
  expect(res.status).toBe(302);
  return new URL(res.headers.get("location") as string);
}

async function signIn(s: ReturnType<typeof setup>) {
  const { authorizationUrl } = await s.controller.beginSignIn(ACCOUNT);
  return s.controller.handleCallback(await approve(authorizationUrl));
}

async function tokens(vault: MemoryVault): Promise<VaultTokens> {
  return JSON.parse((await vault.get(vaultKeys.oauthTokens(ACCOUNT))) as string);
}

async function until(cond: () => boolean | Promise<boolean>, ms = 5000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await Bun.sleep(20);
  }
}

let fx: OAuthServerFixture | undefined;
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
  await fx?.stop();
  fx = undefined;
});

describe("OAuth sign-in", () => {
  test("end to end: discovery, registration, PKCE, callback, call with token", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    const { authorizationUrl } = await s.controller.beginSignIn(ACCOUNT);
    expect(s.opened).toEqual([authorizationUrl]);
    const auth = new URL(authorizationUrl);
    expect(auth.origin).toBe(fx.issuer);
    expect(auth.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:7431/oauth/callback");
    expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(auth.searchParams.get("state")?.length).toBeGreaterThan(20);

    const callback = await approve(authorizationUrl);
    expect(await s.controller.handleCallback(callback)).toEqual({ accountId: ACCOUNT });
    expect(fx.counters.registrations).toBe(1);
    expect(fx.counters.codeExchanges).toBe(1);

    const t = await tokens(s.vault);
    expect(t.issuer).toBe(fx.issuer);
    expect(t.refresh_token).toBeTruthy();
    expect(t.expires_at).toBeGreaterThan(Date.now());
    const client = JSON.parse((await s.vault.get(vaultKeys.oauthClient(ACCOUNT))) as string);
    expect(client.issuer).toBe(fx.issuer);
    expect(await s.vault.get(vaultKeys.oauthDiscovery(ACCOUNT))).toBeTruthy();

    const c = createRemoteConnector(ACCOUNT, oauthAccount, s.server, s.deps);
    closers.push(() => c.close());
    const tools = await c.listTools();
    expect(tools.map((x) => x.name).sort()).toEqual(["echo", "whoami"]);
    const r = await c.callTool("echo", { text: "hi" });
    expect(r.content).toEqual([{ type: "text", text: "echo: hi" }]);
    expect(c.state()).toEqual({ status: "connected" });
    expect(s.events.some((e) => e.type === "account-state" && e.status === "connected")).toBe(true);
  });

  test("state is single-use", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    const { authorizationUrl } = await s.controller.beginSignIn(ACCOUNT);
    const callback = await approve(authorizationUrl);
    await s.controller.handleCallback(callback);
    await expect(s.controller.handleCallback(callback)).rejects.toThrow(/expired or already used/);
  });

  test("unknown state is rejected", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    await expect(
      s.controller.handleCallback(new URL("http://127.0.0.1:7431/oauth/callback?code=x&state=forged")),
    ).rejects.toThrow(/expired or already used/);
  });

  test("state expires after 10 minutes", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    let clock = Date.now();
    const controller = createOAuthController(
      s.deps,
      () => ({ account: oauthAccount, server: s.server }),
      {},
      { now: () => clock },
    );
    const { authorizationUrl } = await controller.beginSignIn(ACCOUNT);
    const callback = await approve(authorizationUrl);
    clock += 10 * 60 * 1000 + 1;
    await expect(controller.handleCallback(callback)).rejects.toThrow(/expired/);
  });

  test("a new sign-in cancels the previous one for the same account", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    const first = await s.controller.beginSignIn(ACCOUNT);
    const second = await s.controller.beginSignIn(ACCOUNT);
    await expect(s.controller.handleCallback(await approve(first.authorizationUrl))).rejects.toThrow();
    await s.controller.handleCallback(await approve(second.authorizationUrl));
  });

  test("not signed in: sign-in-needed without a network call", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    const c = createRemoteConnector(ACCOUNT, oauthAccount, s.server, s.deps);
    closers.push(() => c.close());
    const err = await c.listTools().catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("sign-in-needed");
    expect(c.state().status).toBe("sign-in-needed");
    expect(fx.counters.mcp401).toBe(0);
  });
});

describe("token refresh", () => {
  test("background refresh before expiry, with rotation", async () => {
    fx = startOAuthServer({ accessTtlSec: 2 });
    const s = setup(fx);
    await signIn(s);
    const before = await tokens(s.vault);
    const c = remoteConnectorFactory({ refreshLeadMs: 1500 })(ACCOUNT, oauthAccount, s.server, s.deps);
    closers.push(() => c.close());
    await c.listTools();
    await until(() => s.events.some((e) => e.type === "token-refreshed"));
    const after = await tokens(s.vault);
    expect(after.access_token).not.toBe(before.access_token);
    expect(after.refresh_token).not.toBe(before.refresh_token);
    expect(fx.counters.refreshes).toBeGreaterThanOrEqual(1);
    expect(fx.reusedRefreshTokens).toEqual([]);
    // Wait past the first token's expiry: calls keep working on the refreshed token.
    await until(() => !fx?.isAccessTokenValid(before.access_token));
    expect((await c.callTool("whoami", {})).content).toEqual([{ type: "text", text: "you are signed in" }]);
    expect(fx.counters.mcp401).toBe(0);
  });

  test("401: refresh once and retry", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    await signIn(s);
    const c = createRemoteConnector(ACCOUNT, oauthAccount, s.server, s.deps);
    closers.push(() => c.close());
    await c.listTools();
    fx.revokeAccessTokens();
    const r = await c.callTool("echo", { text: "again" });
    expect(r.content).toEqual([{ type: "text", text: "echo: again" }]);
    expect(fx.counters.mcp401).toBe(1);
    expect(fx.counters.refreshes).toBe(1);
    expect(s.events.filter((e) => e.type === "token-refreshed")).toHaveLength(1);
    expect(c.state()).toEqual({ status: "connected" });
  });

  test("revoked tokens: sign-in-needed, events, then sign-in recovers", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    await signIn(s);
    const c = createRemoteConnector(ACCOUNT, oauthAccount, s.server, s.deps);
    closers.push(() => c.close());
    const states: string[] = [];
    c.onStateChange((st) => states.push(st.status));
    await c.listTools();
    fx.revokeAll();
    const err = await c.callTool("whoami", {}).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("sign-in-needed");
    expect(c.state().status).toBe("sign-in-needed");
    expect(states).toContain("sign-in-needed");
    expect(s.events.some((e) => e.type === "account-state" && e.status === "sign-in-needed")).toBe(true);
    expect(await s.vault.get(vaultKeys.oauthTokens(ACCOUNT))).toBeUndefined();

    await signIn(s);
    expect((await c.callTool("whoami", {})).isError).toBeFalsy();
    expect(c.state().status).toBe("connected");
  });

  test("background refresh rejected: sign-in-needed", async () => {
    fx = startOAuthServer({ accessTtlSec: 2 });
    const s = setup(fx);
    await signIn(s);
    const c = remoteConnectorFactory({ refreshLeadMs: 1500 })(ACCOUNT, oauthAccount, s.server, s.deps);
    closers.push(() => c.close());
    await c.listTools();
    fx.revokeAll();
    await until(() => c.state().status === "sign-in-needed");
    expect(s.events.some((e) => e.type === "account-state" && e.status === "sign-in-needed")).toBe(true);
  });
});

describe("sign-out", () => {
  test("revokes at the server and deletes local credentials", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    const signedOut: string[] = [];
    const controller = createOAuthController(s.deps, () => ({ account: oauthAccount, server: s.server }), {
      onSignedOut: (id) => signedOut.push(id),
    });
    const { authorizationUrl } = await controller.beginSignIn(ACCOUNT);
    await controller.handleCallback(await approve(authorizationUrl));
    const t = await tokens(s.vault);
    await controller.signOut(ACCOUNT);
    expect(fx.counters.revocations).toBe(2);
    expect(fx.isAccessTokenValid(t.access_token)).toBe(false);
    expect(await s.vault.list(`account/${ACCOUNT}/oauth/`)).toEqual([]);
    expect(signedOut).toEqual([ACCOUNT]);

    const c = createRemoteConnector(ACCOUNT, oauthAccount, s.server, s.deps);
    closers.push(() => c.close());
    expect((await c.listTools().catch((e) => e)).code).toBe("sign-in-needed");
  });

  test("works without a revocation endpoint", async () => {
    fx = startOAuthServer({ revocation: false });
    const s = setup(fx);
    await signIn(s);
    await s.controller.signOut(ACCOUNT);
    expect(fx.counters.revocations).toBe(0);
    expect(await s.vault.list(`account/${ACCOUNT}/`)).toEqual([]);
  });
});

describe("header auth", () => {
  test("resolves vault placeholders per request", async () => {
    fx = startOAuthServer({ requireHeader: { name: "x-api-key", value: "k-123" } });
    const s = setup(fx);
    await s.vault.set("account/acme-work/api-key", "k-123");
    const account: AccountDef = {
      server: "acme",
      auth: { type: "header", headers: { "X-Api-Key": "{{vault:account/acme-work/api-key}}" } },
      env: {},
    };
    const c = createRemoteConnector(ACCOUNT, account, s.server, s.deps);
    closers.push(() => c.close());
    expect((await c.callTool("echo", { text: "k" })).content).toEqual([{ type: "text", text: "echo: k" }]);

    // Rotating the key in the vault takes effect on the next request without reconnecting.
    await s.vault.set("account/acme-work/api-key", "wrong");
    const err = await c.callTool("echo", { text: "k" }).catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("sign-in-needed");
    expect(JSON.stringify(s.events)).not.toContain("k-123");
  });
});

describe("URL policy", () => {
  test("insecure URL rejected", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    const c = createRemoteConnector(
      ACCOUNT,
      { server: "acme", auth: { type: "none" }, env: {} },
      remoteServer(fx.mcpUrl, false),
      s.deps,
    );
    expect(c.state().status).toBe("error");
    const err = await c.listTools().catch((e) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err.code).toBe("unreachable");
    expect(err.message).toMatch(/https/);
    expect(fx.counters.mcp401).toBe(0);
  });

  test("sign-in refused for an insecure URL", async () => {
    fx = startOAuthServer();
    const s = setup(fx);
    const controller = createOAuthController(s.deps, () => ({
      account: oauthAccount,
      server: remoteServer("http://example.com/mcp", true),
    }));
    await expect(controller.beginSignIn(ACCOUNT)).rejects.toThrow(/localhost and private/);
    expect(s.opened).toEqual([]);
  });

  test("checkRemoteUrl", () => {
    expect(checkRemoteUrl("https://mcp.example.com/mcp", false)).toBeUndefined();
    expect(checkRemoteUrl("http://mcp.example.com/mcp", false)).toMatch(/https/);
    expect(checkRemoteUrl("http://mcp.example.com/mcp", true)).toMatch(/localhost/);
    for (const ok of [
      "http://localhost:3000",
      "http://127.0.0.1",
      "http://10.1.2.3",
      "http://172.20.0.1",
      "http://192.168.1.5",
      "http://[::1]:8080",
      "http://[fd12::1]",
      "http://app.localhost",
    ])
      expect(checkRemoteUrl(ok, true)).toBeUndefined();
    for (const bad of [
      "http://172.32.0.1",
      "http://8.8.8.8",
      "http://192.169.0.1",
      "http://localhost.evil.com",
    ])
      expect(checkRemoteUrl(bad, true)).toBeDefined();
    expect(checkRemoteUrl("https://user:pw@x.com", false)).toMatch(/credentials/);
    expect(checkRemoteUrl("ftp://x.com", true)).toMatch(/scheme/);
  });
});
