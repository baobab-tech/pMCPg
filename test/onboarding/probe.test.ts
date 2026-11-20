import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { probeServer, suggestId } from "../../src/onboarding/probe.ts";
import { type OAuthServerFixture, startOAuthServer } from "../fixtures/oauth-server.ts";

let oauth: OAuthServerFixture;
let keyed: ReturnType<typeof Bun.serve>;
let open: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  oauth = startOAuthServer();
  // A key-protected server with no OAuth metadata anywhere.
  keyed = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: () => new Response("unauthorized", { status: 401 }),
  });
  open = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const s = new McpServer({ name: "Open Notes", version: "1" });
      const t = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await s.connect(t);
      return t.handleRequest(req);
    },
  });
});
afterAll(async () => {
  await oauth.stop();
  keyed.stop(true);
  open.stop(true);
});

describe("probeServer", () => {
  test("open server: no sign-in, name and id from the server", async () => {
    const r = await probeServer(`http://127.0.0.1:${open.port}/mcp`, { allowInsecure: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.auth).toEqual({ type: "none" });
    expect(r.transport).toBe("http");
    expect(r.serverName).toBe("Open Notes");
    expect(r.suggestedId).toBe("open-notes");
  });
  test("OAuth server: discovers issuer and dynamic registration", async () => {
    const r = await probeServer(oauth.mcpUrl, { allowInsecure: true });
    expect(r.ok && r.auth.type).toBe("oauth");
    if (r.ok && r.auth.type === "oauth") {
      expect(r.auth.issuer.startsWith(oauth.issuer)).toBe(true);
      expect(r.auth.registration).toBe("dcr");
    }
  });
  test("key-protected server: header auth", async () => {
    const r = await probeServer(`http://127.0.0.1:${keyed.port}/mcp`, { allowInsecure: true });
    expect(r.ok && r.auth.type).toBe("header");
  });
  test("plain http to a public host is refused; bad URL and unreachable give readable errors", async () => {
    const insecure = await probeServer("http://example.com/mcp");
    expect(insecure.ok).toBe(false);
    expect((await probeServer("not a url")).ok).toBe(false);
    const down = await probeServer("http://127.0.0.1:1/mcp", { allowInsecure: true });
    expect(down.ok).toBe(false);
    if (!down.ok) expect(down.error).toContain("Could not reach");
  });
});

test("suggestId", () => {
  expect(suggestId("https://mcp.linear.app/mcp")).toBe("linear");
  expect(suggestId("https://api.example-search.com/mcp")).toBe("example-search");
  expect(suggestId("https://x.dev/mcp", "My Server!")).toBe("my-server");
});
