import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultRunner,
  installService,
  LAUNCHD_LABEL,
  launchdPlist,
  plistPath,
  type RunResult,
  type ServiceEnv,
  selfProgram,
  serviceStatus,
  systemdUnit,
  uninstallService,
  unitPath,
  windowsTaskXml,
  winQuote,
} from "../../src/cli/service.ts";

let home: string;
let calls: string[][];
let lines: string[];

function fakeEnv(
  platform: NodeJS.Platform,
  reply: (cmd: string[]) => Partial<RunResult> = () => ({}),
): ServiceEnv {
  return {
    platform,
    env: { SystemRoot: "C:\\Windows", USERDOMAIN: "HOST", USERNAME: "olivier" },
    home,
    uid: 501,
    program: ["/opt/pmcpg/bin/pmcpg"],
    run: (cmd) => {
      calls.push(cmd);
      return { code: 0, stdout: "", stderr: "", ...reply(cmd) };
    },
    out: (l) => lines.push(l),
    sleep: () => {},
  };
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "pmcpg-svc-"));
  calls = [];
  lines = [];
});
afterEach(() => rmSync(home, { recursive: true, force: true }));

describe("selfProgram", () => {
  test("compiled binary runs itself", () => {
    expect(selfProgram("/usr/local/bin/pmcpg", "/$bunfs/root/pmcpg")).toEqual(["/usr/local/bin/pmcpg"]);
  });
  test("bun plus script in development", () => {
    expect(selfProgram("/x/bun", "/repo/src/cli/main.ts")).toEqual(["/x/bun", "/repo/src/cli/main.ts"]);
    expect(selfProgram("C:\\bun\\bun.exe", "C:\\repo\\main.ts")).toEqual([
      "C:\\bun\\bun.exe",
      "C:\\repo\\main.ts",
    ]);
  });
  test("Homebrew Cellar path becomes the opt link", () => {
    expect(selfProgram("/opt/homebrew/Cellar/pmcpg/0.1.0/bin/pmcpg", "")).toEqual([
      "/opt/homebrew/opt/pmcpg/bin/pmcpg",
    ]);
  });
});

