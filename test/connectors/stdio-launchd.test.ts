import { describe, expect, test } from "bun:test";
import path from "node:path";
import {
  jobLabel,
  jobPlist,
  LAUNCHD_EXEC_ARG,
  LaunchdTransport,
  launchdAvailable,
  parseSpec,
} from "../../src/connectors/stdio-launchd.ts";
import { isAlive } from "../../src/connectors/stdio-tree.ts";

const fixtures = path.join(import.meta.dir, "..", "fixtures");
const mainTs = path.join(import.meta.dir, "..", "..", "src", "cli", "main.ts");
const selfProgram = [process.execPath, mainTs];
const uid = process.getuid?.() ?? 0;

async function launchctlPrint(label: string): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(["/bin/launchctl", "print", `gui/${uid}/${label}`], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  return { code: await p.exited, out };
}

describe("launchd helpers", () => {
  test("launchdAvailable: macOS only, off with PMCPG_STDIO_LAUNCHD=0", () => {
    expect(launchdAvailable("darwin", {})).toBe(true);
    expect(launchdAvailable("darwin", { PMCPG_STDIO_LAUNCHD: "0" })).toBe(false);
    expect(launchdAvailable("linux", {})).toBe(false);
    expect(launchdAvailable("win32", {})).toBe(false);
  });

  test("jobLabel keeps safe characters and is unique", () => {
    const a = jobLabel("my acct/../x", 42);
    const b = jobLabel("my acct/../x", 42);
    expect(a).toMatch(/^io\.github\.baobab-tech\.pmcpg\.stdio\.42\.my_acct____x\.\d+$/);
    expect(a).not.toBe(b);
  });

  test("jobPlist escapes XML and carries no environment", () => {
    const plist = jobPlist({
      label: "l",
      program: ["/bin/pmcpg", LAUNCHD_EXEC_ARG, "/opt/a&b/<srv>"],
      socketPath: "/tmp/x/s",
      stderrPath: "/tmp/x/e",
    });
    expect(plist).toContain("<string>/opt/a&amp;b/&lt;srv&gt;</string>");
    expect(plist).not.toContain("EnvironmentVariables");
    expect(plist).toContain("<key>inetdCompatibility</key>");
  });

  test("parseSpec rejects malformed input", () => {
    expect(parseSpec({ args: ["a"], env: { A: "1" }, cwd: "/tmp" })).toEqual({
      args: ["a"],
      env: { A: "1" },
      cwd: "/tmp",
    });
    expect(() => parseSpec(null)).toThrow();
    expect(() => parseSpec({ args: [1], env: {} })).toThrow();
    expect(() => parseSpec({ args: [], env: { A: 1 } })).toThrow();
    expect(() => parseSpec({ args: [], env: [] })).toThrow();
    expect(() => parseSpec({ args: [], env: {}, cwd: 3 })).toThrow();
  });

  test("exec step refuses a relative command", async () => {
    const p = Bun.spawn([process.execPath, mainTs, LAUNCHD_EXEC_ARG, "node"], {
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    p.stdin.end();
    expect(await p.exited).toBe(70);
    expect(await new Response(p.stderr).text()).toContain("absolute path");
  });
});

describe.skipIf(!launchdAvailable())("launchd transport (macOS)", () => {
  test("server runs under launchd with only the given env; job and secrets do not linger", async () => {
    const secret = `secret-${crypto.randomUUID()}`;
    const stderr: string[] = [];
    const t = new LaunchdTransport({
      command: process.execPath,
      args: [path.join(fixtures, "stdio-probe-server.ts")],
      env: { PATH: "/usr/bin:/bin", PROBE_TOKEN: secret },
      name: "launchd-test",
      selfProgram,
      onStderr: (c) => stderr.push(c.toString()),
    });
    const messages: unknown[] = [];
    t.onmessage = (m) => messages.push(m);
    await t.start();
    const pid = t.pid as number;
    expect(pid).toBeGreaterThan(1);

    // launchd (pid 1) is the parent: the server is its own responsible process.
    const ps = Bun.spawnSync(["/bin/ps", "-o", "ppid=", "-p", String(pid)]);
    expect(Number(ps.stdout.toString().trim())).toBe(1);

    // The job exists, and launchd's view of it holds no secret.
    const shown = await launchctlPrint(t.label);
    expect(shown.code).toBe(0);
    expect(shown.out).not.toContain(secret);

    await t.send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    const end = Date.now() + 10_000;
    while (messages.length === 0 && Date.now() < end) await Bun.sleep(25);
    expect(messages[0]).toMatchObject({ jsonrpc: "2.0", id: 1 });
    expect(stderr.join("")).toContain(`token=${secret}`);

    let closed = false;
    t.onclose = () => {
      closed = true;
    };
    t.endInput();
    const gone = Date.now() + 5000;
    while (isAlive(pid) && Date.now() < gone) await Bun.sleep(50);
    expect(isAlive(pid)).toBe(false);
    await t.close();
    expect(closed).toBe(true);
    expect((await launchctlPrint(t.label)).code).not.toBe(0);
  });

  test("a command that cannot run maps to unreachable", async () => {
    const t = new LaunchdTransport({
      command: "/nonexistent/pmcpg-test-server",
      args: [],
      env: {},
      name: "launchd-missing",
      selfProgram,
    });
    await expect(t.start()).rejects.toMatchObject({ code: "unreachable" });
    expect((await launchctlPrint(t.label)).code).not.toBe(0);
  });
});
