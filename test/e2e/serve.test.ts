// End to end: real gateway (HTTP), real stdio server, real OAuth flow against the fake server, real MCP client.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { type Gateway, MCP_BODY_LIMIT, startGateway } from "../../src/gateway/runtime.ts";
import { vaultKeys } from "../../src/vault/vault.ts";
import { type OAuthServerFixture, startOAuthServer } from "../fixtures/oauth-server.ts";

const echo = join(import.meta.dir, "..", "fixtures", "echo-server.ts");
const port = 20000 + Math.floor(Math.random() * 20000);
let gw: Gateway;
let oauthServer: OAuthServerFixture;

async function connect(profile: string, token: string | undefined): Promise<Client> {
  const c = new Client({ name: "e2e", version: "0" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/p/${profile}/mcp`), {
      requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} },
    }),
  );
  return c;
}

function text(r: unknown): string {
  return ((r as { content: { text: string }[] }).content[0] as { text: string }).text;
}

beforeAll(async () => {
  oauthServer = startOAuthServer();
  const home = mkdtempSync(join(tmpdir(), "pmcpg-e2e-"));
  writeFileSync(
    join(home, "config.yaml"),
    `gateway: { port: ${port} }
servers:
  echo: { transport: stdio, command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(echo)}] }
  remote: { transport: http, url: ${JSON.stringify(oauthServer.mcpUrl)}, allowInsecure: true }
accounts:
  echo: { server: echo }
  remote-work: { server: remote, auth: { type: oauth } }
profiles:
  briefing: { accounts: [echo], policy: { preset: open } }
  research: { accounts: [remote-work], policy: { preset: open } }
  guarded: { accounts: [echo] }
`,
  );
  gw = await startGateway({ home, openBrowser: async () => {}, approvalTimeoutMs: 3000 });
  await gw.catalog.refresh("echo");
});

afterAll(async () => {
  await gw?.close();
  await oauthServer?.stop();
});

describe("pmcpg serve", () => {
  test("profile client sees two tools, searches and calls through to the stdio server", async () => {
    const token = await gw.vault.get(vaultKeys.clientToken("briefing"));
    const c = await connect("briefing", token);
    expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(["call_tool", "search_tools"]);
    const found = JSON.parse(
      text(await c.callTool({ name: "search_tools", arguments: { query: "send email" } })),
    );
    expect(found[0].name).toBe("echo__send_email");
    const r = await c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: "hi" } },
    });
    expect(text(r)).toBe("echo: hi");
    await c.close();
  });

  test("wrong token is refused", async () => {
    const other = await gw.vault.get(vaultKeys.clientToken("research"));
    await expect(connect("briefing", other)).rejects.toThrow();
    await expect(connect("briefing", undefined)).rejects.toThrow();
  });

  test("a profile cannot call another profile's tools", async () => {
    const c = await connect("research", await gw.vault.get(vaultKeys.clientToken("research")));
    const r = await c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: "x" } },
    });
    expect(r.isError).toBe(true);
    await c.close();
  });

  test("OAuth sign-in through the gateway callback, then remote tools are searchable", async () => {
    const { authorizationUrl } = await gw.oauth.beginSignIn("remote-work");
    // The fake authorization server approves immediately and redirects to the gateway callback.
    const res = await fetch(authorizationUrl, { redirect: "manual" });
    const callback = res.headers.get("location") as string;
    expect(callback.startsWith(`http://127.0.0.1:${port}/oauth/callback`)).toBe(true);
    const done = await fetch(callback);
    expect(done.status).toBe(200);
    await gw.catalog.refresh("remote-work");
    expect(gw.catalog.count("remote-work")).toBeGreaterThan(0);

    const c = await connect("research", await gw.vault.get(vaultKeys.clientToken("research")));
    const found = JSON.parse(
      text(await c.callTool({ name: "search_tools", arguments: { query: "identity" } })),
    );
    expect(found[0].name).toBe("remote-work__whoami");
    const r = await c.callTool({
      name: "call_tool",
      arguments: { name: "remote-work__whoami", arguments: {} },
    });
    expect(text(r)).toBe("you are signed in");
    await c.close();
  });

  test("local API needs the admin token", async () => {
    expect((await fetch(`http://127.0.0.1:${port}/api/status`)).status).toBe(401);
    const admin = await gw.vault.get(vaultKeys.adminToken());
    const r = await fetch(`http://127.0.0.1:${port}/api/status`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    expect(r.status).toBe(200);
  });
});

