// Open a URL in the user's default browser. No shell: the URL is passed as one argument.
// The launcher gets an absolute path and an allow-listed environment, never the gateway's own (master key).
import { join } from "node:path";
import { resolveCommand, systemEnvironment } from "../connectors/stdio-env.ts";

/** Desktop session variables a launcher needs to reach the running browser (Linux, BSD). */
const DESKTOP_VARS = [
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "XDG_RUNTIME_DIR",
  "XDG_CURRENT_DESKTOP",
  "XDG_SESSION_TYPE",
  "XDG_DATA_DIRS",
  "XDG_CONFIG_DIRS",
  "DBUS_SESSION_BUS_ADDRESS",
  "BROWSER",
];

/** Environment for the launcher: system variables plus the desktop session's. */
export function launcherEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  const out = systemEnvironment();
  for (const key of DESKTOP_VARS) {
    const value = env[key];
    if (value !== undefined && !value.startsWith("()")) out[key] = value;
  }
  return out;
}

/** Absolute launcher command for `url`, or undefined when there is none (headless). */
export function launcherCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
  env: Record<string, string | undefined> = process.env,
): string[] | undefined {
  if (platform === "darwin") return ["/usr/bin/open", url];
  if (platform === "win32") {
    const root = env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows";
    return [join(root, "System32", "rundll32.exe"), "url.dll,FileProtocolHandler", url];
  }
  const xdg = resolveCommand("xdg-open", { PATH: env.PATH ?? "/usr/local/bin:/usr/bin:/bin", platform });
  return xdg ? [xdg, url] : undefined;
}

export async function openBrowser(url: string): Promise<void> {
  if (!/^https?:\/\//i.test(url)) throw new Error("only http(s) URLs can be opened");
  const cmd = launcherCommand(url);
  // No browser (Docker, headless): the caller prints the URL.
  if (!cmd) return;
  try {
    Bun.spawn(cmd, { env: launcherEnv(), stdin: "ignore", stdout: "ignore", stderr: "ignore" }).unref();
  } catch {
    // Launcher failed to start: the caller prints the URL.
  }
}
