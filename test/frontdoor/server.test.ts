import { afterEach, describe, expect, test } from "bun:test";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { GatewayError } from "../../src/core/types.ts";
import { CLIENT_SESSION_HEADER, clientSessionId, tokensMatch } from "../../src/frontdoor/server.ts";
import type { Step } from "../../src/pipeline/step.ts";
import { FakeConnector, type Harness, startFrontDoor, TOKENS, text } from "./helpers.ts";

const obj = (...keys: string[]) => ({
  type: "object",
  properties: Object.fromEntries(keys.map((k) => [k, { type: "string" }])),
});

const mail = () =>
  new FakeConnector("mail", [
    { name: "send_email", description: "Send an email to a recipient", inputSchema: obj("to", "body") },
    { name: "search_email", description: "Search the mailbox", inputSchema: obj("query") },
    { name: "purge_all", description: "Delete every email permanently", inputSchema: obj() },
  ]);
const chat = () =>
  new FakeConnector("chat", [
    { name: "post_message", description: "Post a message to a channel", inputSchema: obj("channel", "text") },
  ]);

let h: Harness | undefined;
afterEach(async () => {
  await h?.stop();
  h = undefined;
});

describe("auth, Host and Origin", () => {
  test("refuses missing, wrong and cross-profile tokens and unknown profiles with 401", async () => {
    h = await startFrontDoor([mail()]);
    const post = (url: URL, token?: string) =>
      fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
    expect((await post(h.url())).status).toBe(401);
    expect((await post(h.url(), "nope")).status).toBe(401);
    expect((await post(h.url("work"), "tok-all")).status).toBe(401);
    expect((await post(h.url("ghost"), "tok-all")).status).toBe(401);
    expect((await post(h.url("BAD__x"), "tok-all")).status).toBe(401);
    expect((await post(h.url(), "nope")).headers.get("www-authenticate")).toBe("Bearer");
  });

  test("rejects foreign Host and Origin with 403", async () => {
    h = await startFrontDoor([mail()]);
    const headers = { authorization: "Bearer tok-all", "content-type": "application/json" };
    const r1 = await h.app.request("http://evil.example/mcp", { method: "POST", headers, body: "{}" });
    expect(r1.status).toBe(403);
    const r2 = await h.app.request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: { ...headers, origin: "https://evil.example" },
      body: "{}",
    });
    expect(r2.status).toBe(403);
  });

  test("tokensMatch", () => {
    expect(tokensMatch("abc", "abc")).toBe(true);
    expect(tokensMatch("abc", "abd")).toBe(false);
    expect(tokensMatch("abc", "abcd")).toBe(false);
  });
});

