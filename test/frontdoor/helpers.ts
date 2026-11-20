// Test helpers: fake connectors, a profile set, and a front door served on a random port.
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import type { Connector, DownstreamTool } from "../../src/connectors/connector.ts";
import { ProfileDef } from "../../src/core/config.ts";
import {
  type AccountState,
  GatewayError,
  qualify,
  type ToolRef,
  type ToolResult,
} from "../../src/core/types.ts";
import { createFrontDoor, type FrontDoorDeps } from "../../src/frontdoor/server.ts";
import { MiniSearchToolIndex } from "../../src/search/minisearch-index.ts";
import type { GatewayEvent } from "../../src/store/events.ts";

export function toolRef(accountId: string, t: DownstreamTool): ToolRef {
  return {
    qualifiedName: qualify(accountId, t.name),
    accountId,
    serverId: accountId,
    toolName: t.name,
    description: t.description ?? "",
    inputSchema: t.inputSchema,
    hash: `h-${t.name}`,
    trust: [],
  };
}

export class FakeConnector implements Connector {
  calls: { name: string; args: Record<string, unknown> }[] = [];
  constructor(
    readonly accountId: string,
    private tools: DownstreamTool[],
    private reply: (name: string, args: Record<string, unknown>) => Promise<ToolResult> | ToolResult = (
      name,
    ) => ({ content: [{ type: "text", text: `${this.accountId}:${name}` }] }),
  ) {}
  state(): AccountState {
    return { status: "connected" };
  }
  async listTools() {
    return this.tools;
  }
  async callTool(name: string, args: Record<string, unknown>) {
    this.calls.push({ name, args });
    return this.reply(name, args);
  }
  onToolsChanged() {
    return () => {};
  }
  onStateChange() {
    return () => {};
  }
  async close() {}
}

/** Minimal stdio connector over the SDK client, for tests against test/fixtures/echo-server.ts. */
export class StdioTestConnector implements Connector {
  private client = new Client({ name: "pmcpg-test", version: "0" });
  private ready: Promise<void>;
  constructor(
    readonly accountId: string,
    script: string,
  ) {
    this.ready = this.client.connect(
      new StdioClientTransport({ command: process.execPath, args: [script], env: {} }),
    );
  }
  state(): AccountState {
    return { status: "connected" };
  }
  async listTools() {
    await this.ready;
    return (await this.client.listTools()).tools as DownstreamTool[];
  }
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal) {
    await this.ready;
    try {
      return (await this.client.callTool({ name, arguments: args }, { signal })) as ToolResult;
    } catch {
      throw new GatewayError("downstream-error", "echo server failed");
    }
  }
  onToolsChanged() {
    return () => {};
  }
  onStateChange() {
    return () => {};
  }
  async close() {
    await this.client.close();
  }
}

export const TOKENS: Record<string, string> = { all: "tok-all", work: "tok-work" };

export const PROFILES: Record<string, ProfileDef> = {
  all: ProfileDef.parse({}),
  work: ProfileDef.parse({ accounts: ["mail"], deny: ["mail__purge_*"] }),
};

export interface Harness {
  url: (profile?: string) => URL;
  events: GatewayEvent[];
  connect: (profile?: string, token?: string, mode?: "legacy" | "auto") => Promise<Client>;
  index: MiniSearchToolIndex;
  stop: () => Promise<void>;
  app: ReturnType<typeof createFrontDoor>["app"];
}

export async function startFrontDoor(
  connectors: Connector[],
  overrides: Partial<FrontDoorDeps> = {},
): Promise<Harness> {
  const index = new MiniSearchToolIndex();
  const all: ToolRef[] = [];
  for (const c of connectors) for (const t of await c.listTools()) all.push(toolRef(c.accountId, t));
  for (const [id, p] of Object.entries(PROFILES)) {
    index.setTools(
      id,
      all.filter((t) => id === "all" || p.accounts.includes(t.accountId)),
    );
  }
  const events: GatewayEvent[] = [];
  const fd = createFrontDoor({
    index,
    getProfile: (id) => PROFILES[id],
    getClientToken: async (id) => TOKENS[id],
    getConnector: (id) => connectors.find((c) => c.accountId === id),
    steps: [],
    events: { emit: (e) => events.push(e) },
    ...overrides,
  });
  const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: fd.app.fetch });
  const url = (profile?: string) =>
    new URL(profile ? `http://127.0.0.1:${srv.port}/p/${profile}/mcp` : `http://127.0.0.1:${srv.port}/mcp`);
  const clients: Client[] = [];
  return {
    url,
    events,
    index,
    app: fd.app,
    async connect(profile, token, mode = "legacy") {
      const c = new Client({ name: "test-client", version: "0" }, { versionNegotiation: { mode } });
      await c.connect(
        new StreamableHTTPClientTransport(url(profile), {
          requestInit: { headers: { Authorization: `Bearer ${token ?? TOKENS[profile ?? "all"]}` } },
        }),
      );
      clients.push(c);
      return c;
    },
    async stop() {
      for (const c of clients) await c.close();
      await fd.close();
      srv.stop(true);
    },
  };
}

export function text(r: { content?: unknown }): string {
  const c = (r.content as { type: string; text?: string }[] | undefined)?.[0];
  return c?.text ?? "";
}
