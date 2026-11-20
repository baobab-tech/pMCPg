import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyConnect, planConnect, rewriteAppTokens } from "../../src/onboarding/clients.ts";

const TOKEN = "tok-SECRET-123";
const input = (extra = {}) => ({
  profile: "briefing",
  gatewayUrl: "http://127.0.0.1:7431",
  token: TOKEN,
  pmcpg: ["/usr/local/bin/pmcpg"],
  ...extra,
});

function homeWithDesktop() {
  const home = mkdtempSync(join(tmpdir(), "pmcpg-connect-"));
  const file = join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      globalShortcut: "Cmd+Space",
      mcpServers: {
        files: { command: "npx", args: ["x"] },
        linear: { command: "npx", args: ["mcp-remote", "https://mcp.linear.app/mcp"] },
      },
    }),
  );
  return { home, file, env: { home, platform: "darwin" as const } };
}

describe("Claude Desktop", () => {
  test("plan shows the stdio bridge entry and removals, without changing the file", () => {
    const { file, env } = homeWithDesktop();
    const before = readFileSync(file, "utf8");
    const plan = planConnect("claude-desktop", input({ remove: ["linear"] }), env);
    expect(plan.entryName).toBe("pmcpg-briefing");
    expect(plan.preview).toContain('"connect"');
    expect(plan.preview).not.toContain('"linear"');
    expect(readFileSync(file, "utf8")).toBe(before);
  });
  test("apply backs up, keeps other settings, replaces imported entries with one gateway entry", async () => {
    const { file, env } = homeWithDesktop();
    const r = await applyConnect(
      "claude-desktop",
      input({ remove: ["linear"] }),
      env,
      new Date("2026-11-07T12:00:00Z"),
    );
    expect(r.backup && existsSync(r.backup)).toBe(true);
    const doc = JSON.parse(readFileSync(file, "utf8"));
    expect(doc.globalShortcut).toBe("Cmd+Space");
    expect(Object.keys(doc.mcpServers).sort()).toEqual(["files", "pmcpg-briefing"]);
    expect(doc.mcpServers["pmcpg-briefing"]).toEqual({
      command: "/usr/local/bin/pmcpg",
      args: ["connect", "briefing"],
    });
    // The stdio bridge reads the token itself: none written to Claude's file.
    expect(readFileSync(file, "utf8")).not.toContain(TOKEN);
  });
  test("a file that is not a JSON object is left alone", () => {
    const { file, env } = homeWithDesktop();
    writeFileSync(file, "[1,2]");
    expect(() => planConnect("claude-desktop", input(), env)).toThrow("not a JSON object");
  });
});

describe("Cursor, VS Code, LM Studio", () => {
  test("LM Studio gets the stdio bridge by default; no token in the file", async () => {
    const home = mkdtempSync(join(tmpdir(), "pmcpg-lms-"));
    const env = { home, platform: "linux" as const };
    const plan = planConnect("lm-studio", input({ profile: "all" }), env);
    expect(plan.entryName).toBe("pmcpg");
    expect(plan.transport).toBe("stdio");
    const r = await applyConnect("lm-studio", input({ profile: "all" }), env);
    expect(r.backup).toBeUndefined();
    const text = readFileSync(join(home, ".lmstudio", "mcp.json"), "utf8");
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text).mcpServers.pmcpg).toEqual({
      command: "/usr/local/bin/pmcpg",
      args: ["connect", "all"],
    });
  });
  test("Cursor gets the stdio bridge", async () => {
    const home = mkdtempSync(join(tmpdir(), "pmcpg-cur-"));
    await applyConnect("cursor", input(), { home, platform: "darwin" });
    const text = readFileSync(join(home, ".cursor", "mcp.json"), "utf8");
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text).mcpServers["pmcpg-briefing"].args).toEqual(["connect", "briefing"]);
  });
  test("VS Code uses the servers key with type stdio", () => {
    const env = { home: mkdtempSync(join(tmpdir(), "pmcpg-vsc-")), platform: "linux" as const };
    const plan = planConnect("vscode", input(), env);
    expect(JSON.parse(plan.preview as string).servers["pmcpg-briefing"]).toEqual({
      type: "stdio",
      command: "/usr/local/bin/pmcpg",
      args: ["connect", "briefing"],
    });
  });
  test("development mode writes bun plus the absolute main.ts", () => {
    const env = { home: mkdtempSync(join(tmpdir(), "pmcpg-dev-")), platform: "linux" as const };
    const plan = planConnect(
      "cursor",
      input({ pmcpg: ["/opt/bun/bin/bun", "/src/pmcpg/src/cli/main.ts"] }),
      env,
    );
    expect(JSON.parse(plan.preview as string).mcpServers["pmcpg-briefing"]).toEqual({
      command: "/opt/bun/bin/bun",
      args: ["/src/pmcpg/src/cli/main.ts", "connect", "briefing"],
    });
  });
  test("a relative pmcpg command is refused", () => {
    const env = { home: mkdtempSync(join(tmpdir(), "pmcpg-rel-")), platform: "linux" as const };
    expect(() => planConnect("cursor", input({ pmcpg: ["pmcpg"] }), env)).toThrow("absolute path");
  });
  test("HTTP fallback writes URL + bearer header; preview masks the token", async () => {
    const home = mkdtempSync(join(tmpdir(), "pmcpg-http-"));
    const env = { home, platform: "linux" as const };
    const plan = planConnect("lm-studio", input({ profile: "all", transport: "http" }), env);
    expect(plan.transport).toBe("http");
    expect(plan.preview).not.toContain(TOKEN);
    expect(plan.preview).toContain("•••");
    await applyConnect("lm-studio", input({ profile: "all", transport: "http" }), env);
    const doc = JSON.parse(readFileSync(join(home, ".lmstudio", "mcp.json"), "utf8"));
    expect(doc.mcpServers.pmcpg).toEqual({
      url: "http://127.0.0.1:7431/p/all/mcp",
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
  });
  test("HTTP fallback is refused for Claude Desktop and Claude Code", () => {
    const { env } = homeWithDesktop();
    expect(() => planConnect("claude-desktop", input({ transport: "http" }), env)).toThrow(
      "stdio bridge only",
    );
    expect(() => planConnect("claude-code", input({ transport: "http" }), env)).toThrow("stdio bridge only");
  });
});