describe("launchd", () => {
  test("install writes the plist and bootstraps it", () => {
    installService(fakeEnv("darwin"));
    const file = plistPath(fakeEnv("darwin"));
    expect(file).toBe(join(home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`));
    const plist = readFileSync(file, "utf8");
    expect(plist).toContain("<string>/opt/pmcpg/bin/pmcpg</string>\n    <string>serve</string>");
    expect(plist).toContain("<key>RunAtLoad</key>\n  <true/>");
    expect(calls).toContainEqual(["/bin/launchctl", "bootstrap", "gui/501", file]);
  });

  test("install retries bootstrap while launchd still unloads the old job (upgrade)", () => {
    let n = 0;
    const env = fakeEnv("darwin", (c) =>
      c[1] === "bootstrap" && ++n < 3 ? { code: 5, stderr: "Input/output error" } : {},
    );
    installService(env);
    expect(calls.filter((c) => c[1] === "bootstrap")).toHaveLength(3);
    expect(lines).toContainEqual(expect.stringContaining("Installed"));
  });

  test("install does not retry other bootstrap errors", () => {
    const env = fakeEnv("darwin", (c) => (c[1] === "bootstrap" ? { code: 1, stderr: "no" } : {}));
    expect(() => installService(env)).toThrow("launchctl bootstrap failed (exit 1)");
    expect(calls.filter((c) => c[1] === "bootstrap")).toHaveLength(1);
  });

  test("install fails loudly when launchctl fails", () => {
    const env = fakeEnv("darwin", (c) =>
      c[1] === "bootstrap" ? { code: 5, stderr: "Input/output error" } : {},
    );
    expect(() => installService(env)).toThrow("launchctl bootstrap failed (exit 5): Input/output error");
  });

  test("uninstall boots out and removes the plist", () => {
    installService(fakeEnv("darwin"));
    uninstallService(fakeEnv("darwin"));
    expect(existsSync(plistPath(fakeEnv("darwin")))).toBe(false);
    expect(calls.filter((c) => c[0] === "/bin/launchctl").at(-1)).toEqual([
      "/bin/launchctl",
      "bootout",
      `gui/501/${LAUNCHD_LABEL}`,
    ]);
  });

  test("status reads launchctl print", () => {
    const env = fakeEnv("darwin", () => ({ stdout: "\tstate = running\n" }));
    expect(serviceStatus(env)).toMatchObject({ installed: false, registered: true, running: true });
    expect(serviceStatus(fakeEnv("darwin", () => ({ code: 113 })))).toMatchObject({ registered: false });
  });

  test("escapes XML and carries PMCPG_HOME", () => {
    const plist = launchdPlist(["/a&b/<pmcpg>"], { PMCPG_HOME: "/data dir" }, "/l");
    expect(plist).toContain("<string>/a&amp;b/&lt;pmcpg&gt;</string>");
    expect(plist).toContain("<key>PMCPG_HOME</key>\n    <string>/data dir</string>");
  });

  test.skipIf(process.platform !== "darwin")("plist passes plutil -lint", () => {
    installService(fakeEnv("darwin"));
    const r = Bun.spawnSync(["/usr/bin/plutil", "-lint", plistPath(fakeEnv("darwin"))]);
    expect(r.exitCode).toBe(0);
  });
});

describe("systemd", () => {
  test("install writes the unit and enables it", () => {
    const env = fakeEnv("linux");
    installService(env);
    const file = unitPath(env);
    expect(file).toBe(join(home, ".config", "systemd", "user", "pmcpg.service"));
    expect(readFileSync(file, "utf8")).toContain('ExecStart="/opt/pmcpg/bin/pmcpg" "serve"');
    expect(calls).toEqual([
      ["systemctl", "--user", "daemon-reload"],
      ["systemctl", "--user", "enable", "--now", "pmcpg.service"],
    ]);
  });

  test("honours XDG_CONFIG_HOME", () => {
    const env = fakeEnv("linux");
    env.env.XDG_CONFIG_HOME = join(home, "xdg");
    expect(unitPath(env)).toBe(join(home, "xdg", "systemd", "user", "pmcpg.service"));
  });

  test("uninstall disables and removes the unit", () => {
    const env = fakeEnv("linux");
    installService(env);
    calls = [];
    uninstallService(env);
    expect(existsSync(unitPath(env))).toBe(false);
    expect(calls[0]).toEqual(["systemctl", "--user", "disable", "--now", "pmcpg.service"]);
  });

  test("status uses is-enabled and is-active", () => {
    const env = fakeEnv("linux", (c) => ({ code: c[2] === "is-active" ? 3 : 0 }));
    expect(serviceStatus(env)).toMatchObject({ registered: true, running: false });
  });

  test("escapes quotes, specifiers and variables", () => {
    const unit = systemdUnit(['/my "dir"/50%/$HOME\\pmcpg'], { PMCPG_HOME: "/d" });
    expect(unit).toContain('ExecStart="/my \\"dir\\"/50%%/$$HOME\\\\pmcpg" "serve"');
    expect(unit).toContain('Environment="PMCPG_HOME=/d"');
  });
});

describe("Task Scheduler", () => {
  test("install creates a logon task from XML, then starts it", () => {
    installService(fakeEnv("win32"));
    const create = calls[0] ?? [];
    expect(create.slice(0, 3)).toEqual([join("C:\\Windows", "System32", "schtasks.exe"), "/Create", "/TN"]);
    expect(create).toContain("/XML");
    expect(create.at(-1)).toBe("/F");
    expect(existsSync(create[5] ?? "")).toBe(false); // temp XML removed
    expect(calls[1]?.slice(1)).toEqual(["/Run", "/TN", "pmcpg"]);
  });

  test("XML binds the trigger to the current user without elevation", () => {
    const x = windowsTaskXml(["C:\\Program Files\\pmcpg\\pmcpg.exe"], "HOST\\olivier");
    expect(x).toContain(
      "<LogonTrigger>\n      <Enabled>true</Enabled>\n      <UserId>HOST\\olivier</UserId>",
    );
    expect(x).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(x).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(x).toContain("<Command>C:\\Program Files\\pmcpg\\pmcpg.exe</Command>");
    expect(x).toContain("<Arguments>serve</Arguments>");
  });

  test("status parses schtasks /Query", () => {
    const env = fakeEnv("win32", () => ({ stdout: "TaskName:  \\pmcpg\nStatus:    Running\n" }));
    expect(serviceStatus(env)).toMatchObject({ installed: true, running: true });
    expect(serviceStatus(fakeEnv("win32", () => ({ code: 1 })))).toMatchObject({ installed: false });
  });

  test("winQuote follows CommandLineToArgvW", () => {
    expect(winQuote("serve")).toBe("serve");
    expect(winQuote("C:\\a b\\x.ts")).toBe('"C:\\a b\\x.ts"');
    expect(winQuote('a"b')).toBe('"a\\"b"');
    expect(winQuote("C:\\a b\\")).toBe('"C:\\a b\\\\"');
    expect(winQuote("")).toBe('""');
  });

  // Registers a real task on the CI runner to prove schtasks accepts the XML.
  test.skipIf(process.platform !== "win32" || !process.env.CI)("schtasks accepts the task (CI only)", () => {
    const task = `pmcpg-test-${process.pid}`;
    const cmd = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "cmd.exe");
    const env: ServiceEnv = {
      platform: "win32",
      env: process.env,
      home,
      uid: 0,
      program: [cmd, "/c", "exit"],
      run: defaultRunner(process.env),
      out: () => {},
    };
    try {
      installService(env, task);
      expect(serviceStatus(env, task).installed).toBe(true);
    } finally {
      uninstallService(env, task);
    }
    expect(serviceStatus(env, task).installed).toBe(false);
  });
});

test("unsupported platform throws", () => {
  expect(() => installService(fakeEnv("aix"))).toThrow("not supported on aix");
});

test("warns when run from the npx cache", () => {
  const env = fakeEnv("linux");
  env.program = ["/home/u/.npm/_npx/abc/node_modules/@baobabtech/pmcpg-linux-x64/bin/pmcpg"];
  installService(env);
  expect(lines[0]).toContain("npx cache");
});
