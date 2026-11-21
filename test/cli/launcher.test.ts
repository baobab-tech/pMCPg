import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appInfoPlist,
  appPath,
  desktopEntry,
  desktopPath,
  desktopWord,
  installLauncher,
  launchedFromApp,
  SHORTCUT_SCRIPT,
  shortcutPath,
  uninstallLauncher,
} from "../../src/cli/launcher.ts";
import { installService, type RunResult, type ServiceEnv, uninstallService } from "../../src/cli/service.ts";

let home: string;
let calls: { cmd: string[]; env?: Record<string, string> }[];
let lines: string[];

function fakeEnv(
  platform: NodeJS.Platform,
  extra: Partial<ServiceEnv> = {},
  reply: (cmd: string[]) => Partial<RunResult> = () => ({}),
): ServiceEnv {
  return {
    platform,
    env: { SystemRoot: "C:\\Windows", USERDOMAIN: "HOST", USERNAME: "u" },
    home,
    uid: 501,
    program: ["/opt/pmcpg/bin/pmcpg"],
    run: (cmd, env) => {
      calls.push({ cmd, env });
      return { code: 0, stdout: "", stderr: "", ...reply(cmd) };
    },
    out: (l) => lines.push(l),
    sleep: () => {},
    ...extra,
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pmcpg-launcher-"));
  calls = [];
  lines = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("launchedFromApp", () => {
  test("bare launch with the variable", () => {
    expect(launchedFromApp([], { PMCPG_LAUNCHER: "1" })).toBe(true);
    expect(launchedFromApp(["-psn_0_12345"], { PMCPG_LAUNCHER: "1" })).toBe(true);
  });
  test("--launcher alone, from the Windows and Linux shortcuts", () => {
    expect(launchedFromApp(["--launcher"], {})).toBe(true);
    expect(launchedFromApp(["--launcher", "x"], {})).toBe(false);
  });
  test("arguments or no variable keep the normal CLI", () => {
    expect(launchedFromApp([], {})).toBe(false);
    expect(launchedFromApp(["serve"], { PMCPG_LAUNCHER: "1" })).toBe(false);
  });
});

describe("macOS app", () => {
  test("install writes the bundle with a symlinked binary and registers it", () => {
    const s = fakeEnv("darwin");
    installLauncher(s);
    const app = appPath(s);
    expect(app).toBe(join(home, "Applications", "pMCPg.app"));
    const exe = join(app, "Contents", "MacOS", "pmcpg");
    expect(lstatSync(exe).isSymbolicLink()).toBe(true);
    expect(readlinkSync(exe)).toBe("/opt/pmcpg/bin/pmcpg");
    const plist = readFileSync(join(app, "Contents", "Info.plist"), "utf8");
    expect(plist).toContain("<key>PMCPG_LAUNCHER</key>\n    <string>1</string>");
    expect(calls.map((c) => c.cmd.at(-2))).toEqual(["-f"]);
  });
  test("reinstall replaces the bundle", () => {
    installLauncher(fakeEnv("darwin"));
    installLauncher(fakeEnv("darwin", { program: ["/usr/local/bin/pmcpg"] }));
    expect(readlinkSync(join(appPath(fakeEnv("darwin")), "Contents", "MacOS", "pmcpg"))).toBe(
      "/usr/local/bin/pmcpg",
    );
  });
  test("plist escapes and carries PMCPG_HOME", () => {
    expect(appInfoPlist({ PMCPG_HOME: "/a&b<c>" })).toContain(
      "<key>PMCPG_HOME</key>\n    <string>/a&amp;b&lt;c&gt;</string>",
    );
    expect(appInfoPlist({})).not.toContain("PMCPG_HOME");
  });
  test("skipped when running from source", () => {
    const s = fakeEnv("darwin", { program: ["/x/bun", "/repo/src/cli/main.ts"] });
    installLauncher(s);
    expect(existsSync(appPath(s))).toBe(false);
    expect(lines.join("\n")).toContain("Skipped");
  });
  test("uninstall unregisters and removes the bundle", () => {
    const s = fakeEnv("darwin");
    installLauncher(s);
    calls = [];
    uninstallLauncher(s);
    expect(existsSync(appPath(s))).toBe(false);
    expect(calls.map((c) => c.cmd.at(-2))).toEqual(["-u"]);
  });
});

describe("Linux .desktop", () => {
  test("install writes the entry", () => {
    const s = fakeEnv("linux");
    installLauncher(s);
    const file = desktopPath(s);
    expect(file).toBe(join(home, ".local", "share", "applications", "pmcpg.desktop"));
    const body = readFileSync(file, "utf8");
    expect(body).toContain('Exec="/opt/pmcpg/bin/pmcpg" "--launcher"');
    expect(body).toContain("Terminal=false");
  });
  test("honours XDG_DATA_HOME and PMCPG_HOME", () => {
    const s = fakeEnv("linux", { env: { XDG_DATA_HOME: join(home, "data"), PMCPG_HOME: "/srv/p" } });
    installLauncher(s);
    expect(readFileSync(join(home, "data", "applications", "pmcpg.desktop"), "utf8")).toContain(
      'Exec="/usr/bin/env" "PMCPG_HOME=/srv/p" "/opt/pmcpg/bin/pmcpg" "--launcher"',
    );
  });
  test("escapes quotes, variables, backslashes and field codes", () => {
    expect(desktopWord('/a "b"')).toBe('"/a \\\\"b\\\\""');
    expect(desktopWord("/a$b`c")).toBe('"/a\\\\$b\\\\`c"');
    expect(desktopWord("/a\\b")).toBe('"/a\\\\\\\\b"');
    expect(desktopWord("/50%")).toBe('"/50%%"');
    expect(() => desktopWord("/a\nb")).toThrow();
  });
  test("entry runs --launcher after the program", () => {
    expect(desktopEntry(["/x/bun", "/r/main.ts"], {})).toContain('Exec="/x/bun" "/r/main.ts" "--launcher"');
  });
  test("uninstall removes the entry", () => {
    const s = fakeEnv("linux");
    installLauncher(s);
    uninstallLauncher(s);
    expect(existsSync(desktopPath(s))).toBe(false);
  });
});

describe("Windows shortcut", () => {
  test("install runs the fixed script with values in the environment", () => {
    const s = fakeEnv("win32", { program: ["C:\\Users\\u\\AppData\\Local\\pmcpg\\bin\\pmcpg.exe"] });
    installLauncher(s);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.cmd).toEqual([
      join("C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      SHORTCUT_SCRIPT,
    ]);
    expect(call?.env).toEqual({
      PMCPG_LNK: shortcutPath(s),
      PMCPG_LNK_TARGET: "C:\\Users\\u\\AppData\\Local\\pmcpg\\bin\\pmcpg.exe",
      PMCPG_LNK_ARGS: "--launcher",
    });
    expect(shortcutPath(s)).toEndWith(join("Start Menu", "Programs", "pMCPg.lnk"));
  });
  test("skipped with PMCPG_HOME, which a shortcut cannot carry", () => {
    installLauncher(fakeEnv("win32", { env: { PMCPG_HOME: "D:\\p" } }));
    expect(calls).toHaveLength(0);
    expect(lines.join("\n")).toContain("Skipped");
  });
  test("a failed script is reported, not thrown", () => {
    installLauncher(fakeEnv("win32", {}, () => ({ code: 1, stderr: "COM error" })));
    expect(lines.join("\n")).toContain("Could not add the pMCPg launcher");
  });
  test("uninstall deletes the shortcut file", () => {
    const s = fakeEnv("win32", { env: { APPDATA: join(home, "Roaming") } });
    const file = shortcutPath(s);
    mkdirSync(join(file, ".."), { recursive: true });
    writeFileSync(file, "");
    uninstallLauncher(s);
    expect(existsSync(file)).toBe(false);
  });
});

test("service install and uninstall add and remove the launcher", () => {
  const s = fakeEnv("linux");
  installService(s);
  expect(existsSync(desktopPath(s))).toBe(true);
  uninstallService(s);
  expect(existsSync(desktopPath(s))).toBe(false);
});
