// Stdio MCP server that publishes one skill (Skills extension) and one tool. Used by connector tests.
import { McpServer } from "@modelcontextprotocol/server";
import { memorySkillFiles, SkillsExtension } from "@modelcontextprotocol/server/ext/skills";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

const server = new McpServer({ name: "skills-stdio", version: "0.0.1" });
server.registerTool(
  "echo",
  { description: "Echo back the given text", inputSchema: z.object({ text: z.string() }) },
  async ({ text }) => ({ content: [{ type: "text", text }] }),
);
const catalog = await SkillsExtension.load(
  memorySkillFiles({
    "deploy/SKILL.md": "---\nname: deploy\ndescription: Deploy the app\n---\nRun scripts/deploy.sh\n",
    "deploy/scripts/deploy.sh": "#!/bin/sh\necho deploy\n",
  }),
);
catalog.attach(server);
await server.connect(new StdioServerTransport());
