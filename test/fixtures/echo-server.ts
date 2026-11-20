// Minimal stdio MCP server used by tests.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "echo", version: "0.0.1" });
server.registerTool(
  "echo",
  { description: "Echo back the given text", inputSchema: z.object({ text: z.string() }) },
  async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
);
server.registerTool(
  "send_email",
  {
    description: "Send an email to a recipient",
    inputSchema: z.object({ to: z.string(), body: z.string() }),
  },
  async ({ to }) => ({ content: [{ type: "text", text: `sent to ${to}` }] }),
);
await server.connect(new StdioServerTransport());
