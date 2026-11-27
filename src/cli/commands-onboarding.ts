// CLI for onboarding: import servers from AI apps, connect AI apps to the gateway.
import { type Config, Slug } from "../core/config.ts";
import { loadConfig, saveConfig, validateConfig } from "../core/config-store.ts";
import { paths } from "../core/paths.ts";
import { checkReferences } from "../core/profiles.ts";
import { ensureToken, openState } from "../gateway/runtime.ts";
import { applyImport } from "../onboarding/apply.ts";
import { applyConnect, type ConnectApp, planConnect, selfCommand } from "../onboarding/clients.ts";
import { EXPORT_FORMATS, type ExportFormat, exportServers, FORMAT_INFO } from "../onboarding/export.ts";
import {
  APP_LABELS,
  type Candidate,
  defaultScanEnv,
  isThisGateway,
  keyOf,
  mergeFound,
  scanApps,
} from "../onboarding/importers.ts";
import { PASTE_PROMPT, parsePasted, pastedCandidate } from "../onboarding/paste.ts";
import { vaultKeys } from "../vault/vault.ts";
import { notifyReload } from "./actions.ts";
import { type Command, EXIT_ERROR, EXIT_OK, EXIT_USAGE, type Io } from "./cli.ts";

const APPS: ConnectApp[] = ["claude-desktop", "claude-code", "lm-studio", "cursor", "vscode"];

/** Read pasted text from a file, or stdin for "-". */
async function readPaste(src: string): Promise<string> {
  return src === "-" ? await Bun.stdin.text() : await Bun.file(src).text();
}

/** Candidates from a chatbot's pasted list; other entries are printed as notes. */
function pasteCandidates(text: string, io: Io): Candidate[] {
  const r = parsePasted(text);
  const out: Candidate[] = [];
  for (const s of r.servers) {
    if (s.status === "ready" && s.url) {
      const c = pastedCandidate(s.name, s.url, s.secretParams);
      if (!("error" in c)) out.push({ ...c, suggestedId: s.suggestedId });
      continue;
    }
    const why = s.status === "url-needed" ? "URL needed: add it with pmcpg server add" : s.note;
    io.out(`  - ${s.name}${s.url ? ` ${s.url}` : ""}: ${why}`);
  }
  if (r.truncated) io.out("  (the pasted text was long; only the first part was read)");
  return out;
}

function describe(c: Candidate): string {
  const where =
    [
      ...new Set(
        c.foundIn.map((f) => APP_LABELS[f.app] + (f.project ? ` (${f.project.split(/[\\/]/).pop()})` : "")),
      ),
    ].join(", ") || "pasted list";
  const what =
    c.server.transport === "stdio"
      ? [c.server.command, ...c.server.args].join(" ")
      : `${c.server.url}${c.secretInUrl ? " (address contains a key; not imported)" : ""}`;
  const needs = [...c.envNames, ...c.headerNames, ...c.secretParams.map((n) => `?${n}`)];
  return `${c.suggestedId}\t${what}\t${where}${needs.length ? `\tneeds: ${needs.join(", ")}` : ""}`;
}

