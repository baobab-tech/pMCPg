// CLI commands for ui. Owner: p2-ui. Registered in commands.ts.
// Works on state.db directly, so it also works while the gateway is stopped.
import type { Database } from "bun:sqlite";
import {
  clearPassword,
  createLaunchCode,
  isLoopback,
  LAUNCH_PATH,
  PASSWORD_SETTING,
  writePassword,
} from "../api/auth.ts";
import { ensureDataDir, loadConfig } from "../core/config-store.ts";
import { paths } from "../core/paths.ts";
import { openBrowser } from "../gateway/browser.ts";
import { openDb } from "../store/db.ts";
import { type Command, EXIT_OK } from "./cli.ts";

async function readFirstLine(): Promise<string> {
  const text = await new Response(Bun.stdin.stream()).text();
  return (text.split(/\r?\n/)[0] ?? "").trim();
}

/**
 * The address to open the web UI at. Without a password on a loopback bind, it carries a one-time launch
 * code (valid 15 minutes): the UI accepts no other way in, so other local users cannot take it over.
 */
export function uiLink(db: Database, host: string, port: number): string {
  const base = `http://127.0.0.1:${port}`;
  const hasPassword = db.query("SELECT 1 FROM settings WHERE key = ?").get(PASSWORD_SETTING) !== null;
  if (hasPassword || !isLoopback(host)) return `${base}/`;
  return `${base}${LAUNCH_PATH}?k=${createLaunchCode(db)}`;
}

export const uiCommands: Command[] = [
  {
    path: ["open"],
    summary: "Open the web UI in your browser",
    args: "[--print]",
    options: { print: { type: "boolean" } },
    optionHelp: { print: "Print the link instead of opening it (it works once, for 15 minutes)" },
    run: async (p, io) => {
      const { dir, db: file, config } = paths();
      ensureDataDir(dir);
      const { host, port } = loadConfig(config).gateway;
      const db = openDb(file);
      try {
        const link = uiLink(db, host, port);
        if (p.values.print) io.out(link);
        else {
          await openBrowser(link);
          io.out("Opening the web UI in your browser. If nothing opens, run `pmcpg open --print`.");
        }
        return EXIT_OK;
      } finally {
        db.close();
      }
    },
  },
  {
    path: ["ui", "reset-password"],
    summary: "Remove the web UI password and sign everyone out, or set a new one with --stdin",
    args: "[--stdin]",
    options: { stdin: { type: "boolean" } },
    optionHelp: { stdin: "Read the new password from the first line of standard input" },
    run: async (p, io) => {
      const { dir, db: file } = paths();
      ensureDataDir(dir);
      const db = openDb(file);
      try {
        if (p.values.stdin) {
          await writePassword(db, await readFirstLine());
          io.out("New web UI password set. Everyone was signed out.");
        } else {
          clearPassword(db);
          io.out("Web UI password removed. Everyone was signed out.");
          io.out("Open the web UI to set a new one. If the gateway listens on another address than");
          io.out("127.0.0.1, its log shows a one-time setup code you will need.");
        }
        return EXIT_OK;
      } finally {
        db.close();
      }
    },
  },
];
