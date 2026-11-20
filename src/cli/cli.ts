// Command registry, argument parsing (node:util parseArgs) and help output.
import { type ParseArgsConfig, parseArgs } from "node:util";

export interface Io {
  out: (line: string) => void;
  err: (line: string) => void;
}

type Options = NonNullable<ParseArgsConfig["options"]>;

export interface Parsed {
  values: Record<string, string | boolean | (string | boolean)[] | undefined>;
  positionals: string[];
}

export interface Command {
  /** Words that select the command, e.g. ["service", "install"]. */
  path: string[];
  summary: string;
  /** Text after `pmcpg <path>` in the usage line. */
  args?: string;
  options?: Options;
  /** Option descriptions for help, keyed by option name. */
  optionHelp?: Record<string, string>;
  minArgs?: number;
  maxArgs?: number;
  run: (p: Parsed, io: Io) => number | Promise<number>;
}

/** Exit codes: 0 success, 1 runtime error, 2 usage error or command not wired yet. */
export const EXIT_OK = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;

const HELP_OPTION: Options = { help: { type: "boolean", short: "h" } };

export function usageLine(c: Command): string {
  return `pmcpg ${c.path.join(" ")}${c.args ? ` ${c.args}` : ""}`;
}

export function commandHelp(c: Command): string {
  const lines = [c.summary, "", `Usage: ${usageLine(c)}`];
  const opts = Object.entries(c.options ?? {});
  if (opts.length) {
    lines.push("", "Options:");
    for (const [name, o] of opts) {
      const flag = `${o.short ? `-${o.short}, ` : "    "}--${name}${o.type === "string" ? " <value>" : ""}`;
      lines.push(`  ${flag.padEnd(26)}${c.optionHelp?.[name] ?? ""}`);
    }
  }
  lines.push("", `  ${"-h, --help".padEnd(26)}Show this help`);
  return lines.join("\n");
}

/** Help for the top level (prefix []) or for a group such as ["service"]. */
export function groupHelp(commands: Command[], prefix: string[], version: string): string {
  const matching = commands.filter((c) => prefix.every((w, i) => c.path[i] === w));
  const width = Math.max(...matching.map((c) => usageLine(c).length)) + 2;
  const head =
    prefix.length === 0
      ? [`pmcpg ${version}: Private MCP Gateway`, "", "Usage: pmcpg <command> [options]"]
      : [`Usage: pmcpg ${prefix.join(" ")} <command> [options]`];
  return [
    ...head,
    "",
    "Commands:",
    ...matching.map((c) => `  ${usageLine(c).padEnd(width)}${c.summary}`),
    "",
    "Run `pmcpg <command> --help` for details.",
  ].join("\n");
}

/** Finds the longest command path that prefixes argv. */
function resolve(commands: Command[], argv: string[]): { command?: Command; depth: number } {
  let best: Command | undefined;
  for (const c of commands) {
    if (c.path.every((w, i) => argv[i] === w) && (!best || c.path.length > best.path.length)) best = c;
  }
  if (best) return { command: best, depth: best.path.length };
  let depth = 0;
  while (depth < argv.length && commands.some((c) => c.path.length > depth && c.path[depth] === argv[depth]))
    depth++;
  return { depth };
}

export async function runCli(commands: Command[], argv: string[], io: Io, version: string): Promise<number> {
  const [first] = argv;
  if (first === undefined || first === "--help" || first === "-h") {
    io.out(groupHelp(commands, [], version));
    return first === undefined ? EXIT_USAGE : EXIT_OK;
  }
  if (first === "--version" || first === "-v") {
    io.out(version);
    return EXIT_OK;
  }
  if (first === "help") return runCli(commands, [...argv.slice(1), "--help"], io, version);

  const { command, depth } = resolve(commands, argv);
  if (!command) {
    const prefix = argv.slice(0, depth);
    if (depth === 0) {
      io.err(`Unknown command: ${first}`);
      io.err(groupHelp(commands, [], version));
      return EXIT_USAGE;
    }
    const rest = argv[depth];
    if (rest === "--help" || rest === "-h") {
      io.out(groupHelp(commands, prefix, version));
      return EXIT_OK;
    }
    if (rest !== undefined) io.err(`Unknown command: pmcpg ${[...prefix, rest].join(" ")}`);
    io.err(groupHelp(commands, prefix, version));
    return EXIT_USAGE;
  }

  let parsed: Parsed;
  try {
    const r = parseArgs({
      args: argv.slice(depth),
      options: { ...command.options, ...HELP_OPTION },
      allowPositionals: true,
      strict: true,
    });
    parsed = { values: r.values, positionals: r.positionals };
  } catch (e) {
    io.err(`${e instanceof Error ? e.message : String(e)}\nUsage: ${usageLine(command)}`);
    return EXIT_USAGE;
  }
  if (parsed.values.help) {
    io.out(commandHelp(command));
    return EXIT_OK;
  }
  const n = parsed.positionals.length;
  if (n < (command.minArgs ?? 0) || n > (command.maxArgs ?? 0)) {
    io.err(`Wrong number of arguments.\nUsage: ${usageLine(command)}`);
    return EXIT_USAGE;
  }
  try {
    return await command.run(parsed, io);
  } catch (e) {
    io.err(`Error: ${e instanceof Error ? e.message : String(e)}`);
    return EXIT_ERROR;
  }
}
