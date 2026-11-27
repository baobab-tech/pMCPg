// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${NAME} is the placeholder syntax other apps read
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLaunchCode, SESSION_COOKIE } from "../../src/api/auth.ts";
import { createUiApi } from "../../src/api/routes.ts";
import { applyImport } from "../../src/onboarding/apply.ts";
import { EXPORT_FORMATS, exportServers } from "../../src/onboarding/export.ts";
import { parseServerFile } from "../../src/onboarding/import-file.ts";
import type { ProbeResult } from "../../src/onboarding/probe.ts";
import { openDb } from "../../src/store/db.ts";
import { fakeHandle } from "../api/fake-handle.ts";

const HOME = "/Users/someone";
const SOURCE = {
  servers: {
    github: {
      transport: "stdio",
      command: "npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-github",
        "--token={{vault:account/github/env/ARG_3_SECRET}}",
      ],
      env: { GITHUB_TOKEN: "vault:account/github/env/GITHUB_TOKEN" },
    },
    files: { transport: "stdio", command: "files-mcp", args: [`${HOME}/Documents`] },
    linear: { transport: "http", url: "https://mcp.linear.app/mcp" },
    search: { transport: "http", url: "https://search.example.com/mcp" },
  },
  accounts: {
    github: { server: "github" },
    files: { server: "files" },
    linear: { server: "linear", auth: { type: "oauth" } },
    search: {
      server: "search",
      auth: {
        type: "header",
        headers: { Authorization: "Bearer {{vault:account/search/header/Authorization}}" },
      },
    },
  },
};

// Offline probe: linear signs in with OAuth, everything else answers with no sign-in.
const probe = async (url: string): Promise<ProbeResult> =>
  url.includes("linear")
    ? {
        ok: true,
        url,
        transport: "http",
        auth: { type: "oauth", issuer: "https://linear.app", registration: "dcr" },
        suggestedId: "linear",
      }
    : { ok: true, url, transport: "http", auth: { type: "none" }, suggestedId: "x" };

function parsed(text: string, name = "file") {
  const r = parseServerFile(text, name, HOME);
  if ("error" in r) throw new Error(r.error);
  return r;
}

