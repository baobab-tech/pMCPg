// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${NAME} is the placeholder syntax other apps read
import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLaunchCode, SESSION_COOKIE } from "../../src/api/auth.ts";
import { createUiApi } from "../../src/api/routes.ts";
import { EXPORT_FORMATS, exportServers } from "../../src/onboarding/export.ts";
import { openDb } from "../../src/store/db.ts";
import { fakeHandle } from "../api/fake-handle.ts";

// Every value a secret could hide in. None may reach an export.
const CANARY = {
  vaultEnv: "CANARY-vault-env-7f3a",
  vaultHeader: "CANARY-vault-header-91bc",
  vaultArg: "CANARY-vault-arg-2d4e",
  vaultParam: "CANARY-vault-param-5a6b",
  oauth: "CANARY-oauth-token-c0de",
  plainEnv: "CANARY-plain-env-8e8e",
  plainServerEnv: "CANARY-plain-server-env-3c3c",
  plainParam: "CANARY-plain-param-4b4b",
  label: "CANARY-label-olivier-at-work",
};
const HOME = "/Users/canary-home";

const RAW = {
  servers: {
    github: {
      transport: "stdio",
      command: "/opt/homebrew/bin/npx",
      args: [
        "-y",
        "@modelcontextprotocol/server-github",
        "--token={{vault:account/github/env/ARG_3_SECRET}}",
      ],
      env: { LOG_LEVEL: CANARY.plainServerEnv, GITHUB_TOKEN: "vault:account/github/env/GITHUB_TOKEN" },
    },
    files: {
      transport: "stdio",
      command: `${HOME}/bin/files-mcp`,
      args: [`${HOME}/Documents`],
      cwd: `${HOME}/work`,
    },
    linear: { transport: "http", url: "https://mcp.linear.app/mcp" },
    search: { transport: "http", url: "https://search.example.com/mcp" },
    gmail: { transport: "sse", url: "https://gmail.example.com/sse" },
  },
  accounts: {
    github: { server: "github", label: CANARY.label, env: { EXTRA: CANARY.plainEnv } },
    files: { server: "files" },
    linear: { server: "linear", auth: { type: "oauth" } },
    search: {
      server: "search",
      auth: {
        type: "header",
        headers: { Authorization: "Bearer {{vault:account/search/header/Authorization}}" },
      },
      urlParams: { apiKey: "vault:account/search/param/apiKey", region: CANARY.plainParam },
    },
    "gmail-work": { server: "gmail", auth: { type: "oauth" } },
    "gmail-home": { server: "gmail", auth: { type: "oauth" } },
  },
};

async function seeded() {
  const handle = fakeHandle(RAW);
  const v = handle.vault;
  await v.set("account/github/env/GITHUB_TOKEN", CANARY.vaultEnv);
  await v.set("account/github/env/ARG_3_SECRET", CANARY.vaultArg);
  await v.set("account/search/header/Authorization", CANARY.vaultHeader);
  await v.set("account/search/param/apiKey", CANARY.vaultParam);
  await v.set("account/linear/oauth/tokens", JSON.stringify({ access_token: CANARY.oauth }));
  await v.set("gateway/client-token/all", "CANARY-client-token");
  return handle;
}

function expectClean(text: string, share: boolean) {
  for (const c of [...Object.values(CANARY), "CANARY-client-token"]) {
    if (c === CANARY.label && !share) continue; // labels are names, not secrets; only sharing drops them
    expect(text).not.toContain(c);
  }
}

