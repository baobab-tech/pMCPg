// `pmcpg catalog search` and `pmcpg catalog show`. Registered in commands.ts. The user asked, so a fetch is
// allowed: they refresh a cache older than 24 h, then read cache or bundled snapshot (docs/catalog.md).
import { existsSync } from "node:fs";
import { join } from "node:path";
import { type CatalogView, curation, type Entry, type Tier } from "../catalog/schema.ts";
import { CatalogService } from "../catalog/service.ts";
import { entryToConfig } from "../catalog/to-config.ts";
import { loadConfig } from "../core/config-store.ts";
import { paths } from "../core/paths.ts";
import { type Command, EXIT_ERROR, EXIT_OK, EXIT_USAGE, type Io, type Parsed } from "./cli.ts";

/** Kill switch for the whole command group. Off: nothing in pmcpg contacts a catalog URL. */
export const CATALOG_ENABLED = true;

export const CATALOG_SOON =
  "A searchable catalog of MCP servers is coming soon. For now, add a server by its URL " +
  "(pmcpg server add <name> --url <url>) or import it from your AI apps (pmcpg import).";

/** A cache older than this is refreshed before searching. */
export const CATALOG_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface CatalogCliDeps {
  enabled?: boolean;
  /** Default: the data directory's cache, the production URL and keys. */
  service?: CatalogService;
}

function defaultService(): CatalogService {
  const p = paths();
  return new CatalogService({
    dir: join(p.dir, "catalog"),
    enabled: () => !existsSync(p.config) || loadConfig(p.config).catalog.enabled,
  });
}

async function current(svc: CatalogService, io: Io): Promise<CatalogView> {
  const age = svc.cacheAgeMs();
  const view = age === undefined || age > CATALOG_MAX_AGE_MS ? await svc.refresh() : await svc.view();
  if (view.error) io.err(view.error);
  return view;
}

const TIER_ORDER: Record<Tier, number> = { "baobab-built": 0, approved: 1, community: 2 };

function haystack(e: Entry): string {
  const c = curation(e);
  return [e.name, e.title ?? "", e.description, ...c.categories, ...c.audience].join("\n").toLowerCase();
}

/** Entries holding every word (case-insensitive), best tier first. */
export function searchEntries(entries: Entry[], words: string[]): Entry[] {
  const terms = words.flatMap((w) => w.toLowerCase().split(/\s+/)).filter(Boolean);
  return entries
    .filter((e) => {
      const h = haystack(e);
      return terms.every((t) => h.includes(t));
    })
    .sort(
      (a, b) => TIER_ORDER[curation(a).tier] - TIER_ORDER[curation(b).tier] || a.name.localeCompare(b.name),
    );
}

function oneLine(text: string, max = 80): string {
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export async function catalogSearch(p: Parsed, io: Io, deps: CatalogCliDeps = {}): Promise<number> {
  if (!(deps.enabled ?? CATALOG_ENABLED)) {
    io.err(CATALOG_SOON);
    return EXIT_USAGE;
  }
  const view = await current(deps.service ?? defaultService(), io);
  if (!view.serial) return EXIT_ERROR;
  const hits = searchEntries(view.entries, p.positionals);
  if (!hits.length) {
    io.err(`No catalog entries match "${p.positionals.join(" ")}" (catalog serial ${view.serial}).`);
    return EXIT_OK;
  }
  const width = Math.max(...hits.map((e) => e.name.length));
  for (const e of hits) {
    const c = curation(e);
    io.out(
      `${e.name.padEnd(width)}  ${c.tier.padEnd(12)}  ${c.auth.type.padEnd(6)}  ${oneLine(e.title ? `${e.title}: ${e.description}` : e.description)}`,
    );
  }
  io.err(`${hits.length} of ${view.entries.length} entries. Details: pmcpg catalog show <name>`);
  return EXIT_OK;
}

export async function catalogShow(p: Parsed, io: Io, deps: CatalogCliDeps = {}): Promise<number> {
  if (!(deps.enabled ?? CATALOG_ENABLED)) {
    io.err(CATALOG_SOON);
    return EXIT_USAGE;
  }
  const view = await current(deps.service ?? defaultService(), io);
  if (!view.serial) return EXIT_ERROR;
  const name = p.positionals[0] ?? "";
  const entry =
    view.entries.find((e) => e.name === name) ??
    view.entries.find((e) => e.name.toLowerCase() === name.toLowerCase());
  if (!entry) {
    const near = searchEntries(view.entries, [name.slice(name.lastIndexOf("/") + 1)]).slice(0, 5);
    io.err(`No catalog entry is named "${name}".`);
    if (near.length) io.err(`Did you mean: ${near.map((e) => e.name).join(", ")}`);
    return EXIT_ERROR;
  }
  io.out(JSON.stringify(entry, null, 2));
  const r = entryToConfig(entry);
  io.out("");
  if (!r.ok) {
    io.out(`Not added automatically: ${r.reason}`);
    return EXIT_OK;
  }
  const { serverId, server, accountId, account, needs } = r.config;
  io.out("As config.yaml:");
  io.out(
    Bun.YAML.stringify({ servers: { [serverId]: server }, accounts: { [accountId]: account } }, null, 2),
  );
  const missing = [...needs.env, ...needs.headers];
  if (missing.length) io.out(`Needs a value for: ${missing.join(", ")}`);
  return EXIT_OK;
}

export const catalogCommands: Command[] = [
  {
    path: ["catalog", "search"],
    summary: "Search the public catalog of MCP servers",
    args: "<words>...",
    minArgs: 1,
    maxArgs: Number.POSITIVE_INFINITY,
    run: (p, io) => catalogSearch(p, io),
  },
  {
    path: ["catalog", "show"],
    summary: "Show one catalog entry and the config it would add",
    args: "<name>",
    minArgs: 1,
    maxArgs: 1,
    run: (p, io) => catalogShow(p, io),
  },
];
