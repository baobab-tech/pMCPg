// The command table. Stubs exit 2 until integration wires them to the service.
import { actions } from "./actions.ts";
import { type Command, EXIT_OK, EXIT_USAGE, type Io } from "./cli.ts";
import { catalogCommands } from "./commands-catalog.ts";
import { logCommands } from "./commands-log.ts";
import { onboardingCommands } from "./commands-onboarding.ts";
import { policyCommands } from "./commands-policy.ts";
import { privacyCommands } from "./commands-privacy.ts";
import { tokenCommands } from "./commands-token.ts";
import { uiCommands } from "./commands-ui.ts";
import { installService, serviceEnv, serviceStatus, uninstallService } from "./service.ts";
import { VERSION } from "./version.ts";

const MANY = Number.POSITIVE_INFINITY;

/** Uses the implementation in actions.ts when there is one, else prints "not wired yet". */
function stub(c: Omit<Command, "run">): Command {
  const action = actions[c.path.join(" ")];
  if (action) return { ...c, run: action };
  return {
    ...c,
    run: (_p, io: Io) => {
      io.err(`pmcpg ${c.path.join(" ")}: not wired yet`);
      return EXIT_USAGE;
    },
  };
}

export const commands: Command[] = [
  stub({
    path: ["serve"],
    summary: "Run the gateway (MCP endpoint, web UI, OAuth callback)",
    args: "[--host <addr>] [--port <n>]",
    options: { host: { type: "string" }, port: { type: "string" } },
    optionHelp: { host: "Address to bind (default 127.0.0.1)", port: "Port to listen on (default 7431)" },
  }),
  stub({
    path: ["connect"],
    summary: "Bridge stdio to a profile, for clients that only launch local servers",
    args: "<profile>",
    minArgs: 1,
    maxArgs: 1,
  }),

  stub({
    path: ["server", "add"],
    summary: "Add a server by URL or command",
    args: "<name> (--url <url> | --command <cmd>)",
    options: { url: { type: "string" }, command: { type: "string" } },
    optionHelp: { url: "Remote server URL", command: "Command line for a stdio server" },
    minArgs: 1,
    maxArgs: 1,
  }),
  stub({ path: ["server", "list"], summary: "List servers" }),
  stub({ path: ["server", "remove"], summary: "Remove a server", args: "<name>", minArgs: 1, maxArgs: 1 }),
  stub({
    path: ["server", "import"],
    summary: "Import servers from a client config (claude-desktop, claude-code, vscode)",
    args: "<client>",
    minArgs: 1,
    maxArgs: 1,
  }),

  stub({
    path: ["account", "add"],
    summary: "Add an account to a server; secret values are prompted for and stored in the vault",
    args: "<server> [--name <name>] [--header <Name>]... [--env <VAR>]...",
    options: {
      name: { type: "string" },
      label: { type: "string" },
      header: { type: "string", multiple: true },
      env: { type: "string", multiple: true },
    },
    optionHelp: {
      name: "Account name, e.g. work (account id becomes <server>-<name>)",
      label: "Display label, e.g. an email address",
      header: "HTTP header to send, e.g. Authorization (value is prompted)",
      env: "Environment variable for a local server, e.g. API_KEY (value is prompted)",
    },
    minArgs: 1,
    maxArgs: 1,
  }),
  stub({
    path: ["account", "signin"],
    summary: "Sign in to a server (opens the browser for OAuth)",
    args: "<server> [--name <name>]",
    options: { name: { type: "string" } },
    optionHelp: { name: "Account name, e.g. work" },
    minArgs: 1,
    maxArgs: 1,
  }),
  stub({ path: ["account", "list"], summary: "List accounts" }),
  stub({
    path: ["account", "remove"],
    summary: "Sign out and remove an account",
    args: "<account>",
    minArgs: 1,
    maxArgs: 1,
  }),

  stub({
    path: ["profile", "create"],
    summary: "Create a profile",
    args: "<name> [--privacy off|standard|strict]",
    options: { privacy: { type: "string" } },
    optionHelp: { privacy: "off, standard or strict" },
    minArgs: 1,
    maxArgs: 1,
  }),
  stub({
    path: ["profile", "add"],
    summary: "Add accounts to a profile",
    args: "<profile> <account>...",
    minArgs: 2,
    maxArgs: MANY,
  }),
  stub({ path: ["profile", "list"], summary: "List profiles" }),
  stub({
    path: ["profile", "token"],
    summary: "Show a profile's URL and client token, for clients that connect over HTTP",
    args: "<name>",
    minArgs: 1,
    maxArgs: 1,
  }),
  stub({ path: ["profile", "remove"], summary: "Remove a profile", args: "<name>", minArgs: 1, maxArgs: 1 }),

  {
    path: ["service", "install"],
    summary: "Start the gateway at login (launchd, Task Scheduler, systemd user unit)",
    run: (_p, io) => {
      installService(serviceEnv(io.out));
      return EXIT_OK;
    },
  },
  {
    path: ["service", "uninstall"],
    summary: "Stop starting the gateway at login",
    run: (_p, io) => {
      uninstallService(serviceEnv(io.out));
      return EXIT_OK;
    },
  },
  {
    path: ["service", "status"],
    summary: "Show whether the login service is installed and running",
    run: (_p, io) => {
      const s = serviceStatus(serviceEnv(io.out));
      const yn = (b: boolean) => (b ? "yes" : "no");
      io.out(`file:       ${s.file}`);
      io.out(`installed:  ${yn(s.installed)}`);
      io.out(`registered: ${yn(s.registered)}`);
      io.out(`running:    ${yn(s.running)}`);
      return EXIT_OK;
    },
  },

  {
    path: ["version"],
    summary: "Print the version",
    run: (_p, io) => {
      io.out(VERSION);
      return EXIT_OK;
    },
  },
  ...privacyCommands,
  ...policyCommands,
  ...logCommands,
  ...uiCommands,
  ...onboardingCommands,
  ...tokenCommands,
  ...catalogCommands,
];
