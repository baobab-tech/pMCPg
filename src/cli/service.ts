// Start-at-login registration: launchd LaunchAgent (macOS), Task Scheduler logon task (Windows),
// systemd user unit (Linux). Each runs `<binary> serve` as the current user.
// Install also adds the app launcher (launcher.ts); uninstall removes it.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { installLauncher, uninstallLauncher } from "./launcher.ts";

export const LAUNCHD_LABEL = "io.github.baobab-tech.pmcpg";
export const SYSTEMD_UNIT = "pmcpg.service";
export const WINDOWS_TASK = "pmcpg";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** `extraEnv` adds variables on top of the passed-through ones. */
export type Runner = (cmd: string[], extraEnv?: Record<string, string>) => RunResult;

export interface ServiceEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  home: string;
  uid: number;
  /** Command line that starts the gateway, without the `serve` argument. */
  program: string[];
  run: Runner;
  out: (line: string) => void;
  /** Pause between retries. Tests pass a no-op. */
  sleep?: (ms: number) => void;
}

export interface ServiceStatus {
  installed: boolean;
  /** Registered with the service manager (loaded, enabled). */
  registered: boolean;
  running: boolean;
  file: string;
}

/** Variables passed to launchctl, systemctl and schtasks. Nothing else from the caller's environment. */
const PASSED_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "XDG_RUNTIME_DIR",
  "DBUS_SESSION_BUS_ADDRESS",
  "SystemRoot",
  "windir",
  "USERNAME",
  "USERDOMAIN",
  "USERPROFILE",
  "TEMP",
  "TMP",
];

