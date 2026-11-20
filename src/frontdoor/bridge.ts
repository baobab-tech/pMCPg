// `pmcpg connect <profile>`: serves MCP on stdio and relays tool requests to the local front door.
import type { Readable, Writable } from "node:stream";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { Server } from "@modelcontextprotocol/server";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import { Slug } from "../core/config.ts";
import { CLIENT_SESSION_HEADER, VERSION } from "./server.ts";

export interface BridgeOptions {
  profile: string;
  port: number;
  /** Reads the profile's client token (from the keychain in production). */
  getToken: (profile: string) => Promise<string>;
  /** Defaults to process.stdin / process.stdout. */
  stdin?: Readable;
  stdout?: Writable;
}

export interface Bridge {
  close(): Promise<void>;
}

export function frontDoorUrl(port: number, profile: string): URL {
  return new URL(`http://127.0.0.1:${port}/p/${profile}/mcp`);
}

/** Connects to the front door, then serves stdio. Rejects if the gateway is not reachable or refuses the token. */
export async function runBridge(opts: BridgeOptions): Promise<Bridge> {
  if (!Slug.safeParse(opts.profile).success) throw new Error(`Invalid profile name: ${opts.profile}`);
  const upstream = new Client(
    { name: "pmcpg-bridge", version: VERSION },
    { versionNegotiation: { mode: "auto" } },
  );
  // One privacy session per bridge process, so two apps on the same profile do not share placeholders or taint.
  // The token is read before every request, so a rotated token reaches running bridges without a restart.
  await upstream.connect(
    new StreamableHTTPClientTransport(frontDoorUrl(opts.port, opts.profile), {
      authProvider: { token: () => opts.getToken(opts.profile) },
      requestInit: { headers: { [CLIENT_SESSION_HEADER]: crypto.randomUUID() } },
    }),
  );

  // Only tools are relayed: the front door exposes nothing else.
  const factory = () => {
    const s = new Server({ name: "pmcpg", version: VERSION }, { capabilities: { tools: {} } });
    s.setRequestHandler("tools/list", (req, ctx) =>
      upstream.listTools(req.params, { signal: ctx.mcpReq.signal }),
    );
    s.setRequestHandler("tools/call", (req, ctx) =>
      upstream.callTool(req.params, { signal: ctx.mcpReq.signal }),
    );
    return s;
  };
  const stdio = serveStdio(factory, { transport: new StdioServerTransport(opts.stdin, opts.stdout) });

  return {
    async close() {
      await stdio.close();
      await upstream.close();
    },
  };
}
