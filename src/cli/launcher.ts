// App launcher: a clickable "pMCPg" entry, created by `service install`. A click starts the gateway
// if needed and opens the web UI (launch.ts).
// macOS: ~/Applications/pMCPg.app, whose executable is a symlink to this binary. LSEnvironment sets
// PMCPG_LAUNCHER=1, which marks a bare launch as a click.
// Windows: a Start-menu shortcut, and Linux: a .desktop file, both running `pmcpg --launcher`.
import { existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { iconBytes } from "./assets/icons.ts";
import { type ServiceEnv, winQuote } from "./service.ts";

export const LAUNCHER_NAME = "pMCPg";
export const LAUNCHER_ENV = "PMCPG_LAUNCHER";
export const LAUNCHER_ARG = "--launcher";
const BUNDLE_ID = "io.github.baobab-tech.pmcpg.launcher";
const LSREGISTER =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

/** True when the OS started this binary from the app launcher with no arguments. */
export function launchedFromApp(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (argv.length === 1 && argv[0] === LAUNCHER_ARG) return true;
  // macOS before 10.9 passed a -psn_ process serial number argument.
  return env[LAUNCHER_ENV] === "1" && argv.every((a) => a.startsWith("-psn_"));
}

// ---------- macOS: app bundle ----------

const xml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function appInfoPlist(env: Record<string, string | undefined>): string {
  const home = env.PMCPG_HOME
    ? `\n    <key>PMCPG_HOME</key>\n    <string>${xml(env.PMCPG_HOME)}</string>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>pmcpg</string>
  <key>CFBundleIdentifier</key>
  <string>${BUNDLE_ID}</string>
  <key>CFBundleName</key>
  <string>${LAUNCHER_NAME}</string>
  <key>CFBundleDisplayName</key>
  <string>${LAUNCHER_NAME}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>pmcpg</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>LSEnvironment</key>
  <dict>
    <key>${LAUNCHER_ENV}</key>
    <string>1</string>${home}
  </dict>
</dict>
</plist>
`;
}

export const appPath = (s: ServiceEnv) => join(s.home, "Applications", `${LAUNCHER_NAME}.app`);

function macInstall(s: ServiceEnv): string | undefined {
  // A symlink cannot carry the script argument of `bun src/cli/main.ts`.
  if (s.program.length !== 1 || !s.program[0]) return undefined;
  const app = appPath(s);
  rmSync(app, { recursive: true, force: true });
  mkdirSync(join(app, "Contents", "MacOS"), { recursive: true });
  mkdirSync(join(app, "Contents", "Resources"), { recursive: true });
  writeFileSync(join(app, "Contents", "Info.plist"), appInfoPlist(s.env), { mode: 0o644 });
  writeFileSync(join(app, "Contents", "Resources", "pmcpg.icns"), iconBytes.icns(), { mode: 0o644 });
  symlinkSync(s.program[0], join(app, "Contents", "MacOS", "pmcpg"));
  // Launch Services caches Info.plist (LSEnvironment). Re-register so a changed PMCPG_HOME applies.
  s.run([LSREGISTER, "-f", app]);
  return app;
}

function macUninstall(s: ServiceEnv): string | undefined {
  const app = appPath(s);
  if (!existsSync(app)) return undefined;
  s.run([LSREGISTER, "-u", app]);
  rmSync(app, { recursive: true, force: true });
  return app;
}

// ---------- Linux: .desktop entry ----------

/** Quotes one Exec word: desktop-entry quoting, then string-value escaping, then `%` field codes. */
export function desktopWord(word: string): string {
  if (/[\r\n]/.test(word)) throw new Error("launcher: path contains a line break");
  const quoted = `"${word.replace(/[\\"`$]/g, "\\$&")}"`;
  return quoted.replace(/\\/g, "\\\\").replace(/%/g, "%%");
}

export function desktopEntry(
  program: string[],
  env: Record<string, string | undefined>,
  icon: string,
): string {
  if (/[\r\n]/.test(icon)) throw new Error("launcher: path contains a line break");
  const envPrefix = env.PMCPG_HOME ? ["/usr/bin/env", `PMCPG_HOME=${env.PMCPG_HOME}`] : [];
  const exec = [...envPrefix, ...program, LAUNCHER_ARG].map(desktopWord).join(" ");
  return `[Desktop Entry]
Type=Application
Name=${LAUNCHER_NAME}
Comment=Open the Private MCP Gateway web UI
Exec=${exec}
Icon=${icon}
Terminal=false
Categories=Network;Utility;
`;
}