describe("export", () => {
  test("no secret value reaches any format, through the function or the API", async () => {
    const handle = await seeded();
    for (const format of EXPORT_FORMATS)
      for (const share of [false, true]) {
        const r = exportServers(handle.config(), format, { share, home: HOME });
        expectClean(JSON.stringify(r), share);
        if (share) expect(r.content).not.toContain(HOME);
        if (format !== "pmcpg") expect(r.content).not.toContain("vault:");
      }

    const db = openDb(join(mkdtempSync(join(tmpdir(), "pmcpg-exp-")), "state.db"));
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
    const get = (path: string, withCookie = true) =>
      app.request(`http://127.0.0.1:7431/api/ui${path}`, {
        headers: { host: "127.0.0.1:7431", ...(withCookie ? { cookie: `${SESSION_COOKIE}=${cookie}` } : {}) },
      });

    expect((await get("/export?format=mcp-json", false)).status).toBe(401);
    expect((await get("/export?format=nope")).status).toBe(400);
    for (const format of EXPORT_FORMATS)
      for (const share of ["0", "1"]) {
        const res = await get(`/export?format=${format}&share=${share}`);
        expect(res.status).toBe(200);
        expectClean(await res.text(), share === "1");
      }
  });

  test("mcp.json keeps commands and URLs, turns values into ${NAME}", async () => {
    const handle = await seeded();
    const r = exportServers(handle.config(), "mcp-json", { home: HOME });
    const doc = JSON.parse(r.content);
    expect(doc.mcpServers.github).toEqual({
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github", "--token=${ARG_3_SECRET}"],
      env: { LOG_LEVEL: "${LOG_LEVEL}", GITHUB_TOKEN: "${GITHUB_TOKEN}", EXTRA: "${EXTRA}" },
    });
    expect(doc.mcpServers.search).toEqual({
      type: "http",
      url: "https://search.example.com/mcp",
      headers: { Authorization: "Bearer ${SEARCH_AUTHORIZATION}" },
    });
    expect(doc.mcpServers.linear).toEqual({ type: "http", url: "https://mcp.linear.app/mcp" });
    // One entry per account when a server has several; one per server when sharing.
    expect(Object.keys(doc.mcpServers)).toContain("gmail-work");
    expect(Object.keys(doc.mcpServers)).toContain("gmail-home");
    const shared = JSON.parse(
      exportServers(handle.config(), "mcp-json", { share: true, home: HOME }).content,
    );
    expect(Object.keys(shared.mcpServers)).toContain("gmail");
    expect(shared.mcpServers.files).toEqual({
      type: "stdio",
      command: "${HOME}/bin/files-mcp",
      args: ["${HOME}/Documents"],
    });
    expect(r.signIn).toEqual(["linear", "gmail-work", "gmail-home"]);
    expect(r.placeholders).toContain("SEARCH_AUTHORIZATION");
  });

  test("per-app shapes", async () => {
    const config = (await seeded()).config();
    const desktop = exportServers(config, "claude-desktop");
    expect(Object.keys(JSON.parse(desktop.content).mcpServers).sort()).toEqual(["files", "github"]);
    expect(desktop.skipped.map((s) => s.name)).toContain("linear");

    const vscode = JSON.parse(exportServers(config, "vscode").content);
    expect(vscode.servers.github.env.GITHUB_TOKEN).toBe("${input:github-token}");
    expect(vscode.inputs).toContainEqual({
      type: "promptString",
      id: "github-token",
      description: "GITHUB_TOKEN",
      password: true,
    });

    const gemini = JSON.parse(exportServers(config, "gemini").content);
    expect(gemini.mcpServers.linear).toEqual({ httpUrl: "https://mcp.linear.app/mcp" });
    expect(gemini.mcpServers["gmail-work"]).toEqual({ url: "https://gmail.example.com/sse" });

    expect(JSON.parse(exportServers(config, "zed").content).context_servers.linear.url).toBe(
      "https://mcp.linear.app/mcp",
    );

    const codex = Bun.TOML.parse(exportServers(config, "codex").content) as {
      mcp_servers: Record<string, Record<string, unknown>>;
    };
    expect(codex.mcp_servers.github?.env_vars).toEqual([
      "LOG_LEVEL",
      "GITHUB_TOKEN",
      "EXTRA",
      "ARG_3_SECRET",
    ]);
    expect(codex.mcp_servers.search?.bearer_token_env_var).toBe("SEARCH_AUTHORIZATION");

    const goose = Bun.YAML.parse(exportServers(config, "goose").content) as {
      extensions: Record<string, Record<string, unknown>>;
    };
    expect(goose.extensions.github?.cmd).toBe("npx");
    expect(goose.extensions.linear?.type).toBe("streamable_http");

    const pm = Bun.YAML.parse(exportServers(config, "pmcpg").content) as {
      servers: Record<string, { env?: Record<string, string> }>;
      accounts: Record<string, { urlParams?: Record<string, string> }>;
    };
    expect(pm.servers.github?.env).toEqual({
      LOG_LEVEL: "",
      GITHUB_TOKEN: "vault:account/github/env/GITHUB_TOKEN",
    });
    expect(pm.accounts.search?.urlParams).toEqual({
      apiKey: "vault:account/search/param/apiKey",
      region: "",
    });
  });
});
