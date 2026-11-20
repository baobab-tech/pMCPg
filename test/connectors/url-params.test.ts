// URL parameters (e.g. ?apiKey=) are resolved from the vault per request and never stored in the server URL.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";
import { createRemoteConnector } from "../../src/connectors/remote.ts";
import { nullSink } from "../../src/store/events.ts";
import { MemoryVault } from "../api/fake-handle.ts";

let server: ReturnType<typeof Bun.serve>;
const seen: string[] = [];

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      seen.push(url.search);
      if (url.searchParams.get("apiKey") !== "K-123") return new Response("bad key", { status: 401 });
      const s = new McpServer({ name: "keyed", version: "1" });
      s.registerTool("ping", { description: "Ping", inputSchema: z.object({}) }, async () => ({
        content: [{ type: "text", text: "pong" }],
      }));
      const t = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await s.connect(t);
      return t.handleRequest(req);
    },
  });
});
afterAll(() => server.stop(true));

test("vault-backed URL parameter is added on each request to the server", async () => {
  const vault = new MemoryVault();
  await vault.set("account/k/param-apikey", "K-123");
  const c = createRemoteConnector(
    "k",
    { server: "k", auth: { type: "none" }, env: {}, urlParams: { apiKey: "vault:account/k/param-apikey" } },
    {
      transport: "http",
      url: `http://127.0.0.1:${server.port}/mcp?project=1`,
      trust: [],
      allowInsecure: true,
    },
    { vault, events: nullSink, gatewayUrl: "http://127.0.0.1:7431", openBrowser: async () => {} },
  );
  const tools = await c.listTools();
  expect(tools.map((t) => t.name)).toEqual(["ping"]);
  expect(seen.every((q) => q.includes("project=1") && q.includes("apiKey=K-123"))).toBe(true);
  await c.close();
});
