// Stdio MCP server for connector tests: env probing, grandchildren, list changes, crashes.
import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

// Written at start so tests can check that vault secrets are redacted from stderr.
console.error(`probe starting token=${process.env.PROBE_TOKEN ?? "none"}`);

const server = new McpServer({ name: "probe", version: "0.0.1" });
const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

server.registerTool(
  "get_env",
  { description: "Value of one environment variable", inputSchema: z.object({ name: z.string() }) },
  async ({ name }) => text(process.env[name] ?? "<unset>"),
);
server.registerTool("env_keys", { description: "Names of all environment variables" }, async () =>
  text(JSON.stringify(Object.keys(process.env).sort())),
);
server.registerTool("spawn_grandchild", { description: "Start a long-running child process" }, async () => {
  const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  return text(String(child.pid));
});
let added = 0;
server.registerTool(
  "add_tool",
  { description: "Register a new tool (sends tools/list_changed)" },
  async () => {
    added++;
    server.registerTool(`extra_${added}`, { description: "Added at runtime" }, async () => text("extra"));
    return text(`extra_${added}`);
  },
);
server.registerTool("crash", { description: "Exit with code 3" }, async () => {
  setTimeout(() => process.exit(3), 10);
  return text("bye");
});

await server.connect(new StdioServerTransport());
