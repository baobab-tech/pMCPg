import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ConnectorDeps } from "../../src/connectors/connector.ts";
import { createStdioConnector, type StdioConnector, type StdioOptions } from "../../src/connectors/stdio.ts";
import { buildEnv, loginShellPath, resolveCommand } from "../../src/connectors/stdio-env.ts";
import { launchdAvailable } from "../../src/connectors/stdio-launchd.ts";
import { isAlive } from "../../src/connectors/stdio-tree.ts";
import { AccountDef, ServerDef } from "../../src/core/config.ts";
import type { AccountState } from "../../src/core/types.ts";
import type { GatewayEvent } from "../../src/store/events.ts";
import type { Vault } from "../../src/vault/vault.ts";

const fixtures = path.join(import.meta.dir, "..", "fixtures");
const echoServer = path.join(fixtures, "echo-server.ts");
const probeServer = path.join(fixtures, "stdio-probe-server.ts");
const mainTs = path.join(import.meta.dir, "..", "..", "src", "cli", "main.ts");

// On macOS the connector tests run twice: plain spawn and launchd job.
const modes: { name: string; opts: StdioOptions }[] = [{ name: "spawn", opts: { launchd: false } }];
if (launchdAvailable()) {
  modes.push({ name: "launchd", opts: { launchd: true, selfProgram: [process.execPath, mainTs] } });
}
let mode: StdioOptions = { launchd: false };

function memoryVault(entries: Record<string, string> = {}): Vault {
  const m = new Map(Object.entries(entries));
  return {
    keySource: "env",
    get: async (k) => m.get(k),
    set: async (k, v) => void m.set(k, v),
    delete: async (k) => m.delete(k),
    list: async (p) => [...m.keys()].filter((k) => k.startsWith(p)),
  };
}

interface Setup {
  conn: StdioConnector;
  events: GatewayEvent[];
  states: AccountState["status"][];
}

const open: StdioConnector[] = [];
afterEach(async () => {
  await Promise.all(open.splice(0).map((c) => c.close()));
});

function setup(
  server: Record<string, unknown>,
  account: Record<string, unknown> = {},
  opts: StdioOptions = {},
  vault: Vault = memoryVault(),
): Setup {
  const events: GatewayEvent[] = [];
  const states: AccountState["status"][] = [];
  const deps: ConnectorDeps = {
    vault,
    events: { emit: (e) => events.push(e) },
    gatewayUrl: "http://127.0.0.1:7431",
    openBrowser: async () => {},
  };
  const conn = createStdioConnector(
    "acct",
    AccountDef.parse({ server: "srv", ...account }),
    ServerDef.parse({ transport: "stdio", ...server }),
    deps,
    { ...mode, ...opts },
  );
  conn.onStateChange((s) => states.push(s.status));
  open.push(conn);
  return { conn, events, states };
}

const bun = (script: string, extra: Record<string, unknown> = {}) => ({
  command: process.execPath,
  args: [script],
  ...extra,
});

const textOf = (r: { content: { type: string; text?: unknown }[] }) => String(r.content[0]?.text);

async function waitFor(cond: () => boolean, ms = 5000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (cond()) return true;
    await Bun.sleep(50);
  }
  return cond();
}

