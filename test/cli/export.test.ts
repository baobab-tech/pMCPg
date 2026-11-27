// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${NAME} is the placeholder syntax other apps read
// `pmcpg export` against a temporary PMCPG_HOME.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../src/cli/main.ts";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

let savedHome: string | undefined;
let dir: string;
beforeAll(() => {
  savedHome = process.env.PMCPG_HOME;
  dir = mkdtempSync(join(tmpdir(), "pmcpg-export-cli-"));
  process.env.PMCPG_HOME = dir;
  writeFileSync(
    join(dir, "config.yaml"),
    [
      "servers:",
      "  notes:",
      "    transport: stdio",
      "    command: uvx",
      "    args: [notes-mcp]",
      "    env: { NOTES_KEY: 'vault:account/notes/env-notes_key' }",
      "  linear:",
      "    transport: http",
      "    url: https://mcp.linear.app/mcp",
      "accounts:",
      "  notes: { server: notes }",
      "  linear: { server: linear, auth: { type: oauth } }",
      "",
    ].join("\n"),
  );
});
afterAll(() => {
  process.env.PMCPG_HOME = savedHome;
});

describe("pmcpg export", () => {
  test("prints the mcpServers file by default, with placeholders and no vault references", async () => {
    const c = capture();
    expect(await run(["export"], c.io)).toBe(0);
    const doc = JSON.parse(c.out.join("\n"));
    expect(doc.mcpServers.notes.env).toEqual({ NOTES_KEY: "${NOTES_KEY}" });
    expect(doc.mcpServers.linear).toEqual({ type: "http", url: "https://mcp.linear.app/mcp" });
    expect(c.out.join("\n")).not.toContain("vault:");
  });

  test("--output writes the file and says what to fill in", async () => {
    const file = join(dir, "codex.toml");
    const c = capture();
    expect(await run(["export", "--format", "codex", "-o", file], c.io)).toBe(0);
    expect(readFileSync(file, "utf8")).toContain('env_vars = ["NOTES_KEY"]');
    expect(c.out.join("\n")).toContain("Wrote 2 servers");
    expect(c.out.join("\n")).toContain("Sign in again: linear");
  });

  test("an unknown format is a usage error", async () => {
    const c = capture();
    expect(await run(["export", "--format", "word"], c.io)).toBe(2);
    expect(c.err.join("\n")).toContain("mcp-json");
  });
});
