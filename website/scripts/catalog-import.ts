// Maintainer-only: fetch one server from the official MCP Registry and write a draft entry to
// catalog/servers/<slug>.json. The draft's curation block holds TODO values, so build-catalog.ts refuses
// it until someone reviews it. The gateway never calls the registry.
// Usage: bun scripts/catalog-import.ts <registry-name> [--slug <slug>] [--force]
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { CURATION_KEY } from "../../src/catalog/schema.ts";
import { SOURCES_DIR } from "./catalog-lib.ts";

export const REGISTRY = "https://registry.modelcontextprotocol.io/v0.1";

export const registryUrl = (name: string) =>
  `${REGISTRY}/servers/${encodeURIComponent(name)}/versions/latest`;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): Json[] => (Array.isArray(v) ? v.map(obj) : []);
const pick = (o: Json, keys: string[]): Json =>
  Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const VAR_KEYS = ["name", "description", "isRequired", "isSecret", "format", "default", "choices"];

export interface Draft {
  entry: Json;
  /** What the reviewer must look at beyond the TODO fields. */
  notes: string[];
}

/** Map a registry response (v0.1: { server, _meta }) to a draft Entry. */
export function draftEntry(response: unknown, today = new Date().toISOString().slice(0, 10)): Draft {
  const notes: string[] = [];
  const server = obj(obj(response).server);
  const name = String(server.name ?? "");

  const packages = arr(server.packages).flatMap((p) => {
    const transport = String(obj(p.transport).type ?? "stdio");
    if (transport !== "stdio") {
      notes.push(`Skipped package ${p.identifier}: transport ${transport} (only stdio packages are supported).`);
      return [];
    }
    const args = arr(p.packageArguments).flatMap((a) => {
      if (a.type === "positional" && typeof a.value === "string") return [{ type: "positional", value: a.value }];
      if (a.type === "named" && typeof a.name === "string")
        return [pick({ type: "named", name: a.name, value: a.value }, ["type", "name", "value"])];
      notes.push(`Dropped package argument ${JSON.stringify(a.name ?? a.valueHint ?? a.type)}: not a fixed value.`);
      return [];
    });
    if (p.registryType === "mcpb" && !p.fileSha256) notes.push(`mcpb package ${p.identifier} has no fileSha256.`);
    if (arr(p.runtimeArguments).length) notes.push(`Package ${p.identifier} has runtimeArguments; they are not carried over.`);
    return [
      {
        ...pick(p, ["registryType", "identifier", "version", "fileSha256"]),
        transport: { type: "stdio" },
        packageArguments: args,
        environmentVariables: arr(p.environmentVariables).map((v) => pick(v, VAR_KEYS)),
      },
    ];
  });

  const remotes = arr(server.remotes).map((r) => {
    if (String(r.url ?? "").includes("{")) notes.push(`Remote ${r.url} has URL variables; pick a fixed URL.`);
    return {
      type: r.type,
      url: r.url,
      headers: arr(r.headers).map((h) => pick(h, ["name", "description", "isRequired", "isSecret"])),
    };
  });

  const secretHeaders = remotes.flatMap((r) => r.headers.filter((h) => h.isSecret).map((h) => String(h.name)));
  const secretEnv = packages.flatMap((p) =>
    p.environmentVariables.filter((v) => v.isSecret).map((v) => String(v.name)),
  );

  const entry: Json = {
    ...pick(server, ["name", "title", "description", "version", "repository", "websiteUrl", "icons"]),
    packages,
    remotes,
    _meta: {
      [CURATION_KEY]: {
        tier: "community",
        reviewedAt: today,
        reviewedBy: "TODO: your GitHub handle, and the docs page you read",
        source: registryUrl(name),
        auth: {
          type: secretHeaders.length || secretEnv.length ? "header" : "TODO: none, oauth or header",
          credentials: [...secretHeaders, ...secretEnv],
        },
        trust: ["TODO: local, private-data, external-content, can-send"],
        privacy: "standard",
        audience: ["general"],
        categories: ["TODO"],
        samplePrompt: "TODO: one thing to ask an AI app to try",
      },
    },
  };
  return { entry, notes };
}

/** Default file slug: the server part of the name, e.g. io.github.acme/weather-mcp -> weather-mcp. */
export function defaultSlug(name: string): string {
  const last = name.slice(name.lastIndexOf("/") + 1);
  return (
    last
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 64)
      .replace(/-+$/g, "") || "server"
  );
}

async function main(argv: string[]): Promise<void> {
  const name = argv.find((a) => !a.startsWith("--"));
  const slugAt = argv.indexOf("--slug");
  const slug = slugAt >= 0 ? argv[slugAt + 1] : name && defaultSlug(name);
  if (!name || !slug || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    console.error("Usage: bun scripts/catalog-import.ts <registry-name> [--slug <slug>] [--force]");
    process.exit(2);
  }
  const file = join(SOURCES_DIR, "servers", `${slug}.json`);
  if (existsSync(file) && !argv.includes("--force")) {
    console.error(`${relative(process.cwd(), file)} exists. Pass --force to overwrite, or --slug to pick another name.`);
    process.exit(1);
  }
  const res = await fetch(registryUrl(name), { headers: { accept: "application/json" } });
  if (!res.ok) {
    console.error(`The registry answered ${res.status} for ${name}.`);
    process.exit(1);
  }
  const { entry, notes } = draftEntry(await res.json());
  mkdirSync(join(SOURCES_DIR, "servers"), { recursive: true });
  writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
  console.log(`Wrote draft ${relative(process.cwd(), file)}. Replace every TODO, then run bun scripts/build-catalog.ts.`);
  for (const n of notes) console.log(`- ${n}`);
}

if (import.meta.main) await main(process.argv.slice(2));