const dataHome = (s: ServiceEnv) => s.env.XDG_DATA_HOME || join(s.home, ".local", "share");
export const desktopPath = (s: ServiceEnv) => join(dataHome(s), "applications", "pmcpg.desktop");
export const linuxIconPath = (s: ServiceEnv) =>
  join(dataHome(s), "icons", "hicolor", "256x256", "apps", "pmcpg.png");

function linuxInstall(s: ServiceEnv): string {
  const file = desktopPath(s);
  const icon = linuxIconPath(s);
  mkdirSync(dirname(icon), { recursive: true });
  writeFileSync(icon, iconBytes.png(), { mode: 0o644 });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, desktopEntry(s.program, s.env, icon), { mode: 0o644 });
  return file;
}

function linuxUninstall(s: ServiceEnv): string | undefined {
  const file = desktopPath(s);
  rmSync(linuxIconPath(s), { force: true });
  if (!existsSync(file)) return undefined;
  rmSync(file, { force: true });
  return file;
}

// ---------- Windows: Start-menu shortcut ----------

/** Fixed script: every value arrives through environment variables, so nothing is quoted into code. */
export const SHORTCUT_SCRIPT =
  "$ErrorActionPreference='Stop';" +
  "$l=(New-Object -ComObject WScript.Shell).CreateShortcut($env:PMCPG_LNK);" +
  "$l.TargetPath=$env:PMCPG_LNK_TARGET;$l.Arguments=$env:PMCPG_LNK_ARGS;" +
  "$l.IconLocation=$env:PMCPG_LNK_ICON+',0';$l.WindowStyle=7;$l.Description='Open the Private MCP Gateway web UI';$l.Save()";

export const shortcutPath = (s: ServiceEnv) =>
  join(
    s.env.APPDATA ?? join(s.home, "AppData", "Roaming"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    `${LAUNCHER_NAME}.lnk`,
  );

export const windowsIconPath = (s: ServiceEnv) =>
  join(s.env.LOCALAPPDATA ?? join(s.home, "AppData", "Local"), "pmcpg", "pmcpg.ico");

const powershell = (s: ServiceEnv) =>
  join(s.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");

function windowsInstall(s: ServiceEnv): string | undefined {
  // A shortcut cannot set environment variables, so it would open the default data directory.
  if (s.env.PMCPG_HOME) return undefined;
  const [target = "", ...rest] = s.program;
  const file = shortcutPath(s);
  const icon = windowsIconPath(s);
  mkdirSync(dirname(icon), { recursive: true });
  writeFileSync(icon, iconBytes.ico());
  const r = s.run([powershell(s), "-NoProfile", "-NonInteractive", "-Command", SHORTCUT_SCRIPT], {
    PMCPG_LNK: file,
    PMCPG_LNK_TARGET: target,
    PMCPG_LNK_ARGS: [...rest, LAUNCHER_ARG].map(winQuote).join(" "),
    PMCPG_LNK_ICON: icon,
  });
  if (r.code !== 0) throw new Error(`creating the shortcut failed (exit ${r.code}): ${r.stderr.trim()}`);
  return file;
}

function windowsUninstall(s: ServiceEnv): string | undefined {
  rmSync(windowsIconPath(s), { force: true });
  const file = shortcutPath(s);
  if (!existsSync(file)) return undefined;
  rmSync(file, { force: true });
  return file;
}

// ---------- dispatch ----------

/** Creates the launcher. Never throws: a missing launcher must not fail `service install`. */
export function installLauncher(s: ServiceEnv): void {
  try {
    const made =
      s.platform === "darwin"
        ? macInstall(s)
        : s.platform === "win32"
          ? windowsInstall(s)
          : s.platform === "linux"
            ? linuxInstall(s)
            : undefined;
    if (made) s.out(`Added the ${LAUNCHER_NAME} launcher: ${made}`);
    else s.out(`Skipped the ${LAUNCHER_NAME} launcher here. Open the web UI with \`pmcpg open\`.`);
  } catch (e) {
    s.out(`Could not add the ${LAUNCHER_NAME} launcher: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function uninstallLauncher(s: ServiceEnv): void {
  try {
    const removed =
      s.platform === "darwin"
        ? macUninstall(s)
        : s.platform === "win32"
          ? windowsUninstall(s)
          : s.platform === "linux"
            ? linuxUninstall(s)
            : undefined;
    if (removed) s.out(`Removed ${removed}`);
  } catch (e) {
    s.out(`Could not remove the ${LAUNCHER_NAME} launcher: ${e instanceof Error ? e.message : String(e)}`);
  }
}