describe("import from a file", () => {
  test("every export format comes back with the same commands, URLs and value names", async () => {
    const config = fakeHandle(SOURCE).config();
    for (const format of EXPORT_FORMATS) {
      for (const share of [false, true]) {
        const file = exportServers(config, format, { share, home: HOME });
        const r = parsed(file.content, file.filename);
        const target = fakeHandle({});
        const outcomes = await applyImport(target, r.candidates, { probe });
        expect(outcomes.every((o) => o.status === "added")).toBe(true);
        const got = target.config();
        const stdio = Object.values(got.servers).filter((s) => s.transport === "stdio");
        const remote = Object.values(got.servers).filter((s) => s.transport !== "stdio");
        expect(stdio.map((s) => s.command).sort()).toEqual(["files-mcp", "npx"]);
        // ${HOME} written when sharing comes back as this computer's home.
        expect(stdio.find((s) => s.command === "files-mcp")?.args).toEqual([`${HOME}/Documents`]);
        const gh = stdio.find((s) => s.command === "npx");
        expect(gh?.args[2]).toMatch(/^--token=\{\{vault:account\/[\w-]+\/env-arg_3_secret\}\}$/);
        const ghAccount = Object.values(got.accounts).find((a) => got.servers[a.server] === gh);
        expect(Object.keys(ghAccount?.env ?? {}).sort()).toEqual(["ARG_3_SECRET", "GITHUB_TOKEN"]);

        if (format === "claude-desktop") {
          expect(remote).toEqual([]);
          continue;
        }
        expect(remote.map((s) => s.url).sort()).toEqual([
          "https://mcp.linear.app/mcp",
          "https://search.example.com/mcp",
        ]);
        const auths = Object.values(got.accounts).map((a) => a.auth.type);
        expect(auths).toContain("oauth");
        expect(auths).toContain("header");
      }
    }
  });

  test("a server already here under a full launcher path counts as already added", async () => {
    const target = fakeHandle({
      servers: { gh: { transport: "stdio", command: "/opt/homebrew/bin/npx", args: ["-y", "gh-mcp"] } },
    });
    const r = parsed(JSON.stringify({ mcpServers: { gh: { command: "npx", args: ["-y", "gh-mcp"] } } }));
    const outcomes = await applyImport(target, r.candidates, { probe });
    expect(outcomes.map((o) => o.status)).toEqual(["already-added"]);
  });

  test("values in a hand-written file are never kept", async () => {
    const text = JSON.stringify({
      mcpServers: {
        api: {
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer sk-live-REAL-SECRET-1" },
        },
        tool: { command: "uvx", args: ["tool-mcp"], env: { TOOL_KEY: "REAL-SECRET-2" } },
      },
    });
    const r = parsed(text);
    expect(JSON.stringify(r)).not.toContain("REAL-SECRET");
    const target = fakeHandle({});
    const outcomes = await applyImport(target, r.candidates, { probe });
    expect(JSON.stringify(target.config())).not.toContain("REAL-SECRET");
    expect(outcomes.flatMap((o) => o.missingValues ?? []).sort()).toEqual(["Authorization", "TOOL_KEY"]);
  });

  test("other apps' shapes and bad input", () => {
    const gemini = parsed(JSON.stringify({ mcpServers: { a: { httpUrl: "https://a.example.com/mcp" } } }));
    expect(gemini.candidates[0]?.server).toEqual({ transport: "http", url: "https://a.example.com/mcp" });
    const zed = parsed(
      JSON.stringify({ context_servers: { z: { command: { path: "zed-mcp", args: ["x"] } } } }),
    );
    expect(zed.candidates[0]?.server).toEqual({ transport: "stdio", command: "zed-mcp", args: ["x"] });
    // Built-in Goose extensions are not servers.
    expect(
      parseServerFile("extensions:\n  dev:\n    type: builtin\n    name: developer\n", "f", HOME),
    ).toHaveProperty("error");
    expect(parseServerFile("not: [valid", "f", HOME)).toHaveProperty("error");
    expect(parseServerFile("{}", "f", HOME)).toEqual({ error: "No MCP servers found in this file." });
  });

  test("API: parse, then apply re-parses and adds only the picked servers", async () => {
    const handle = fakeHandle({});
    const db = openDb(join(mkdtempSync(join(tmpdir(), "pmcpg-imf-")), "state.db"));
    const app = createUiApi(handle, {
      db,
      bindHost: "127.0.0.1",
      assets: {},
      log: () => {},
      onboarding: { scanEnv: () => ({ home: HOME, platform: "darwin" }) },
    });
    const launch = await app.request(`http://127.0.0.1:7431/launch?k=${createLaunchCode(db)}`, {
      headers: { host: "127.0.0.1:7431" },
    });
    const cookie =
      launch.headers.get("set-cookie")?.match(new RegExp(`${SESSION_COOKIE}=([^;]*)`))?.[1] ?? "";
    const session = await app.request("http://127.0.0.1:7431/api/ui/session", {
      headers: { host: "127.0.0.1:7431", cookie: `${SESSION_COOKIE}=${cookie}` },
    });
    const { csrf } = (await session.json()) as { csrf: string };
    const post = (path: string, body: unknown) =>
      app.request(`http://127.0.0.1:7431/api/ui${path}`, {
        method: "POST",
        headers: {
          host: "127.0.0.1:7431",
          origin: "http://127.0.0.1:7431",
          cookie: `${SESSION_COOKIE}=${cookie}`,
          "content-type": "application/json",
          "x-csrf-token": csrf,
        },
        body: JSON.stringify(body),
      });

    const text = JSON.stringify({
      mcpServers: {
        tool: { command: "uvx", args: ["tool-mcp"] },
        other: { command: "uvx", args: ["other-mcp"] },
        self: { command: "/usr/local/bin/pmcpg", args: ["connect", "all"] },
      },
    });
    const scan = await post("/import/file", { text, name: "team.json" });
    expect(scan.status).toBe(200);
    // biome-ignore lint/suspicious/noExplicitAny: loose test reads
    const body: any = await scan.json();
    expect(body.format).toBe("mcpServers");
    expect(body.candidates.map((c: { suggestedId: string }) => c.suggestedId).sort()).toEqual([
      "other",
      "tool",
    ]);
    expect(body.candidates[0].foundIn[0].appLabel).toBe("team.json");

    const key = body.candidates.find((c: { suggestedId: string }) => c.suggestedId === "tool").key;
    const applied = await post("/import/file/apply", { text, name: "team.json", keys: [key] });
    expect(applied.status).toBe(200);
    expect(Object.keys(handle.config().servers)).toEqual(["tool"]);

    expect((await post("/import/file", { text: "nope: [", name: "x" })).status).toBe(400);
  });
});