describe("gateway handle", () => {
  test("updateConfig validates, saves and applies; bad input changes nothing", async () => {
    await gw.handle.updateConfig((c) => {
      c.profiles.extra = { accounts: ["echo"] } as never;
    });
    expect(gw.config().profiles.extra?.privacy).toBe("standard");
    expect(gw.config().profiles.extra?.policy.preset).toBe("balanced");
    await expect(
      gw.handle.updateConfig((c) => {
        c.profiles.broken = { accounts: ["nope"] } as never;
      }),
    ).rejects.toThrow("nope");
    expect(gw.config().profiles.broken).toBeUndefined();
    expect((await gw.handle.clientToken("extra")).length).toBeGreaterThan(20);
  });
});

describe("phase 2 wiring", () => {
  const token = (p: string) => gw.vault.get(vaultKeys.clientToken(p));

  test("personal data in results is masked; the placeholder is restored on the way out", async () => {
    const c = await connect("briefing", await token("briefing"));
    const r1 = await c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: "mail jane.doe@acme.org" } },
    });
    expect(text(r1)).toMatch(/^echo: mail \[EMAIL_1_[a-z0-9]{4}\]$/);
    const placeholder = text(r1).slice("echo: mail ".length);
    // The model sends the placeholder back; the server receives the real address, and the result is masked again.
    const r2 = await c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: placeholder } },
    });
    expect(text(r2)).toBe(`echo: ${placeholder}`);
    await c.close();
  });

  test("privacy reset through the admin API: old placeholders stop restoring", async () => {
    const c = await connect("briefing", await token("briefing"));
    const r1 = await c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: "mail reset.me@acme.org" } },
    });
    const placeholder = text(r1).slice("echo: mail ".length);
    const reset = (body: unknown) =>
      gw.vault.get(vaultKeys.adminToken()).then((admin) =>
        fetch(`http://127.0.0.1:${port}/api/privacy/reset`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${admin}` },
          body: JSON.stringify(body),
        }),
      );
    expect((await reset({ profile: "ghost" })).status).toBe(404);
    const r = await reset({ profile: "briefing" });
    expect(r.status).toBe(200);
    const counts = (await r.json()) as { sessions: number; placeholders: number };
    expect(counts.sessions).toBe(1);
    expect(counts.placeholders).toBeGreaterThan(0);
    const r2 = await c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: placeholder } },
    });
    expect(text(r2)).toContain("does not match any value");
    await (gw.handle.activity as unknown as { flush(): Promise<void> }).flush();
    const events = await gw.handle.activity?.query({ type: "privacy-reset", limit: 10 });
    expect(events?.[0]?.event).toEqual({ type: "privacy-reset", profileId: "briefing", ...counts });
    await c.close();
  });

  test("balanced preset asks before an unannotated tool; approving lets the call through", async () => {
    const c = await connect("guarded", await token("guarded"));
    const pending = c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: "hi" } },
    });
    let id: string | undefined;
    for (let i = 0; i < 50 && !id; i++) {
      id = gw.handle.approvals?.list({ status: "pending" })[0]?.id;
      if (!id) await Bun.sleep(20);
    }
    expect(id).toBeDefined();
    gw.handle.approvals?.decide(id as string, "approved");
    expect(text(await pending)).toBe("echo: hi");
    await c.close();
  });

  test("approvals: a state.db write is ignored; the admin API decides (POL-2)", async () => {
    const c = await connect("guarded", await token("guarded"));
    const pending = c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: "again" } },
    });
    let id: string | undefined;
    for (let i = 0; i < 50 && !id; i++) {
      id = gw.handle.approvals?.list({ status: "pending" })[0]?.id;
      if (!id) await Bun.sleep(20);
    }
    expect(id).toBeDefined();
    const api = (body: unknown, auth = true) =>
      gw.vault.get(vaultKeys.adminToken()).then((admin) =>
        fetch(`http://127.0.0.1:${port}/api/approvals/${id}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(auth ? { authorization: `Bearer ${admin}` } : {}),
          },
          body: JSON.stringify(body),
        }),
      );
    expect((await api({ decision: "approved" }, false)).status).toBe(401);
    expect((await api({ decision: "maybe" })).status).toBe(400);
    expect((await api({ decision: "approved" })).status).toBe(200);
    expect(text(await pending)).toBe("echo: again");
    expect((await api({ decision: "denied" })).status).toBe(400);
    await c.close();
  });

  test("calls and searches land in the encrypted activity log", async () => {
    await (gw.handle.activity as unknown as { flush(): Promise<void> }).flush();
    const entries = await gw.handle.activity?.query({ limit: 100 });
    const types = new Set(entries?.map((e) => e.event.type));
    expect(types.has("call")).toBe(true);
    expect(types.has("search")).toBe(true);
    const raw = gw.db.query<{ payload: Uint8Array }, []>("SELECT payload FROM activity").all();
    expect(raw.some((r) => Buffer.from(r.payload).toString().includes("echo__echo"))).toBe(false);
  });

  test("universal /mcp: the token picks the profile", async () => {
    const c = new Client({ name: "e2e", version: "0" });
    await c.connect(
      new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
        requestInit: { headers: { authorization: `Bearer ${await token("briefing")}` } },
      }),
    );
    // briefing's open policy lets echo through at once; "all" (balanced) would hold it for approval.
    const r = await c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: "x" } },
    });
    expect(text(r)).toBe("echo: x");
    await c.close();
    await expect(connect("../mcp", "nope")).rejects.toThrow();
  });

  test("web UI API is mounted and needs a session", async () => {
    const s = await fetch(`http://127.0.0.1:${port}/api/ui/session`);
    expect(s.status).toBe(200);
    const st = await fetch(`http://127.0.0.1:${port}/api/ui/status`);
    expect(st.status).toBe(401);
  });
});

