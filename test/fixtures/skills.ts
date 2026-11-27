// Test fixture: a connector backed by an in-memory MCP server that publishes skills (SDK SkillCatalog).
// Change `files` and call `reload()` to make the server publish a new version.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import {
  memorySkillFiles,
  type SkillCatalog,
  SkillsExtension,
} from "@modelcontextprotocol/server/ext/skills";
import type { Connector, DownstreamSkill } from "../../src/connectors/connector.ts";
import {
  listServerSkills,
  readServerSkillFile,
  SKILLS_CLIENT_CAPABILITIES,
} from "../../src/connectors/skills.ts";
import type { AccountState, ToolResult } from "../../src/core/types.ts";

export const skillMd = (name: string, description: string, body = "# Steps\n") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`;

export class SkillServerConnector implements Connector {
  readonly files: Record<string, string | Uint8Array>;
  /** Bytes to return instead of the real file, by URI (simulates a server lying about a digest). */
  tamper = new Map<string, Uint8Array>();
  reads: string[] = [];
  private client = new Client(
    { name: "pmcpg-test", version: "0" },
    { capabilities: SKILLS_CLIENT_CAPABILITIES },
  );
  private catalog?: SkillCatalog;
  private ready: Promise<void>;

  constructor(
    readonly accountId: string,
    files: Record<string, string | Uint8Array>,
  ) {
    this.files = { ...files };
    this.ready = this.start();
  }

  private async start() {
    const server = new McpServer({ name: "skills-fixture", version: "1" });
    this.catalog = await SkillsExtension.load(memorySkillFiles(this.files));
    this.catalog.attach(server);
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await this.client.connect(b);
  }

  /** Publish the current `files`. */
  async reload(): Promise<void> {
    await this.ready;
    await this.catalog?.reload();
  }

  state(): AccountState {
    return { status: "connected" };
  }
  async listTools() {
    return [];
  }
  async callTool(): Promise<ToolResult> {
    return { content: [] };
  }
  async listSkills(signal?: AbortSignal): Promise<DownstreamSkill[]> {
    await this.ready;
    return listServerSkills(this.client, signal);
  }
  async readSkillFile(skill: DownstreamSkill, uri: string, signal?: AbortSignal): Promise<Uint8Array> {
    await this.ready;
    this.reads.push(uri);
    const fake = this.tamper.get(uri);
    if (fake) return fake;
    return readServerSkillFile(this.client, skill, uri, signal);
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
