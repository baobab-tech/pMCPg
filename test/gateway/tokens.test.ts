// VLT-3: rotating a client or admin token on a running gateway. The old token fails at once,
// running stdio bridges pick up the new one, and the event names the target only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/server";
import { runBridge } from "../../src/frontdoor/bridge.ts";
import { type Gateway, startGateway } from "../../src/gateway/runtime.ts";
import { rotateToken } from "../../src/gateway/tokens.ts";
import { vaultKeys } from "../../src/vault/vault.ts";

const echo = join(import.meta.dir, "..", "fixtures", "echo-server.ts");
const port = 20000 + Math.floor(Math.random() * 20000);
let gw: Gateway;

beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), "pmcpg-rotate-"));
  writeFileSync(
    join(home, "config.yaml"),
    `gateway: { port: ${port} }
servers:
  echo: { transport: stdio, command: ${JSON.stringify(process.execPath)}, args: [${JSON.stringify(echo)}] }
accounts:
  echo: { server: echo }
profiles:
  work: { accounts: [echo], policy: { preset: open } }
`,
  );
  gw = await startGateway({ home, openBrowser: async () => {} });
});

afterAll(async () => {
  await gw?.close();
});

async function httpClient(token: string): Promise<Client> {
  const c = new Client({ name: "rotate-test", version: "0" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/p/work/mcp`), {
      requestInit: { headers: { authorization: `Bearer ${token}` } },
    }),
  );
  return c;
}

/** Minimal stdio peer for the bridge: newline-delimited JSON-RPC over two streams. */
function stdioPeer() {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  let buf = "";
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  stdout.on("data", (d: Buffer) => {
    buf += d.toString();
    for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
      const m = JSON.parse(buf.slice(0, i)) as { id?: number };
      buf = buf.slice(i + 1);
      if (typeof m.id === "number") waiting.get(m.id)?.(m);
    }
  });
  let next = 1;
  return {
    stdin,
    stdout,
    request(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
      const id = next++;
      const p = new Promise<Record<string, unknown>>((r) => waiting.set(id, r));
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return p;
    },
    notify(method: string) {
      stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method })}\n`);
    },
  };
}

describe("token rotation (VLT-3)", () => {
  test("client token: old one fails at once, also for a connected client; new one works", async () => {
    const old = (await gw.vault.get(vaultKeys.clientToken("work"))) as string;
    const connected = await httpClient(old);
    expect((await connected.listTools()).tools.length).toBeGreaterThan(0);

    const events: unknown[] = [];
    const r = await rotateToken(gw.vault, { profile: "work" }, { emit: (e) => events.push(e) }, "cli");
    expect(r.old).toBe(old);
    expect(r.token).not.toBe(old);

    await expect(connected.listTools()).rejects.toThrow();
    await expect(httpClient(old)).rejects.toThrow();
    const fresh = await httpClient(r.token);
    expect((await fresh.listTools()).tools.length).toBeGreaterThan(0);
    await fresh.close();
    await connected.close().catch(() => {});

    expect(events).toEqual([{ type: "token-rotated", token: "client", profileId: "work", via: "cli" }]);
    expect(JSON.stringify(events)).not.toContain(r.token);
    expect(JSON.stringify(events)).not.toContain(old);
  });

  test("a running stdio bridge reads the new token on its next request", async () => {
    const peer = stdioPeer();
    const bridge = await runBridge({
      profile: "work",
      port,
      getToken: async (id) => (await gw.vault.get(vaultKeys.clientToken(id))) ?? "",
      stdin: peer.stdin,
      stdout: peer.stdout,
    });
    try {
      const init = await peer.request("initialize", {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "peer", version: "0" },
      });
      expect(init.result).toBeDefined();
      peer.notify("notifications/initialized");
      expect((await peer.request("tools/list")).result).toBeDefined();

      await rotateToken(gw.vault, { profile: "work" }, undefined, "cli");
      const after = await peer.request("tools/list");
      expect(after.error).toBeUndefined();
      expect((after.result as { tools: unknown[] }).tools.length).toBeGreaterThan(0);
    } finally {
      await bridge.close();
    }
  });

  test("admin token: the local API refuses the old one at once", async () => {
    const status = (t: string) =>
      fetch(`http://127.0.0.1:${port}/api/status`, { headers: { authorization: `Bearer ${t}` } });
    const old = (await gw.vault.get(vaultKeys.adminToken())) as string;
    expect((await status(old)).status).toBe(200);
    const r = await rotateToken(gw.vault, { admin: true }, undefined, "cli");
    expect((await status(old)).status).toBe(401);
    expect((await status(r.token)).status).toBe(200);
  });

  test("rotation is recorded in the activity log without the token", async () => {
    await rotateToken(gw.vault, { admin: true }, gw.handle.activity, "ui");
    await new Promise((r) => setTimeout(r, 50));
    const items = (await gw.handle.activity?.query({ type: "token-rotated" })) ?? [];
    expect(items.map((i) => i.event)).toContainEqual({ type: "token-rotated", token: "admin", via: "ui" });
  });
});