describe("server changes and limits", () => {
  test("changing a server's command restarts the connector and lists its tools again (CON-2)", async () => {
    const names = () =>
      gw.handle
        .tools("echo")
        .map((t) => t.name)
        .sort();
    expect(names()).toContain("echo");
    const probe = join(import.meta.dir, "..", "fixtures", "stdio-probe-server.ts");
    await gw.handle.updateConfig((c) => {
      const s = c.servers.echo as { args: string[] };
      s.args = [probe];
    });
    expect(names()).toContain("env_keys");
    expect(names()).not.toContain("echo");
    await gw.handle.updateConfig((c) => {
      const s = c.servers.echo as { args: string[] };
      s.args = [echo];
    });
    expect(names()).toContain("echo");
  });

  test("moving a remote server to another origin forgets its OAuth tokens (CON-2)", async () => {
    expect(await gw.vault.get(vaultKeys.oauthTokens("remote-work"))).toBeDefined();
    const before = (gw.config().servers.remote as { url: string }).url;
    await gw.handle.updateConfig((c) => {
      (c.servers.remote as { url: string }).url = "http://127.0.0.1:9/mcp";
    });
    expect(await gw.vault.get(vaultKeys.oauthTokens("remote-work"))).toBeUndefined();
    expect(await gw.vault.get(vaultKeys.oauthClient("remote-work"))).toBeUndefined();
    await gw.handle.updateConfig((c) => {
      (c.servers.remote as { url: string }).url = before;
    });
  });

  test("request bodies over the limit are refused before they are read (WEB-3)", async () => {
    const token = await gw.vault.get(vaultKeys.clientToken("briefing"));
    const r = await fetch(`http://127.0.0.1:${port}/p/briefing/mcp`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: "x".repeat(MCP_BODY_LIMIT + 1),
    });
    expect(r.status).toBe(413);
  });
});
