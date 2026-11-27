import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";
import { createStdioConnector, type StdioConnector } from "../../src/connectors/stdio.ts";
import { AccountDef, ServerDef } from "../../src/core/config.ts";
import { nullSink } from "../../src/store/events.ts";
import type { Vault } from "../../src/vault/vault.ts";

const vault = { get: async () => undefined } as unknown as Vault;
let conn: StdioConnector | undefined;
afterEach(async () => {
  await conn?.close();
  conn = undefined;
});

const start = (script: string) =>
  createStdioConnector(
    "acct",
    AccountDef.parse({ server: "srv" }),
    ServerDef.parse({
      transport: "stdio",
      command: process.execPath,
      args: [join(import.meta.dir, "..", "fixtures", script)],
    }),
    { vault, events: nullSink, gatewayUrl: "http://127.0.0.1:7431", openBrowser: async () => {} },
  );

test("a stdio server's skills are listed and files read with their digests checked", async () => {
  conn = start("skills-stdio-server.ts");
  const skills = (await conn.listSkills?.()) ?? [];
  expect(skills.map((s) => s.uri)).toEqual(["skill://deploy/SKILL.md"]);
  const skill = skills[0];
  if (!skill) throw new Error("no skill listed");
  const script =
    skill.resources !== "dynamic" ? skill.resources.find((r) => r.uri.endsWith("deploy.sh")) : undefined;
  const bytes = await conn.readSkillFile?.(skill, script?.uri ?? "");
  expect(new TextDecoder().decode(bytes)).toContain("echo deploy");
  await expect(conn.readSkillFile?.(skill, "skill://deploy/missing.md")).rejects.toThrow();
});

test("a server without the extension lists no skills", async () => {
  conn = start("echo-server.ts");
  expect(await conn.listSkills?.()).toEqual([]);
});
