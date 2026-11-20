// `pmcpg catalog search`: the public catalog is not built yet (docs/catalog.md). Registered in commands.ts.
// v0.1 makes no catalog request: the command prints a "coming soon" note and exits.
import { type Command, EXIT_USAGE, type Io, type Parsed } from "./cli.ts";

/** Off until the public catalog exists. While off, nothing in pmcpg contacts a catalog URL. */
export const CATALOG_ENABLED = false;

export const CATALOG_SOON =
  "A searchable catalog of MCP servers is coming soon. For now, add a server by its URL " +
  "(pmcpg server add <name> --url <url>) or import it from your AI apps (pmcpg import).";

/** The command body. Exits 2, like other commands that are not built yet. `enabled` is a parameter so tests can reach both branches. */
export function catalogSearch(_p: Parsed, io: Io, enabled = CATALOG_ENABLED): number {
  if (!enabled) {
    io.err(CATALOG_SOON);
    return EXIT_USAGE;
  }
  io.err("pmcpg catalog search: not wired yet");
  return EXIT_USAGE;
}

export const catalogCommands: Command[] = [
  {
    path: ["catalog", "search"],
    summary: "Search the public catalog (coming soon)",
    args: "<query>...",
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    run: (p, io) => catalogSearch(p, io),
  },
];
