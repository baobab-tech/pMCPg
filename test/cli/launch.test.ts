import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type LaunchDeps, launch, showError } from "../../src/cli/launch.ts";
import type { ServiceEnv } from "../../src/cli/service.ts";

let home: string;
let calls: { cmd: string[]; env?: Record<string, string> }[];
let opened: number;

function service(platform: NodeJS.Platform = "linux"): ServiceEnv {
  return {
    platform,
    env: { SystemRoot: "C:\\Windows" },
    home,
    uid: 501,
    program: ["/opt/pmcpg/bin/pmcpg"],
    run: (cmd, env) => {
      calls.push({ cmd, env });
      return { code: 0, stdout: "", stderr: "" };
    },
    out: () => {},
    sleep: () => {},
  };
}

function deps(upAfter: number, platform?: NodeJS.Platform): LaunchDeps {
  let checks = 0;
  return {
    service: service(platform),
    port: 4848,
    isUp: async () => ++checks > upAfter,
    openUi: async () => {
      opened++;
    },
    sleep: async () => {},
  };
}

const started = () => calls.some((c) => c.cmd.join(" ").includes("enable --now"));
const dialog = () => calls.find((c) => c.cmd[0] === "zenity");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pmcpg-launch-"));
  calls = [];
  opened = 0;
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

test("gateway already up: opens the UI without starting anything", async () => {
  expect(await launch(deps(0))).toBe(0);
  expect(opened).toBe(1);
  expect(calls).toHaveLength(0);
});

test("gateway down: starts the service, waits, then opens the UI", async () => {
  expect(await launch(deps(5))).toBe(0);
  expect(started()).toBe(true);
  expect(opened).toBe(1);
  expect(dialog()).toBeUndefined();
});

test("gateway never answers: shows a dialog and does not open the UI", async () => {
  expect(await launch(deps(Number.POSITIVE_INFINITY))).toBe(1);
  expect(opened).toBe(0);
  expect(dialog()?.cmd.join(" ")).toContain("did not start within 20 seconds");
});

test("a failing start shows its error in a dialog", async () => {
  const d = deps(Number.POSITIVE_INFINITY);
  d.service.run = (cmd, env) => {
    calls.push({ cmd, env });
    return { code: 1, stdout: "", stderr: "no systemd" };
  };
  expect(await launch(d)).toBe(1);
  expect(dialog()?.cmd.join(" ")).toContain("no systemd");
});

test("macOS dialog passes the text as osascript arguments", () => {
  showError(service("darwin"), 'say "hi"');
  const cmd = calls[0]?.cmd ?? [];
  expect(cmd[0]).toBe("/usr/bin/osascript");
  expect(cmd.at(-1)).toBe('say "hi"');
  expect(cmd.join(" ")).not.toContain('say "hi" message');
});

test("Windows dialog passes the text through variables", () => {
  showError(service("win32"), "boom");
  expect(calls[0]?.env).toEqual({ PMCPG_MSG: "boom", PMCPG_TITLE: "pMCPg could not start" });
  expect(calls[0]?.cmd.at(-1)).not.toContain("boom");
});
