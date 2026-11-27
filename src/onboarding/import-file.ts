// biome-ignore-all lint/suspicious/noTemplateCurlyInString: ${NAME} and ${HOME} are the placeholder syntax other apps write
// Import servers from a file: pMCPg's own export, or any app's MCP config (JSON, YAML or TOML).
// Treated as data from someone else: values are never read, only names, commands and URLs.
import { type Candidate, type Found, mergeFound, parseEntry } from "./importers.ts";

export const MAX_FILE_CHARS = 200_000;
export const MAX_FILE_SERVERS = 100;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const keys = (v: unknown): string[] => (isObj(v) ? Object.keys(v) : []);
const strs = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
/** Names only: the values the file gives are dropped. */
const named = (names: string[]) => Object.fromEntries(names.map((n) => [n, ""]));

function parseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {}
  try {
    return Bun.TOML.parse(text);
  } catch {}
  try {
    return Bun.YAML.parse(text);
  } catch {}
  return undefined;
}

/** `${NAME}`, `${input:id}`, `${env:NAME}` in an argument become values the user fills in; `${HOME}` is this home. */
function placeholderArgs(args: string[], home: string): string[] {
  const marker = (name: string) => `{{arg-secret:${name.toUpperCase().replace(/[^A-Z0-9_]/g, "_")}}}`;
  const last = (key: string) => key.split("/").pop() ?? key;
  return args.map((a) =>
    /^vault:[\w./@-]+$/.test(a)
      ? marker(last(a.slice(6)))
      : a
          .replace(/\$\{(?:(?:input|env):)?([\w.-]+)\}/g, (_, name: string) =>
            name === "HOME" ? home : marker(name),
          )
          // pMCPg's own config: vault references in arguments.
          .replace(/\{\{vault:([\w./@-]+)\}\}/g, (_, key: string) => marker(last(key))),
  );
}

/** One entry in the common `{ command, args, env } | { url, type, headers }` shape, from each app's own shape. */
function commonEntries(doc: Obj): {
  entries: [string, Obj][];
  format: string;
  secretParams?: Map<string, string[]>;
} {
  if (isObj(doc.mcp_servers)) {
    const entries = Object.entries(doc.mcp_servers).flatMap(([name, r]): [string, Obj][] => {
      if (!isObj(r)) return [];
      if (typeof r.url === "string") {
        const headers = [
          ...(typeof r.bearer_token_env_var === "string" ? ["Authorization"] : []),
          ...keys(r.http_headers),
          ...keys(r.env_http_headers),
        ];
        return [[name, { url: r.url, type: "http", headers: named(headers) }]];
      }
      return [
        [name, { command: r.command, args: r.args, env: named([...keys(r.env), ...strs(r.env_vars)]) }],
      ];
    });
    return { entries, format: "Codex" };
  }
  if (isObj(doc.extensions)) {
    const entries = Object.entries(doc.extensions).flatMap(([name, r]): [string, Obj][] => {
      if (!isObj(r)) return [];
      if (typeof r.uri === "string")
        return [
          [name, { url: r.uri, type: r.type === "sse" ? "sse" : "http", headers: named(keys(r.headers)) }],
        ];
      if (typeof r.cmd !== "string") return []; // built-in Goose extensions
      return [[name, { command: r.cmd, args: r.args, env: named([...keys(r.envs), ...strs(r.env_keys)]) }]];
    });
    return { entries, format: "Goose" };
  }
  if (
    isObj(doc.servers) &&
    Object.values(doc.servers).some((s) => isObj(s) && typeof s.transport === "string")
  ) {
    // pMCPg config.yaml: env and headers can sit on the server or its accounts.
    const accounts = Object.values(isObj(doc.accounts) ? doc.accounts : {}).filter(isObj);
    const secretParams = new Map<string, string[]>();
    const entries = Object.entries(doc.servers).flatMap(([id, s]): [string, Obj][] => {
      if (!isObj(s)) return [];
      const mine = accounts.filter((a) => a.server === id);
      const auth = mine.map((a) => (isObj(a.auth) ? a.auth : {}));
      secretParams.set(id, [...new Set(mine.flatMap((a) => keys(a.urlParams)))]);
      if (s.transport === "stdio")
        return [
          [
            id,
            {
              command: s.command,
              args: s.args,
              env: named([...keys(s.env), ...mine.flatMap((a) => keys(a.env))]),
            },
          ],
        ];
      return [[id, { url: s.url, type: s.transport, headers: named(auth.flatMap((a) => keys(a.headers))) }]];
    });
    return { entries, format: "pMCPg", secretParams };
  }
  const map = isObj(doc.mcpServers) ? doc.mcpServers : isObj(doc.servers) ? doc.servers : doc.context_servers;
  const format = isObj(doc.mcpServers) ? "mcpServers" : isObj(doc.servers) ? "VS Code" : "Zed";
  const entries = Object.entries(isObj(map) ? map : {}).flatMap(([name, r]): [string, Obj][] => {
    if (!isObj(r)) return [];
    // Gemini CLI: httpUrl is Streamable HTTP, url is SSE.
    if (typeof r.httpUrl === "string") return [[name, { ...r, url: r.httpUrl, type: "http" }]];
    // Older Zed: { command: { path, args, env } }.
    if (isObj(r.command))
      return [[name, { command: r.command.path, args: r.command.args, env: r.command.env }]];
    return [[name, r]];
  });
  return { entries, format };
}

export interface FileImport {
  /** Which shape the file had: "mcpServers", "VS Code", "Codex", "pMCPg"… */
  format: string;
  candidates: Candidate[];
  truncated: boolean;
}

export function parseServerFile(
  text: string,
  fileName: string,
  home: string,
): FileImport | { error: string } {
  if (text.length > MAX_FILE_CHARS) return { error: "The file is too large for a server list." };
  const doc = parseText(text);
  if (!isObj(doc)) return { error: "This isn't a JSON, YAML or TOML file." };
  const { entries, format, secretParams } = commonEntries(doc);
  if (!entries.length) return { error: "No MCP servers found in this file." };
  const truncated = entries.length > MAX_FILE_SERVERS;
  const found = entries.slice(0, MAX_FILE_SERVERS).flatMap(([name, raw]): Found[] => {
    const entry =
      typeof raw.command === "string"
        ? {
            ...raw,
            command: raw.command.split("${HOME}").join(home),
            args: placeholderArgs(strs(raw.args), home),
          }
        : raw;
    // The app field only labels where a server came from; the API relabels these as this file.
    const f = parseEntry("claude-code", name, fileName, entry);
    if (!f) return [];
    if (f.server.transport === "stdio") {
      const fromArgs = f.server.args.flatMap((a) =>
        [...a.matchAll(/\{\{arg-secret:([A-Z0-9_]+)\}\}/g)].map((m) => m[1] as string),
      );
      f.envNames = [...new Set([...f.envNames, ...fromArgs])];
    }
    const params = secretParams?.get(name) ?? [];
    if (params.length) f.secretParams = [...new Set([...(f.secretParams ?? []), ...params])];
    return [f];
  });
  return { format, candidates: mergeFound(found), truncated };
}