describe.each(modes)("stdio connector ($name)", ({ name, opts }) => {
  beforeEach(() => {
    mode = opts;
  });

  test("starts lazily, lists and calls tools", async () => {
    const { conn, events, states } = setup(bun(echoServer));
    expect(conn.state().status).toBe("stopped");
    const tools = await conn.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["echo", "send_email"]);
    expect(tools[0]?.inputSchema.type).toBe("object");
    const r = await conn.callTool("echo", { text: "hi" });
    expect(textOf(r)).toBe("echo: hi");
    expect(states).toEqual(["starting", "connected"]);
    expect(events.filter((e) => e.type === "server-spawned")).toHaveLength(1);
    expect(await conn.resolvedCommand()).toBe(process.execPath);
  });

  test("stops when idle and restarts on next call", async () => {
    const { conn, events } = setup(bun(echoServer), {}, { idleMs: 300 });
    await conn.listTools();
    const firstPid = conn.pid();
    expect(await waitFor(() => conn.state().status === "stopped")).toBe(true);
    expect(firstPid && (await waitFor(() => !isAlive(firstPid)))).toBe(true);
    expect(events.some((e) => e.type === "server-exited")).toBe(true);
    const r = await conn.callTool("echo", { text: "again" });
    expect(textOf(r)).toBe("echo: again");
    expect(conn.pid()).not.toBe(firstPid);
    expect(events.filter((e) => e.type === "server-spawned")).toHaveLength(2);
  });

  test("close kills the whole process tree", async () => {
    const { conn } = setup(bun(probeServer));
    const grandchild = Number(textOf(await conn.callTool("spawn_grandchild", {})));
    const pid = conn.pid() as number;
    expect(isAlive(grandchild)).toBe(true);
    await conn.close();
    expect(await waitFor(() => !isAlive(grandchild))).toBe(true);
    expect(await waitFor(() => !isAlive(pid))).toBe(true);
    expect(conn.state().status).toBe("stopped");
  });

  test("gateway env does not reach the child; server and account env do", async () => {
    process.env.PMCPG_TEST_GATEWAY_SECRET = "gateway-secret-value";
    try {
      const vault = memoryVault({ "account/acct/token": "vault-secret-value" });
      const { conn } = setup(
        bun(probeServer, { env: { PLAIN_VAR: "plain", PROBE_TOKEN: "server-level" } }),
        { env: { PROBE_TOKEN: "vault:account/acct/token" } },
        {},
        vault,
      );
      const get = async (name: string) => textOf(await conn.callTool("get_env", { name }));
      expect(await get("PMCPG_TEST_GATEWAY_SECRET")).toBe("<unset>");
      expect(await get("PLAIN_VAR")).toBe("plain");
      expect(await get("PROBE_TOKEN")).toBe("vault-secret-value");
      const keys = JSON.parse(textOf(await conn.callTool("env_keys", {}))) as string[];
      expect(keys).not.toContain("PMCPG_TEST_GATEWAY_SECRET");
      expect(keys).toContain("PATH");
      // The fixture prints its token to stderr at start; the tail must redact it.
      expect(await waitFor(() => conn.stderrTail().some((l) => l.includes("probe starting")))).toBe(true);
      expect(conn.stderrTail().join("\n")).not.toContain("vault-secret-value");
      expect(conn.stderrTail().join("\n")).toContain("token=[redacted]");
    } finally {
      delete process.env.PMCPG_TEST_GATEWAY_SECRET;
    }
  });

  test("tools/list_changed reaches onToolsChanged", async () => {
    const { conn } = setup(bun(probeServer));
    let changed = 0;
    conn.onToolsChanged(() => changed++);
    await conn.callTool("add_tool", {});
    expect(await waitFor(() => changed > 0)).toBe(true);
    expect((await conn.listTools()).map((t) => t.name)).toContain("extra_1");
  });

  test("unexpected exit sets error state and the next call restarts", async () => {
    const { conn, events } = setup(bun(probeServer));
    await conn.callTool("crash", {});
    expect(await waitFor(() => conn.state().status === "error")).toBe(true);
    const exited = events.find((e) => e.type === "server-exited");
    // A launchd job is not the gateway's child, so its exit code is not known.
    expect(exited?.type === "server-exited" && exited.code).toBe(name === "launchd" ? null : 3);
    expect(textOf(await conn.callTool("get_env", { name: "NOPE" }))).toBe("<unset>");
    expect(conn.state().status).toBe("connected");
  });

  test("missing command maps to unreachable", async () => {
    const { conn } = setup({ command: "pmcpg-no-such-command-xyz" });
    await expect(conn.listTools()).rejects.toMatchObject({ code: "unreachable" });
    expect(conn.state().status).toBe("unreachable");
    expect(await conn.resolvedCommand()).toBeUndefined();
  });

  test("server that never answers maps to timeout and is killed", async () => {
    const { conn, events } = setup(
      { command: process.execPath, args: ["-e", "setInterval(() => {}, 1000)"] },
      {},
      { firstStartTimeoutMs: 500 },
    );
    await expect(conn.listTools()).rejects.toMatchObject({ code: "timeout" });
    expect(conn.state().status).toBe("unreachable");
    expect(events.some((e) => e.type === "server-spawned")).toBe(false);
  });

  test("protocol errors map to downstream-error", async () => {
    const { conn } = setup(bun(echoServer));
    const err = await conn.callTool("no_such_tool", {}).then(
      (r) => r,
      (e) => e,
    );
    // Servers may report unknown tools as an error result or a protocol error.
    if (err instanceof Error) expect(err).toMatchObject({ code: "downstream-error" });
    else expect(err.isError).toBe(true);
  });
});

describe("stdio environment", () => {
  test("resolveCommand finds .cmd shims through PATHEXT", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "pmcpg-"));
    try {
      writeFileSync(path.join(dir, "npx.cmd"), "@echo off\n");
      const hit = resolveCommand("npx", {
        PATH: `C:\\nowhere;${dir}`,
        PATHEXT: ".EXE;.CMD",
        platform: "win32",
      });
      expect(hit?.toLowerCase()).toBe(path.join(dir, "npx.cmd").toLowerCase());
      expect(resolveCommand("npx", { PATH: dir, PATHEXT: ".EXE", platform: "win32" })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("resolveCommand on Unix requires the executable bit", () => {
    if (process.platform === "win32") return;
    const dir = mkdtempSync(path.join(tmpdir(), "pmcpg-"));
    try {
      writeFileSync(path.join(dir, "tool"), "#!/bin/sh\n", { mode: 0o644 });
      expect(resolveCommand("tool", { PATH: dir, platform: "linux" })).toBeUndefined();
      writeFileSync(path.join(dir, "tool2"), "#!/bin/sh\n", { mode: 0o755 });
      expect(resolveCommand("tool2", { PATH: dir, platform: "linux" })).toBe(path.join(dir, "tool2"));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("buildEnv layers server then account env and lists secrets", async () => {
    const vault = memoryVault({ "shared/key": "abc123" });
    const { env, secrets } = await buildEnv(
      { A: "server", B: "server" },
      { B: "account", C: "Bearer {{vault:shared/key}}" },
      vault,
      "/bin",
    );
    expect(env.A).toBe("server");
    expect(env.B).toBe("account");
    expect(env.C).toBe("Bearer abc123");
    expect(env.PATH).toBe("/bin");
    expect(secrets).toEqual(["abc123"]);
  });

  test("login shell PATH is read on Unix", async () => {
    const p = await loginShellPath();
    if (process.platform === "win32" || !process.env.SHELL) expect(p).toBeUndefined();
    else expect(p === undefined || p.includes("/")).toBe(true);
  });
});