export function defaultRunner(env: Record<string, string | undefined>): Runner {
  const childEnv: Record<string, string> = {};
  for (const k of PASSED_ENV) {
    const v = env[k];
    if (v !== undefined) childEnv[k] = v;
  }
  return (cmd, extraEnv) => {
    try {
      const p = Bun.spawnSync(cmd, {
        env: { ...childEnv, ...extraEnv },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      return { code: p.exitCode ?? 1, stdout: p.stdout.toString(), stderr: p.stderr.toString() };
    } catch (e) {
      return { code: 127, stdout: "", stderr: e instanceof Error ? e.message : String(e) };
    }
  };
}

/**
 * The command that starts this binary. Under `bun src/cli/main.ts` it is bun plus the script.
 * A Homebrew Cellar path is swapped for the stable `opt` link so upgrades keep working.
 */
export function selfProgram(execPath = process.execPath, main = Bun.main): string[] {
  if (/(^|[\\/])bun(\.exe)?$/i.test(execPath)) return [execPath, main];
  const cellar = execPath.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/(.+)$/);
  if (cellar) return [`${cellar[1]}/opt/${cellar[2]}/${cellar[3]}`];
  return [execPath];
}

export function serviceEnv(out: (line: string) => void): ServiceEnv {
  return {
    platform: process.platform,
    env: process.env,
    home: homedir(),
    uid: process.getuid?.() ?? 0,
    program: selfProgram(),
    run: defaultRunner(process.env),
    out,
  };
}

// ---------- macOS: launchd ----------

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function launchdPlist(
  program: string[],
  env: Record<string, string | undefined>,
  logFile: string,
): string {
  const args = [...program, "serve"].map((a) => `    <string>${xml(a)}</string>`).join("\n");
  const vars = env.PMCPG_HOME
    ? `  <key>EnvironmentVariables</key>\n  <dict>\n    <key>PMCPG_HOME</key>\n    <string>${xml(env.PMCPG_HOME)}</string>\n  </dict>\n`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCHD_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
${vars}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>StandardOutPath</key>
  <string>${xml(logFile)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(logFile)}</string>
</dict>
</plist>
`;
}

export const plistPath = (s: ServiceEnv) => join(s.home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
const launchdLog = (s: ServiceEnv) => join(s.home, "Library", "Logs", "pmcpg", "service.log");
const LAUNCHCTL = "/bin/launchctl";
/** About 5 s of retries while launchd unloads the previous job. */
const BOOTSTRAP_RETRIES = 20;

function launchdInstall(s: ServiceEnv): void {
  const file = plistPath(s);
  mkdirSync(dirname(file), { recursive: true });
  mkdirSync(dirname(launchdLog(s)), { recursive: true });
  writeFileSync(file, launchdPlist(s.program, s.env, launchdLog(s)), { mode: 0o644 });
  s.run([LAUNCHCTL, "bootout", `gui/${s.uid}/${LAUNCHD_LABEL}`]);
  // bootout returns before launchd has unloaded the old job; bootstrap then fails with 5 (EIO). Retry briefly.
  const sleep = s.sleep ?? Bun.sleepSync;
  let r = s.run([LAUNCHCTL, "bootstrap", `gui/${s.uid}`, file]);
  for (let i = 0; r.code === 5 && i < BOOTSTRAP_RETRIES; i++) {
    sleep(250);
    r = s.run([LAUNCHCTL, "bootstrap", `gui/${s.uid}`, file]);
  }
  must(r, "launchctl bootstrap");
  s.out(`Installed ${file}`);
}

function launchdUninstall(s: ServiceEnv): void {
  const file = plistPath(s);
  s.run([LAUNCHCTL, "bootout", `gui/${s.uid}/${LAUNCHD_LABEL}`]);
  rmSync(file, { force: true });
  s.out(`Removed ${file}`);
}

function launchdStatus(s: ServiceEnv): ServiceStatus {
  const file = plistPath(s);
  const r = s.run([LAUNCHCTL, "print", `gui/${s.uid}/${LAUNCHD_LABEL}`]);
  return {
    installed: existsSync(file),
    registered: r.code === 0,
    running: r.code === 0 && /^\s*state = running\s*$/m.test(r.stdout),
    file,
  };
}

// ---------- Linux: systemd user unit ----------

/** Quotes one ExecStart word: systemd C-style escapes, `%` specifiers and `$` expansion disabled. */
const systemdWord = (s: string) =>
  `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;

export function systemdUnit(program: string[], env: Record<string, string | undefined>): string {
  const envLine = env.PMCPG_HOME ? `Environment=${systemdWord(`PMCPG_HOME=${env.PMCPG_HOME}`)}\n` : "";
  return `[Unit]
Description=pMCPg (Private MCP Gateway)

[Service]
ExecStart=${[...program, "serve"].map(systemdWord).join(" ")}
${envLine}Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
`;
}

export const unitPath = (s: ServiceEnv) =>
  join(s.env.XDG_CONFIG_HOME || join(s.home, ".config"), "systemd", "user", SYSTEMD_UNIT);

function systemdInstall(s: ServiceEnv): void {
  const file = unitPath(s);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, systemdUnit(s.program, s.env), { mode: 0o644 });
  must(s.run(["systemctl", "--user", "daemon-reload"]), "systemctl daemon-reload");
  must(s.run(["systemctl", "--user", "enable", "--now", SYSTEMD_UNIT]), "systemctl enable");
  s.out(`Installed ${file}`);
  s.out("On a headless machine, run `loginctl enable-linger` so it starts without a login session.");
}

function systemdUninstall(s: ServiceEnv): void {
  const file = unitPath(s);
  s.run(["systemctl", "--user", "disable", "--now", SYSTEMD_UNIT]);
  rmSync(file, { force: true });
  s.run(["systemctl", "--user", "daemon-reload"]);
  s.out(`Removed ${file}`);
}

function systemdStatus(s: ServiceEnv): ServiceStatus {
  return {
    installed: existsSync(unitPath(s)),
    registered: s.run(["systemctl", "--user", "is-enabled", "--quiet", SYSTEMD_UNIT]).code === 0,
    running: s.run(["systemctl", "--user", "is-active", "--quiet", SYSTEMD_UNIT]).code === 0,
    file: unitPath(s),
  };
}

// ---------- Windows: Task Scheduler ----------

/** Quotes one argument for the Windows command line (CommandLineToArgvW rules). */
export function winQuote(arg: string): string {
  if (arg !== "" && !/[\s"]/.test(arg)) return arg;
  return `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;
}

/** Logon trigger bound to the current user, so no elevation is needed. Interactive token keeps keychain access. */
export function windowsTaskXml(program: string[], user: string): string {
  const [command = "", ...rest] = program;
  const args = [...rest, "serve"].map(winQuote).join(" ");
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>pMCPg (Private MCP Gateway)</Description>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${xml(user)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${xml(user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xml(command)}</Command>
      <Arguments>${xml(args)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

const schtasks = (s: ServiceEnv) => join(s.env.SystemRoot ?? "C:\\Windows", "System32", "schtasks.exe");
const windowsUser = (s: ServiceEnv) =>
  s.env.USERDOMAIN ? `${s.env.USERDOMAIN}\\${s.env.USERNAME ?? ""}` : (s.env.USERNAME ?? "");

function windowsInstall(s: ServiceEnv, task: string): void {
  const file = join(tmpdir(), `pmcpg-task-${process.pid}.xml`);
  // schtasks reads the XML as UTF-16 LE with a byte order mark.
  const body = Buffer.from(windowsTaskXml(s.program, windowsUser(s)), "utf16le");
  writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), body]));
  try {
    must(s.run([schtasks(s), "/Create", "/TN", task, "/XML", file, "/F"]), "schtasks /Create");
  } finally {
    rmSync(file, { force: true });
  }
  s.run([schtasks(s), "/Run", "/TN", task]);
  s.out(`Installed scheduled task "${task}"`);
}

function windowsUninstall(s: ServiceEnv, task: string): void {
  s.run([schtasks(s), "/End", "/TN", task]);
  const r = s.run([schtasks(s), "/Delete", "/TN", task, "/F"]);
  s.out(r.code === 0 ? `Removed scheduled task "${task}"` : `No scheduled task "${task}"`);
}

function windowsStatus(s: ServiceEnv, task: string): ServiceStatus {
  const r = s.run([schtasks(s), "/Query", "/TN", task, "/FO", "LIST"]);
  return {
    installed: r.code === 0,
    registered: r.code === 0,
    running: r.code === 0 && /:\s*Running\s*$/m.test(r.stdout),
    file: `Task Scheduler: ${task}`,
  };
}

// ---------- dispatch ----------

function must(r: RunResult, what: string): void {
  if (r.code !== 0) throw new Error(`${what} failed (exit ${r.code}): ${r.stderr.trim() || r.stdout.trim()}`);
}

type Impl = { install: () => void; uninstall: () => void; status: () => ServiceStatus };

function impl(s: ServiceEnv, task: string): Impl {
  switch (s.platform) {
    case "darwin":
      return {
        install: () => launchdInstall(s),
        uninstall: () => launchdUninstall(s),
        status: () => launchdStatus(s),
      };
    case "win32":
      return {
        install: () => windowsInstall(s, task),
        uninstall: () => windowsUninstall(s, task),
        status: () => windowsStatus(s, task),
      };
    case "linux":
      return {
        install: () => systemdInstall(s),
        uninstall: () => systemdUninstall(s),
        status: () => systemdStatus(s),
      };
    default:
      throw new Error(`service commands are not supported on ${s.platform}`);
  }
}

/** `task` overrides the Windows task name (tests only). */
export function installService(s: ServiceEnv, task = WINDOWS_TASK): void {
  const i = impl(s, task);
  if (/[\\/]_npx[\\/]/.test(s.program[0] ?? ""))
    s.out("Warning: running from the npx cache. Install pmcpg permanently so this path stays valid.");
  i.install();
  installLauncher(s);
}

/** Registers and starts the login service, without touching the launcher. Used by a launcher click. */
export function startService(s: ServiceEnv, task = WINDOWS_TASK): void {
  impl(s, task).install();
}

export function uninstallService(s: ServiceEnv, task = WINDOWS_TASK): void {
  impl(s, task).uninstall();
  uninstallLauncher(s);
}

export function serviceStatus(s: ServiceEnv, task = WINDOWS_TASK): ServiceStatus {
  return impl(s, task).status();
}
