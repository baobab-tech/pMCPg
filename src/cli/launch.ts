// What a click on the pMCPg launcher does: start the gateway if it is not answering, wait for it,
// then open the web UI. Errors show a dialog, since a launcher has no terminal to print to.
import { ensureDataDir, loadConfig } from "../core/config-store.ts";
import { paths } from "../core/paths.ts";
import { openBrowser } from "../gateway/browser.ts";
import { openDb } from "../store/db.ts";
import { uiLink } from "./commands-ui.ts";
import { LAUNCHER_NAME } from "./launcher.ts";
import { type ServiceEnv, serviceEnv, startService } from "./service.ts";

/** About 20 s: the first start opens the vault and the database. */
const WAIT_TRIES = 80;
const WAIT_MS = 250;

export interface LaunchDeps {
  service: ServiceEnv;
  /** True when something answers HTTP on the gateway port. */
  isUp: (port: number) => Promise<boolean>;
  /** Builds the UI link and opens it in the browser. */
  openUi: () => Promise<void>;
  port: number;
  sleep: (ms: number) => Promise<void>;
}

export async function gatewayAnswers(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { redirect: "manual", signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

/** Shows `message` in a native dialog, through the runner (no shell; the text is one argument or variable). */
export function showError(s: ServiceEnv, message: string): void {
  const title = `${LAUNCHER_NAME} could not start`;
  if (s.platform === "darwin") {
    s.run([
      "/usr/bin/osascript",
      "-e",
      "on run argv",
      "-e",
      "display alert (item 1 of argv) message (item 2 of argv) as critical",
      "-e",
      "end run",
      title,
      message,
    ]);
  } else if (s.platform === "win32") {
    const ps = `${s.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
    s.run(
      [
        ps,
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Add-Type -AssemblyName PresentationFramework;[System.Windows.MessageBox]::Show($env:PMCPG_MSG,$env:PMCPG_TITLE,'OK','Error')|Out-Null",
      ],
      { PMCPG_MSG: message, PMCPG_TITLE: title },
    );
  } else {
    // zenity ships with GNOME; other desktops without it get no dialog.
    s.run(["zenity", "--error", `--title=${title}`, `--text=${message}`]);
  }
}

export async function launch(d: LaunchDeps): Promise<number> {
  try {
    if (!(await d.isUp(d.port))) {
      startService(d.service);
      let up = false;
      for (let i = 0; i < WAIT_TRIES && !up; i++) {
        await d.sleep(WAIT_MS);
        up = await d.isUp(d.port);
      }
      if (!up) {
        showError(
          d.service,
          "The gateway did not start within 20 seconds. Restart your computer and try again.",
        );
        return 1;
      }
    }
    await d.openUi();
    return 0;
  } catch (e) {
    showError(d.service, e instanceof Error ? e.message : String(e));
    return 1;
  }
}

/** Entry for `main.ts` when the OS started the binary from the launcher. */
export async function launchFromApp(): Promise<number> {
  const { dir, db: file, config } = paths();
  const service = serviceEnv(() => {});
  try {
    ensureDataDir(dir);
    const { host, port } = loadConfig(config).gateway;
    return await launch({
      service,
      port,
      isUp: gatewayAnswers,
      sleep: (ms) => Bun.sleep(ms),
      openUi: async () => {
        const db = openDb(file);
        try {
          await openBrowser(uiLink(db, host, port));
        } finally {
          db.close();
        }
      },
    });
  } catch (e) {
    showError(service, e instanceof Error ? e.message : String(e));
    return 1;
  }
}
