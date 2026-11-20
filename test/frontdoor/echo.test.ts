import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { runBridge } from "../../src/frontdoor/bridge.ts";
import { type Harness, StdioTestConnector, startFrontDoor, TOKENS, text } from "./helpers.ts";

const ECHO = join(import.meta.dir, "../fixtures/echo-server.ts");
const RUNNER = join(import.meta.dir, "bridge-runner.ts");

let h: Harness;
let echo: StdioTestConnector;

beforeAll(async () => {
  echo = new StdioTestConnector("echo", ECHO);
  h = await startFrontDoor([echo]);
});
afterAll(async () => {
  await h.stop();
  await echo.close();
});

describe("echo fixture", () => {
  test("search then call through the front door", async () => {
    const c = await h.connect();
    const s = await c.callTool({ name: "search_tools", arguments: { query: "send an email" } });
    expect((JSON.parse(text(s)) as { name: string }[])[0]?.name).toBe("echo__send_email");
    const r = await c.callTool({
      name: "call_tool",
      arguments: { name: "echo__echo", arguments: { text: "hi" } },
    });
    expect(text(r)).toBe("echo: hi");
  });

  test("stdio bridge relays tools/list and tools/call", async () => {
    const port = h.url().port;
    const c = new Client({ name: "bridge-test", version: "0" });
    await c.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [RUNNER],
        env: { PMCPG_TEST_PORT: port, PMCPG_TEST_TOKEN: TOKENS.all ?? "", PMCPG_TEST_PROFILE: "all" },
      }),
    );
    try {
      expect((await c.listTools()).tools.map((t) => t.name).sort()).toEqual(["call_tool", "search_tools"]);
      const r = await c.callTool({
        name: "call_tool",
        arguments: { name: "echo__echo", arguments: { text: "via bridge" } },
      });
      expect(text(r)).toBe("echo: via bridge");
    } finally {
      await c.close();
    }
  });

  test("bridge refuses to start with a wrong token or bad profile", async () => {
    const port = Number(h.url().port);
    await expect(runBridge({ profile: "all", port, getToken: async () => "wrong" })).rejects.toThrow();
    await expect(runBridge({ profile: "../x", port, getToken: async () => "x" })).rejects.toThrow(
      "Invalid profile",
    );
  });
});