describe("Claude Code", () => {
  test("plan runs the bridge, with no token, and removals after --", () => {
    const plan = planConnect("claude-code", input({ remove: ["linear"] }), {
      home: "/x",
      platform: "darwin",
    });
    expect(plan.transport).toBe("stdio");
    expect(plan.commands?.[0]).toBe(
      "claude mcp add --transport stdio --scope user pmcpg-briefing -- /usr/local/bin/pmcpg connect briefing",
    );
    expect(plan.commands?.[1]).toBe("claude mcp remove --scope user -- linear");
    expect(JSON.stringify(plan)).not.toContain(TOKEN);
  });
  test("apply runs claude by absolute path with the launcher env; no token in argv", async () => {
    const calls: { argv: string[]; env: Record<string, string> }[] = [];
    const r = await applyConnect(
      "claude-code",
      input({ remove: ["linear"] }),
      { home: "/x", platform: "darwin" },
      new Date(),
      async (argv, env) => {
        calls.push({ argv, env });
        return 0;
      },
      async () => ({ claude: "/opt/claude/bin/claude", env: { PATH: "/usr/bin" } }),
    );
    expect(calls.map((c) => c.argv)).toEqual([
      ["/opt/claude/bin/claude", "mcp", "remove", "--scope", "user", "--", "pmcpg-briefing"],
      [
        "/opt/claude/bin/claude",
        "mcp",
        "add",
        "--transport",
        "stdio",
        "--scope",
        "user",
        "pmcpg-briefing",
        "--",
        "/usr/local/bin/pmcpg",
        "connect",
        "briefing",
      ],
      ["/opt/claude/bin/claude", "mcp", "remove", "--scope", "user", "--", "linear"],
    ]);
    expect(calls.every((c) => c.env.PATH === "/usr/bin")).toBe(true);
    expect(JSON.stringify(calls)).not.toContain(TOKEN);
    expect(r.ran?.map((x) => x.code)).toEqual([0, 0]);
  });
  test("names that start with - are refused", () => {
    expect(() =>
      planConnect("claude-code", input({ remove: ["--scope=project"] }), { home: "/x", platform: "darwin" }),
    ).toThrow("Invalid entry name");
  });
});

describe("token rotation rewrite (VLT-3)", () => {
  test("replaces the old token in HTTP entries, keeps everything else, backs up the file", () => {
    const home = mkdtempSync(join(tmpdir(), "pmcpg-rotate-apps-"));
    const vscode = join(home, "Library", "Application Support", "Code", "User", "mcp.json");
    const cursor = join(home, ".cursor", "mcp.json");
    mkdirSync(join(vscode, ".."), { recursive: true });
    mkdirSync(join(cursor, ".."), { recursive: true });
    writeFileSync(
      vscode,
      JSON.stringify({
        other: { keep: TOKEN },
        servers: {
          "pmcpg-briefing": { type: "http", url: "u", headers: { Authorization: `Bearer ${TOKEN}` } },
          bridge: { type: "stdio", command: "/usr/local/bin/pmcpg", args: ["connect", "briefing"] },
        },
      }),
    );
    const cursorBefore = JSON.stringify({ mcpServers: { x: { url: "u", headers: { A: "Bearer other" } } } });
    writeFileSync(cursor, cursorBefore);

    const r = rewriteAppTokens(TOKEN, "tok-NEW-456", { home, platform: "darwin" }, new Date(0));
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ app: "vscode", file: vscode, entries: ["pmcpg-briefing"] });
    expect(r[0]?.backup && existsSync(r[0].backup)).toBe(true);
    const doc = JSON.parse(readFileSync(vscode, "utf8"));
    expect(doc.servers["pmcpg-briefing"].headers.Authorization).toBe("Bearer tok-NEW-456");
    expect(doc.servers.bridge.args).toEqual(["connect", "briefing"]);
    // Only the MCP server section changes.
    expect(doc.other.keep).toBe(TOKEN);
    expect(readFileSync(cursor, "utf8")).toBe(cursorBefore);
  });

  test("no app files, no changes", () => {
    const home = mkdtempSync(join(tmpdir(), "pmcpg-rotate-apps-"));
    expect(rewriteAppTokens(TOKEN, "n", { home, platform: "linux" })).toEqual([]);
  });
});
