import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { commands } from "../../src/cli/commands.ts";
import { run } from "../../src/cli/main.ts";
import { VERSION } from "../../src/cli/version.ts";

async function cli(...argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await run(argv, { out: (l) => out.push(l), err: (l) => err.push(l) });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

describe("cli", () => {
  test("version", async () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
    for (const args of [["version"], ["--version"], ["-v"]]) {
      const r = await cli(...args);
      expect(r.code).toBe(0);
      expect(r.out).toBe(VERSION);
    }
  });

  test("top-level help lists every command", async () => {
    const r = await cli("--help");
    expect(r.code).toBe(0);
    for (const c of commands) expect(r.out).toContain(`pmcpg ${c.path.join(" ")}`);
  });

  test("no arguments prints help and exits 2", async () => {
    const r = await cli();
    expect(r.code).toBe(2);
    expect(r.out).toContain("Usage: pmcpg <command>");
  });

  test("every command has --help", async () => {
    for (const c of commands) {
      const r = await cli(...c.path, "--help");
      expect(r.code).toBe(0);
      expect(r.out).toContain(`Usage: pmcpg ${c.path.join(" ")}`);
      expect(r.out).toContain(c.summary);
    }
  });

  test("help <command> matches <command> --help", async () => {
    expect((await cli("help", "server", "add")).out).toBe((await cli("server", "add", "--help")).out);
  });

  test("group without subcommand prints group help and exits 2", async () => {
    const r = await cli("service");
    expect(r.code).toBe(2);
    expect(r.err).toContain("pmcpg service install");
    expect(r.err).not.toContain("pmcpg server add");
    expect((await cli("service", "--help")).code).toBe(0);
  });

  test("unknown commands and options exit 2", async () => {
    expect((await cli("frobnicate")).code).toBe(2);
    expect((await cli("service", "frobnicate")).err).toContain("Unknown command: pmcpg service frobnicate");
    const r = await cli("server", "add", "x", "--bogus");
    expect(r.code).toBe(2);
    expect(r.err).toContain("Usage: pmcpg server add");
  });

  test("argument count is checked", async () => {
    expect((await cli("connect")).err).toContain("Wrong number of arguments");
    expect((await cli("connect", "a", "b")).code).toBe(2);
    expect((await cli("server", "list", "extra")).code).toBe(2);
  });

  test("stubs say not wired yet and exit 2", async () => {
    for (const argv of [["server", "import", "claude-desktop"]]) {
      const r = await cli(...argv);
      expect(r.code).toBe(2);
      expect(r.err).toContain("not wired yet");
    }
  });

  test("entry point sets the exit code", () => {
    const main = join(import.meta.dir, "..", "..", "src", "cli", "main.ts");
    const ok = Bun.spawnSync([process.execPath, main, "version"]);
    expect(ok.exitCode).toBe(0);
    expect(ok.stdout.toString().trim()).toBe(VERSION);
    const stub = Bun.spawnSync([process.execPath, main, "server", "import", "x"]);
    expect(stub.exitCode).toBe(2);
    expect(stub.stderr.toString()).toContain("not wired yet");
  });
});