export const onboardingCommands: Command[] = [
  {
    path: ["export"],
    summary: "Export your server list for another AI app, a backup or your team; keys are never included",
    args: "[--format <format>] [--share] [--output <file>]",
    options: {
      format: { type: "string" },
      share: { type: "boolean" },
      output: { type: "string", short: "o" },
    },
    optionHelp: {
      format: `One of: ${EXPORT_FORMATS.join(", ")} (default mcp-json, read by Claude Code, LM Studio, Windsurf and most apps)`,
      // biome-ignore lint/suspicious/noTemplateCurlyInString: literal placeholder written into the file
      share: "For sharing: one entry per server, no account names, home folder written as ${HOME}",
      output: "Write to this file instead of printing",
    },
    maxArgs: 0,
    run: async (p, io) => {
      const format = (typeof p.values.format === "string" ? p.values.format : "mcp-json") as ExportFormat;
      if (!EXPORT_FORMATS.includes(format)) {
        io.err(`Unknown format "${format}". Use one of: ${EXPORT_FORMATS.join(", ")}`);
        return EXIT_USAGE;
      }
      // Reads config.yaml only, never the vault: no key can reach the file.
      const r = exportServers(loadConfig(paths().config), format, {
        share: !!p.values.share,
        home: defaultScanEnv().home,
      });
      const output = typeof p.values.output === "string" ? p.values.output : undefined;
      if (!output) {
        io.out(r.content.replace(/\n$/, ""));
        return EXIT_OK;
      }
      try {
        await Bun.write(output, r.content);
      } catch (e) {
        io.err(`Could not write ${output}: ${(e as Error).message}`);
        return EXIT_ERROR;
      }
      io.out(`Wrote ${r.count} server${r.count === 1 ? "" : "s"} to ${output}. ${FORMAT_INFO[format].hint}`);
      if (r.placeholders.length) io.out(`To fill in after importing: ${r.placeholders.join(", ")}`);
      if (r.signIn.length) io.out(`Sign in again: ${r.signIn.join(", ")}`);
      for (const s of r.skipped) io.out(`Left out ${s.name}: ${s.reason}`);
      return EXIT_OK;
    },
  },
  {
    path: ["import"],
    summary: "Import MCP servers from your AI apps (Claude Desktop, Claude Code, LM Studio, Cursor, VS Code)",
    args: "[--paste <file|->] [--all | --pick <n,n,...>] [--profile-per-project]",
    options: {
      all: { type: "boolean" },
      pick: { type: "string" },
      "profile-per-project": { type: "boolean" },
      paste: { type: "string" },
      "paste-prompt": { type: "boolean" },
    },
    optionHelp: {
      all: "Import every server listed that is reached by URL (pick command-line servers with --pick)",
      pick: "Import only these numbers from the list",
      "profile-per-project": "Create a profile for each Claude Code project",
      paste: "Read Claude's or ChatGPT's answer to --paste-prompt from a file, or stdin with -",
      "paste-prompt": "Print the prompt that asks Claude or ChatGPT to list its cloud connectors",
    },
    maxArgs: 0,
    run: async (p, io) => {
      if (p.values["paste-prompt"]) {
        io.out(PASTE_PROMPT);
        return EXIT_OK;
      }
      const pasteSrc = typeof p.values.paste === "string" ? p.values.paste : undefined;
      let pasted: string | undefined;
      if (pasteSrc !== undefined) {
        try {
          pasted = await readPaste(pasteSrc);
        } catch (e) {
          io.err(`Could not read ${pasteSrc}: ${(e as Error).message}`);
          return EXIT_USAGE;
        }
      }
      const { config, vault, db, paths } = await openState();
      try {
        const have = new Set(
          Object.values(config.servers).map((s) =>
            keyOf(
              s.transport === "stdio"
                ? { transport: "stdio", command: s.command, args: s.args }
                : { transport: s.transport, url: s.url },
            ),
          ),
        );
        const found =
          pasted !== undefined ? pasteCandidates(pasted, io) : mergeFound(scanApps(defaultScanEnv()));
        const list = found.filter((c) => !isThisGateway(c.server, config.gateway.port) && !have.has(c.key));
        if (!list.length) {
          io.out(
            pasted !== undefined
              ? "No new MCP servers with a URL in the pasted text."
              : "No new MCP servers found in your AI apps.",
          );
          return EXIT_OK;
        }
        for (const [i, c] of list.entries()) io.out(`${String(i + 1).padStart(2)}. ${describe(c)}`);
        io.out("Secret values are never copied. Servers marked “needs” ask for those values after import.");
        let picked = list;
        if (typeof p.values.pick === "string") {
          const nums = new Set(p.values.pick.split(",").map((n) => Number(n.trim())));
          picked = list.filter((_, i) => nums.has(i + 1));
        } else if (!p.values.all) {
          io.out("\nRun again with --all, or --pick 1,3 to choose.");
          return EXIT_OK;
        } else {
          // A command-line server runs code on this computer; import one only when picked by number.
          picked = list.filter((c) => c.server.transport !== "stdio");
          const skipped = list.length - picked.length;
          if (skipped)
            io.out(
              `Skipped ${skipped} command-line server(s): they run programs here. Use --pick to choose them.`,
            );
        }
        let cfg = config;
        const outcomes = await applyImport(
          {
            config: () => cfg,
            vault,
            updateConfig: async (mutate: (d: Config) => void) => {
              const draft = structuredClone(cfg);
              mutate(draft);
              const next = validateConfig(draft, paths.config);
              const broken = checkReferences(next);
              if (broken.length) throw new Error(broken.join("\n"));
              saveConfig(paths.config, next);
              cfg = next;
              return cfg;
            },
          },
          picked,
          { profilePerProject: !!p.values["profile-per-project"] },
        );
        const keyed = outcomes.filter((o) => o.status === "skipped-secret").length;
        if (keyed)
          io.out(
            `- ${keyed} server(s) not imported: the address contains a key. Add them by hand so the key stays in the vault.`,
          );
        for (const o of outcomes.filter((o) => o.status === "added")) {
          const next = o.needsSignIn
            ? `sign in: pmcpg account signin ${o.accountId}`
            : o.missingValues?.length
              ? `add values in the web UI (Accounts → ${o.accountId}): ${o.missingValues.join(", ")}`
              : "ready";
          io.out(`+ ${o.accountId}: ${next}${o.probeError ? ` (check: ${o.probeError})` : ""}`);
        }
        await notifyReload(io);
        return EXIT_OK;
      } finally {
        db.close();
      }
    },
  },
  {
    path: ["connect-app"],
    summary: "Point an AI app at the gateway (shows the change; --yes applies it with a backup)",
    args: `<${APPS.join("|")}> [--profile <name>] [--remove <a,b>] [--http] [--yes]`,
    options: {
      profile: { type: "string" },
      remove: { type: "string" },
      http: { type: "boolean" },
      yes: { type: "boolean" },
    },
    optionHelp: {
      http: "Fallback for apps that cannot run a command: writes the URL and the profile token into the app's file",
      profile: "Profile the app connects to (default: all)",
      remove: "Entries to remove from the app because the gateway now provides them",
      yes: "Apply the change (a backup of the app's file is kept)",
    },
    minArgs: 1,
    maxArgs: 1,
    run: async (p, io: Io) => {
      const app = p.positionals[0] as ConnectApp;
      if (!APPS.includes(app)) {
        io.err(`Unknown app "${app}". Choose one of: ${APPS.join(", ")}`);
        return EXIT_USAGE;
      }
      const profile = typeof p.values.profile === "string" ? p.values.profile : "all";
      if (!Slug.safeParse(profile).success) {
        io.err(`Invalid profile name "${profile}".`);
        return EXIT_USAGE;
      }
      const { config, vault, db } = await openState();
      try {
        const input = {
          profile,
          gatewayUrl: `http://127.0.0.1:${config.gateway.port}`,
          token: await ensureToken(vault, vaultKeys.clientToken(profile)),
          pmcpg: selfCommand(),
          remove: typeof p.values.remove === "string" ? p.values.remove.split(",").filter(Boolean) : [],
          transport: p.values.http ? ("http" as const) : ("stdio" as const),
        };
        const env = defaultScanEnv();
        const plan = planConnect(app, input, env);
        io.out(
          `${APP_LABELS[app]}: add “${plan.entryName}”${plan.remove.length ? `, remove ${plan.remove.join(", ")}` : ""}`,
        );
        if (plan.file) io.out(`File: ${plan.file}\n${plan.preview}`);
        if (plan.transport === "http")
          io.out(
            "Fallback: the app's file will hold this profile's token in plain text (shown here as •••).",
          );
        for (const c of plan.commands ?? []) io.out(`$ ${c}`);
        if (!p.values.yes) {
          io.out("\nNothing changed. Run again with --yes to apply.");
          return EXIT_OK;
        }
        const r = await applyConnect(app, input, env);
        if (r.backup) io.out(`Backup: ${r.backup}`);
        const failed = r.ran?.filter((x) => x.code !== 0) ?? [];
        for (const f of failed) io.err(`Failed (${f.code}): ${f.command}`);
        for (const step of plan.after) io.out(`Next: ${step}`);
        return failed.length ? EXIT_ERROR : EXIT_OK;
      } finally {
        db.close();
      }
    },
  },
];
