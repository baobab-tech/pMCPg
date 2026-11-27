import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillsClient } from "@modelcontextprotocol/client/ext/skills";
import { Config } from "../../src/core/config.ts";
import { INSTRUCTIONS_MAX_CHARS, serverInstructions } from "../../src/frontdoor/server.ts";
import { SkillLibrary } from "../../src/skills/library.ts";
import { ServerSkillStore } from "../../src/skills/server-skills.ts";
import { ORIGIN_META, SkillService } from "../../src/skills/service.ts";
import type { ServedSkill } from "../../src/skills/skills.ts";
import { openDb } from "../../src/store/db.ts";
import type { GatewayEvent } from "../../src/store/events.ts";
import { SkillServerConnector, skillMd } from "../fixtures/skills.ts";
import { FakeConnector, type Harness, startFrontDoor, text } from "./helpers.ts";

const enc = (s: string) => new TextEncoder().encode(s);

let dir: string;
let h: Harness | undefined;
let gh: SkillServerConnector;
let service: SkillService;
let config: Config;
const events: GatewayEvent[] = [];

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "pmcpg-fd-skills-"));
  events.length = 0;
  config = Config.parse({
    servers: {
      gh: { transport: "http", url: "https://gh.example/mcp" },
      mail: { transport: "http", url: "https://m.example/mcp" },
    },
    accounts: { gh: { server: "gh", skills: "text" }, mail: { server: "mail" } },
    profiles: { work: { accounts: ["mail"], skills: ["notes"] } },
  });
  gh = new SkillServerConnector("gh", {
    "pr-review/SKILL.md": skillMd(
      "pr-review",
      "Review a pull request before merging",
      "# Review\nUse template.md\n",
    ),
    "pr-review/template.md": "## Summary\n",
    "pr-review/scripts/check.py": "print('ok')\n",
  });
  const library = new SkillLibrary(dir);
  await library.save("notes", [
    { path: "SKILL.md", content: enc(skillMd("notes", "Write meeting notes in the team format")) },
    { path: "templates/minutes.md", content: enc("## Minutes\n") },
  ]);
  const store = new ServerSkillStore(openDb(":memory:"));
  service = new SkillService({
    library,
    store,
    config: () => config,
    getConnector: (id) => (id === "gh" ? gh : undefined),
    events: { emit: (e) => events.push(e) },
    dropFromProfiles: async () => {},
  });
  await service.sync("gh");
});
afterEach(async () => {
  await h?.stop();
  h = undefined;
  await gh.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("profiles", () => {
  test("all holds every library skill and the skills of its accounts; others hold what they list", () => {
    expect(service.list("all").map((s) => s.id)).toEqual(["gh/pr-review", "notes"]);
    expect(service.list("work").map((s) => s.id)).toEqual(["notes"]);
    expect(
      service
        .list("all")
        .find((s) => s.id === "gh/pr-review")
        ?.files.map((f) => f.path),
    ).toEqual(["SKILL.md", "template.md"]);
  });

  test("turning an account's skills off forgets them", async () => {
    config.accounts.gh = { server: "gh", auth: { type: "none" }, env: {}, skills: "off" };
    await service.sync("gh");
    expect(service.list("all").map((s) => s.id)).toEqual(["notes"]);
  });
});

describe("native path (Skills extension)", () => {
  test("lists and serves verified files, with origin in _meta", async () => {
    h = await startFrontDoor([new FakeConnector("mail", [])], { skills: service });
    const client = await h.connect("all", undefined, "auto");
    const skills = new SkillsClient(client);
    expect(skills.supported).toBe(true);
    const { skills: entries } = await skills.list();
    expect(entries.map((e) => e.uri)).toEqual([
      "skill://accounts/gh/pr-review/SKILL.md",
      "skill://library/notes/SKILL.md",
    ]);
    expect(entries.map((e) => e._meta?.[ORIGIN_META])).toEqual(["account:gh", "library"]);
    const notes = entries[1];
    if (!notes) throw new Error("no library skill listed");
    const md = await skills.read(notes);
    expect(md.verified).toBe(true);
    expect(md.body).toBe("# Steps\n");
    expect((await skills.read(notes, "templates/minutes.md")).text).toBe("## Minutes\n");
    expect(events.filter((e) => e.type === "skill-read" && e.via === "mcp").length).toBe(2);
  });

  test("a profile only lists its own skills", async () => {
    h = await startFrontDoor([new FakeConnector("mail", [])], { skills: service });
    const { skills } = await new SkillsClient(await h.connect("work", undefined, "auto")).list();
    expect(skills.map((e) => e.frontmatter.name)).toEqual(["notes"]);
  });

  test("a profile without skills does not declare the extension", async () => {
    if (config.profiles.work) config.profiles.work.skills = [];
    await service.rebuild();
    h = await startFrontDoor([new FakeConnector("mail", [])], { skills: service });
    const client = await h.connect("work", undefined, "auto");
    expect(client.getServerCapabilities()?.extensions).toBeUndefined();
  });
});

describe("tool path", () => {
  test("search_tools returns matching skills after the tools", async () => {
    h = await startFrontDoor([new FakeConnector("mail", [])], { skills: service });
    const c = await h.connect("all");
    const hits = JSON.parse(
      text(await c.callTool({ name: "search_tools", arguments: { query: "review pull request" } })),
    );
    const skill = hits.find((x: { kind?: string }) => x.kind === "skill");
    expect(skill.name).toBe("skill:gh/pr-review");
    expect(skill.description).toContain("not written by the user");
  });

  test("the search_tools description lists skills", async () => {
    h = await startFrontDoor([new FakeConnector("mail", [])], { skills: service, listTools: () => [] });
    const c = await h.connect("work");
    const { tools } = await c.listTools();
    const desc = tools.find((t) => t.name === "search_tools")?.description ?? "";
    expect(desc).toContain("Skills available (1)");
    expect(desc).toContain("- skill:notes: Write meeting notes in the team format");
    expect(c.getInstructions()).toContain("Skills (1), read with call_tool: skill:notes");
  });

  test("call_tool reads SKILL.md with an origin header, and one file with arguments.file", async () => {
    h = await startFrontDoor([new FakeConnector("mail", [])], { skills: service });
    const c = await h.connect("all");
    const md = text(await c.callTool({ name: "call_tool", arguments: { name: "skill:gh/pr-review" } }));
    expect(md).toContain('published by the MCP server of account "gh"');
    expect(md).toContain("untrusted");
    expect(md).toContain("- template.md (11 bytes)");
    expect(md).not.toContain("check.py");
    expect(md).toContain("# Review");
    const own = text(await c.callTool({ name: "call_tool", arguments: { name: "skill:notes" } }));
    expect(own).toStartWith(`Skill "notes" from the user's pMCPg skill library.`);
    const file = text(
      await c.callTool({
        name: "call_tool",
        arguments: { name: "skill:notes", arguments: { file: "templates/minutes.md" } },
      }),
    );
    expect(file).toContain("## Minutes");
    expect(
      events
        .filter((e) => e.type === "skill-read" && e.via === "tool")
        .map((e) => (e as { file: string }).file),
    ).toEqual(["SKILL.md", "SKILL.md", "templates/minutes.md"]);
  });

  test("unknown skills, files and other profiles' skills are refused", async () => {
    h = await startFrontDoor([new FakeConnector("mail", [])], { skills: service });
    const c = await h.connect("work");
    for (const args of [
      { name: "skill:gh/pr-review" },
      { name: "skill:nope" },
      { name: "skill:notes", arguments: { file: "../../config.yaml" } },
      { name: "skill:notes", arguments: { file: 3 } },
    ]) {
      const r = await c.callTool({ name: "call_tool", arguments: args });
      expect(r.isError).toBe(true);
    }
  });
});

describe("serverInstructions", () => {
  test("keeps the skills line within the cap", () => {
    const many: ServedSkill[] = Array.from({ length: 80 }, (_, i) => ({
      id: `skill-number-${i}`,
      name: `skill-number-${i}`,
      description: "d",
      origin: { kind: "library" },
      files: [],
    }));
    const tools = Array.from({ length: 300 }, (_, i) => ({
      qualifiedName: `acct${i % 40}__tool_${i}`,
      accountId: `acct${i % 40}`,
      serverId: "s",
      toolName: `tool_${i}`,
      description: "",
      inputSchema: {},
      hash: "h",
      trust: [],
    }));
    const s = serverInstructions(tools, many);
    expect(s.length).toBeLessThanOrEqual(INSTRUCTIONS_MAX_CHARS);
    expect(s).toContain("Skills (80)");
  });
});