describe("tools", () => {
  test("lists only search_tools and call_tool", async () => {
    h = await startFrontDoor([mail(), chat()]);
    const c = await h.connect();
    const names = (await c.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual(["call_tool", "search_tools"]);
  });

  test("search_tools returns schemas, scoped to the profile, and emits a search event", async () => {
    h = await startFrontDoor([mail(), chat()]);
    const all = await h.connect();
    const r = await all.callTool({ name: "search_tools", arguments: { query: "post a message" } });
    const hits = JSON.parse(text(r)) as { name: string; inputSchema: unknown }[];
    expect(hits[0]?.name).toBe("chat__post_message");
    expect(hits[0]?.inputSchema).toEqual(obj("channel", "text"));

    const work = await h.connect("work");
    const wr = await work.callTool({
      name: "search_tools",
      arguments: { query: "post a message", limit: 10 },
    });
    const workHits = JSON.parse(text(wr)) as { name: string }[];
    expect(workHits.every((t) => t.name.startsWith("mail__"))).toBe(true);

    const ev = h.events.filter((e) => e.type === "search");
    expect(ev.length).toBe(2);
    expect(ev[1]).toMatchObject({ type: "search", profileId: "work" });
  });

  test("call_tool forwards to the connector and emits a call event", async () => {
    const m = mail();
    h = await startFrontDoor([m]);
    const c = await h.connect();
    const r = await c.callTool({
      name: "call_tool",
      arguments: { name: "mail__send_email", arguments: { to: "a@b.c", body: "hi" } },
    });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toBe("mail:send_email");
    expect(m.calls).toEqual([{ name: "send_email", args: { to: "a@b.c", body: "hi" } }]);
    const ev = h.events.find((e) => e.type === "call");
    expect(ev).toMatchObject({
      type: "call",
      profileId: "all",
      tool: "mail__send_email",
      outcome: "ok",
      masked: 0,
    });
    expect(JSON.stringify(h.events)).not.toContain("a@b.c");
  });

  test("serves 2026-07-28 (modern) clients as well as legacy ones", async () => {
    h = await startFrontDoor([mail()]);
    const c = await h.connect("work", undefined, "auto");
    expect(c.getProtocolEra()).toBe("modern");
    const r = await c.callTool({ name: "call_tool", arguments: { name: "mail__send_email", arguments: {} } });
    expect(text(r)).toBe("mail:send_email");
    const legacy = await h.connect("work");
    expect(legacy.getProtocolEra()).toBe("legacy");
  });

  test("/p/all/mcp and /mcp serve the same profile", async () => {
    h = await startFrontDoor([mail()]);
    const c = await h.connect("all");
    const r = await c.callTool({
      name: "call_tool",
      arguments: { name: "mail__search_email", arguments: {} },
    });
    expect(text(r)).toBe("mail:search_email");
  });
});

describe("errors", () => {
  const codeOf = (r: { structuredContent?: unknown }) =>
    (r.structuredContent as { error?: { code: string } } | undefined)?.error?.code;

  test("unknown tool", async () => {
    h = await startFrontDoor([mail()]);
    const c = await h.connect();
    const r = await c.callTool({ name: "call_tool", arguments: { name: "mail__nope", arguments: {} } });
    expect(r.isError).toBe(true);
    expect(codeOf(r)).toBe("unknown-tool");
    expect(h.events.at(-1)).toMatchObject({ type: "call", outcome: "error", errorCode: "unknown-tool" });
  });

  test("tool of another profile's account is unknown to this profile", async () => {
    h = await startFrontDoor([mail(), chat()]);
    const c = await h.connect("work");
    const r = await c.callTool({
      name: "call_tool",
      arguments: { name: "chat__post_message", arguments: {} },
    });
    expect(codeOf(r)).toBe("unknown-tool");
  });

  test("resolve rejects out-of-profile tools even if the index has them", async () => {
    const ch = chat();
    h = await startFrontDoor([mail(), ch]);
    h.index.setTools("work", h.index.search("all", "post message mail email purge", 10));
    const c = await h.connect("work");
    const r1 = await c.callTool({
      name: "call_tool",
      arguments: { name: "chat__post_message", arguments: {} },
    });
    expect(codeOf(r1)).toBe("not-in-profile");
    const r2 = await c.callTool({ name: "call_tool", arguments: { name: "mail__purge_all", arguments: {} } });
    expect(codeOf(r2)).toBe("not-in-profile");
    expect(ch.calls.length).toBe(0);
  });

  test("a step that denies stops the call", async () => {
    const m = mail();
    const deny: Step = {
      name: "policy",
      phase: "before",
      async run() {
        throw new GatewayError("denied", "blocked by policy");
      },
    };
    h = await startFrontDoor([m], { steps: [deny] });
    const c = await h.connect();
    const r = await c.callTool({ name: "call_tool", arguments: { name: "mail__send_email", arguments: {} } });
    expect(codeOf(r)).toBe("denied");
    expect(text(r)).toBe("denied: blocked by policy");
    expect(m.calls.length).toBe(0);
    expect(h.events.at(-1)).toMatchObject({ outcome: "denied", errorCode: "denied" });
  });

  test("steps see the context and after steps can modify the result", async () => {
    const seen: string[] = [];
    const steps: Step[] = [
      {
        name: "before",
        phase: "before",
        async run(ctx) {
          seen.push(`${ctx.profileId}:${ctx.tool.qualifiedName}:${ctx.session.profileId}`);
          ctx.args = { ...ctx.args, injected: "1" };
        },
      },
      {
        name: "mask",
        phase: "after",
        async run(ctx) {
          ctx.result = { content: [{ type: "text", text: "[MASKED]" }] };
          ctx.masks.push({ type: "email", placeholder: "[EMAIL_1]", where: "result" });
        },
      },
    ];
    const m = mail();
    h = await startFrontDoor([m], { steps });
    const c = await h.connect();
    const r = await c.callTool({ name: "call_tool", arguments: { name: "mail__send_email", arguments: {} } });
    expect(text(r)).toBe("[MASKED]");
    expect(seen).toEqual(["all:mail__send_email:all"]);
    expect(m.calls[0]?.args).toEqual({ injected: "1" });
    expect(h.events.at(-1)).toMatchObject({ outcome: "ok", masked: 1 });
  });

  test("downstream exceptions do not leak their message", async () => {
    const m = new FakeConnector("mail", [{ name: "x", inputSchema: obj() }], () => {
      throw new Error("token=sk-secret-123");
    });
    h = await startFrontDoor([m]);
    const c = await h.connect();
    const r = await c.callTool({ name: "call_tool", arguments: { name: "mail__x", arguments: {} } });
    expect(codeOf(r)).toBe("downstream-error");
    expect(JSON.stringify(r)).not.toContain("sk-secret");
    expect(JSON.stringify(h.events)).not.toContain("sk-secret");
  });

  test("missing connector is unreachable", async () => {
    h = await startFrontDoor([mail()], { getConnector: () => undefined });
    const c = await h.connect();
    const r = await c.callTool({ name: "call_tool", arguments: { name: "mail__send_email", arguments: {} } });
    expect(codeOf(r)).toBe("unreachable");
  });
});

describe("privacy sessions (PRV-4)", () => {
  const clients: Client[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) await c.close();
  });

  /** A step that records the session each call ran in. */
  function recorder(seen: string[]): Step {
    return {
      name: "record",
      phase: "before",
      async run(ctx) {
        seen.push(ctx.session.id);
      },
    };
  }

  async function client(session: string | undefined, mode: "legacy" | "auto" = "auto") {
    const c = new Client({ name: "t", version: "0" }, { versionNegotiation: { mode } });
    const headers: Record<string, string> = { Authorization: `Bearer ${TOKENS.all}` };
    if (session) headers[CLIENT_SESSION_HEADER] = session;
    await c.connect(new StreamableHTTPClientTransport(h?.url("all") as URL, { requestInit: { headers } }));
    clients.push(c);
    return async () => {
      await c.callTool({ name: "call_tool", arguments: { name: "mail__search_email", arguments: {} } });
    };
  }

  test("each client session id gets its own session; clients without one share the profile's", async () => {
    const seen: string[] = [];
    h = await startFrontDoor([mail()], { steps: [recorder(seen)] });
    const a = await client("client-a-0001");
    const b = await client("client-b-0001", "legacy");
    const plain1 = await client(undefined);
    const plain2 = await client(undefined, "legacy");
    await a();
    await b();
    await a();
    await plain1();
    await plain2();
    const [a1, b1, a2, p1, p2] = seen;
    expect(a1).toBe(a2 as string);
    expect(a1).not.toBe(b1 as string);
    expect(p1).toBe(p2 as string);
    expect(new Set([a1, b1, p1]).size).toBe(3);
  });

  test("an idle session starts over", async () => {
    const seen: string[] = [];
    h = await startFrontDoor([mail()], { steps: [recorder(seen)], sessionIdleMs: 50 });
    const a = await client("client-a-0001");
    await a();
    await a();
    await Bun.sleep(80);
    await a();
    expect(seen[0]).toBe(seen[1] as string);
    expect(seen[2]).not.toBe(seen[1] as string);
  });

  test("malformed session ids are ignored", () => {
    const req = (v: string) => new Request("http://x/", { headers: { [CLIENT_SESSION_HEADER]: v } });
    expect(clientSessionId(req("client-a-0001"))).toBe("client-a-0001");
    expect(clientSessionId(req("short"))).toBeUndefined();
    expect(clientSessionId(req("a/b/../c-12345"))).toBeUndefined();
    expect(clientSessionId(req("x".repeat(200)))).toBeUndefined();
    expect(clientSessionId(undefined)).toBeUndefined();
  });
});
