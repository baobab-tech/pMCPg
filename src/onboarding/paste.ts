// Parse a chatbot's list of its cloud connectors (claude.ai, ChatGPT) pasted by the user.
// The text is untrusted data: it is only scanned for names and URLs, never followed, fetched or obeyed.
// Probing happens later, only for entries the user picks.
import { urlSecrets } from "../core/config-store.ts";
import { type Candidate, keyOf, stripSecretParams } from "./importers.ts";
import { KNOWN_BUILTINS, KNOWN_ENDPOINTS } from "./known-endpoints.ts";
import { suggestId } from "./probe.ts";

export const MAX_PASTE_CHARS = 100_000;
export const MAX_PASTE_ENTRIES = 50;

export type PasteAuth = "oauth" | "key" | "none" | "unknown";

export interface PastedServer {
  name: string;
  /** Cleaned URL: no credentials, no secret-looking query parameters, no fragment. */
  url?: string;
  /** What the pasted text said about sign-in. A hint only; probing decides. */
  auth: PasteAuth;
  /** ready: has a usable URL. url-needed: name only. built-in: not an MCP server. rejected: unusable URL. */
  status: "ready" | "url-needed" | "built-in" | "rejected";
  /** Plain-words reason for url-needed, built-in and rejected; source of a filled-in URL. */
  note?: string;
  /** The URL came from the built-in list of public endpoints, not from the pasted text. */
  knownUrl?: boolean;
  /** Query parameters removed from the URL because they looked like secrets (names only). */
  secretParams: string[];
  suggestedId: string;
  /** Same key as import candidates, for ready entries. */
  key?: string;
}

export interface PasteResult {
  servers: PastedServer[];
  /** The text or the list was cut to the limits. */
  truncated: boolean;
}

/** Ask the chatbot for a strict, easy-to-parse answer. Works for Claude and ChatGPT. */
export const PASTE_PROMPT = `List every MCP server, connector and app you can use in this account: custom connectors, developer mode connectors, and connectors from the directory.

Answer with one fenced JSON code block and nothing else. Use exactly this shape:

\`\`\`json
[
  { "name": "Example", "url": "https://mcp.example.com/mcp", "auth": "oauth", "builtin": false }
]
\`\`\`

Rules:
- "name": the connector's name as shown in settings.
- "url": the exact MCP server URL if you know it, otherwise null. Do not guess.
- "auth": "oauth" for a sign-in, "key" for an API key or token, "none" for neither, "unknown" if unsure.
- "builtin": true for features built into you that are not MCP servers (for example web search or a built-in Google Drive connector).
- Never include API keys, tokens, passwords or other secrets, even if you can see them. Leave out any part of a URL that holds one.
- If you have none, answer [].`;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isLocalHost = (h: string) => LOCAL_HOSTS.has(h) || h.endsWith(".localhost");

/** Hosts of the chat apps themselves: a link there is a settings page, not an MCP server. */
const CHAT_APP_HOST = /(^|\.)(chatgpt\.com|openai\.com|claude\.ai|claude\.com|anthropic\.com)$/i;

type UrlCheck =
  | { ok: true; url: string; secretParams: string[] }
  | { ok: false; url?: string; reason: string };

/** https only (http for localhost), no credentials, secret-looking query parameters removed. */
export function cleanPastedUrl(raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Not a valid URL." };
  }
  u.username = "";
  u.password = "";
  u.hash = "";
  const { url, removed } = stripSecretParams(u.toString());
  if (u.protocol === "http:" && !isLocalHost(u.hostname))
    return { ok: false, url, reason: "Uses plain http. Only https is accepted (http only for localhost)." };
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "Not a web address." };
  if (CHAT_APP_HOST.test(u.hostname))
    return { ok: false, url, reason: "A link to the chat app itself, not an MCP server." };
  if (urlSecrets(url).includes("the path"))
    return {
      ok: false,
      reason: "The address contains a key or token. Add this server by hand so the key stays in the vault.",
    };
  return { ok: true, url, secretParams: removed };
}

/** Tokens, keys and "password: x" phrases. Names that look like this are dropped. */
const SECRET_TEXT =
  /\b(sk|pk|rk|ghp|gho|ghs|ghu|github_pat|glpat|xox[abpr]|AKIA|AIza|ya29)[-_.]?[A-Za-z0-9]{6,}|\bbearer\s+\S|\beyJ[A-Za-z0-9_-]{10,}|\b(api[ _-]?key|token|password|passwd|secret)\s*[:=]\s*\S/i;
function looksSecret(s: string): boolean {
  if (SECRET_TEXT.test(s)) return true;
  // One long run of mixed letters and digits: a key, not a name.
  return s.split(/\s+/).some((w) => w.length >= 20 && /[a-z]/i.test(w) && /\d/.test(w));
}

/** Words chatbots add around a name: "Linear MCP server", "Notion connector". */
const FILLER =
  /\b(mcp|server|servers|connector|connectors|app|apps|official|remote|integration|custom|the)\b/gi;
export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(FILLER, " ")
    .replace(/[^a-z0-9]+/g, "");
}

function cleanName(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[*_`#>[\]]+/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s:–—-]+|[\s:–—-]+$/g, "")
    .trim()
    .slice(0, 60);
}

function authOf(v: unknown): PasteAuth {
  if (typeof v !== "string") return "unknown";
  const s = v.toLowerCase();
  if (/oauth|sign[ -]?in|log[ -]?in/.test(s)) return "oauth";
  if (/no(ne| auth| sign)|public|open/.test(s)) return "none";
  if (/key|token|bearer|header/.test(s)) return "key";
  return "unknown";
}

interface Raw {
  name?: string;
  url?: string;
  auth: PasteAuth;
  builtin?: boolean;
}

const URL_RE = /https?:\/\/[^\s<>"'`|\\)\]]+/gi;
const urlsIn = (s: string) => (s.match(URL_RE) ?? []).map((u) => u.replace(/[.,;:!?]+$/, ""));

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

function fromJsonItem(v: unknown): Raw | undefined {
  if (typeof v === "string") return { name: v, auth: "unknown" };
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const name = str(o.name) ?? str(o.title) ?? str(o.label);
  const url = str(o.url) ?? str(o.server_url) ?? str(o.serverUrl) ?? str(o.endpoint) ?? str(o.mcp_url);
  if (!name && !url) return undefined;
  return {
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
    auth: authOf(o.auth ?? o.authentication ?? o.auth_type),
    ...(o.builtin === true || o.built_in === true ? { builtin: true } : {}),
  };
}

function tryJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    // Chatbots sometimes leave trailing commas.
    try {
      return JSON.parse(s.replace(/,\s*([\]}])/g, "$1"));
    } catch {
      return undefined;
    }
  }
}

/** JSON in a code fence, or the whole text as JSON. Undefined when there is no usable JSON. */
function parseJson(text: string): Raw[] | undefined {
  const blocks = [...text.matchAll(/```[a-z]*\s*\n([\s\S]*?)```/gi)].map((m) => m[1] as string);
  const t = text.trim();
  if (t.startsWith("[") || t.startsWith("{")) blocks.push(t);
  for (const b of blocks) {
    let v = tryJson(b.trim());
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      v = o.connectors ?? o.servers ?? o.mcpServers ?? o.apps ?? [o];
    }
    if (!Array.isArray(v)) continue;
    return v.map(fromJsonItem).filter((r): r is Raw => !!r);
  }
  return undefined;
}

/** Markdown tables, bullet lists and prose, one line at a time. */
function parseLines(text: string): Raw[] {
  const out: Raw[] = [];
  let header: string[] | undefined;
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || /^```/.test(l)) continue;
    if (l.startsWith("|")) {
      const cells = l
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c) || c === "")) continue;
      if (!header && !urlsIn(l).length && cells.some((c) => /name|url|endpoint|auth/i.test(c))) {
        header = cells.map((c) => c.toLowerCase());
        continue;
      }
      const col = (re: RegExp) => header?.findIndex((h) => re.test(h)) ?? -1;
      const ni = col(/name|connector|server|app/);
      const ai = col(/auth|sign/);
      const name = cleanName(cells[ni >= 0 ? ni : 0] ?? "");
      const url = urlsIn(l)[0];
      out.push({
        ...(name ? { name } : {}),
        ...(url ? { url } : {}),
        auth: authOf(ai >= 0 ? cells[ai] : l),
      });
      continue;
    }
    header = undefined;
    const bullet = l.match(/^(?:[-*•+]|\d+[.)])\s+(.*)$/);
    const urls = urlsIn(l);
    if (!bullet && !urls.length) continue; // prose without a URL
    const body = bullet ? (bullet[1] as string) : l;
    // "Linear: https://…", "**Linear** — …", "Linear (OAuth)"
    const bold = body.match(/\*\*([^*]+)\*\*/)?.[1];
    const lead = body.split(/\s[–—-]\s|:\s|\s\(|https?:\/\//)[0] ?? "";
    let name = cleanName(bold ?? lead);
    // Prose lines carry sentences, not names: name those after their URL's host.
    if (!bullet && name.split(" ").length > 4) name = "";
    // Broken JSON lines and lines holding a secret give no name.
    if (/^[[{"]/.test(body) || looksSecret(body.replace(URL_RE, ""))) name = "";
    if (urls.length) for (const url of urls) out.push({ ...(name ? { name } : {}), url, auth: authOf(body) });
    else if (name) out.push({ name, auth: authOf(body) });
  }
  return out;
}

/** Slug from a name, for entries without a usable URL. */
function idFor(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40)
      .replace(/-+$/, "") || "server"
  );
}

function lookup(name: string): (typeof KNOWN_ENDPOINTS)[number] | undefined {
  const n = normalizeName(name);
  return n ? KNOWN_ENDPOINTS.find((k) => k.names.some((a) => normalizeName(a) === n)) : undefined;
}
function isBuiltin(name: string): boolean {
  const n = normalizeName(name);
  return !!n && KNOWN_BUILTINS.some((b) => normalizeName(b) === n);
}

function resolve(r: Raw): PastedServer | undefined {
  let name = r.name && !looksSecret(r.name) ? cleanName(r.name) : "";
  let url = r.url;
  // A secret pasted where a URL should be: drop the URL, keep the name.
  if (url && !/^https?:\/\//i.test(url.trim())) url = undefined;
  if (!name && !url) return undefined;
  const base = { auth: r.auth, secretParams: [] as string[] };

  if (url) {
    const c = cleanPastedUrl(url);
    if (!name) {
      try {
        name = new URL(c.url ?? url).hostname;
      } catch {
        name = "Unnamed";
      }
    }
    if (!c.ok)
      return {
        ...base,
        name,
        ...(c.url ? { url: c.url } : {}),
        status: "rejected",
        note: c.reason,
        suggestedId: idFor(name),
      };
    return {
      ...base,
      name,
      url: c.url,
      status: "ready",
      secretParams: c.secretParams,
      suggestedId: suggestId(c.url, name),
      key: keyOf({ transport: "http", url: c.url }),
    };
  }

  const known = lookup(name);
  if (known)
    return {
      ...base,
      name,
      url: known.url,
      auth: r.auth === "unknown" ? known.auth : r.auth,
      status: "ready",
      knownUrl: true,
      note: `URL from ${known.vendor}'s documentation.`,
      suggestedId: suggestId(known.url, name),
      key: keyOf({ transport: "http", url: known.url }),
    };
  if (r.builtin || isBuiltin(name))
    return {
      ...base,
      name,
      status: "built-in",
      note: "Built into the chat app, not an MCP server. It can't be moved.",
      suggestedId: idFor(name),
    };
  return {
    ...base,
    name,
    status: "url-needed",
    note: "No URL given. Paste the server's URL if you know it.",
    suggestedId: idFor(name),
  };
}

/** Parse pasted text into servers. Never fetches anything. */
export function parsePasted(input: string): PasteResult {
  let truncated = input.length > MAX_PASTE_CHARS;
  const text = input.slice(0, MAX_PASTE_CHARS);
  const raws = parseJson(text) ?? parseLines(text);
  const seen = new Set<string>();
  const servers: PastedServer[] = [];
  for (const r of raws) {
    const s = resolve(r);
    if (!s) continue;
    const id = s.key ?? (s.url ? `rejected:${s.url}` : `name:${normalizeName(s.name)}`);
    if (seen.has(id)) continue;
    seen.add(id);
    if (servers.length >= MAX_PASTE_ENTRIES) {
      truncated = true;
      break;
    }
    servers.push(s);
  }
  return { servers, truncated };
}

/** A user-picked entry as an import candidate. The URL is checked again: the client may have changed it. */
export function pastedCandidate(
  name: string,
  rawUrl: string,
  secretParams: string[] = [],
): Candidate | { error: string } {
  const c = cleanPastedUrl(rawUrl);
  if (!c.ok) return { error: c.reason };
  const safeName = looksSecret(name) ? "" : cleanName(name);
  return {
    key: keyOf({ transport: "http", url: c.url }),
    suggestedId: suggestId(c.url, safeName || undefined),
    server: { transport: /\/sse\/?$/.test(new URL(c.url).pathname) ? "sse" : "http", url: c.url },
    envNames: [],
    headerNames: [],
    secretParams: [...new Set([...c.secretParams, ...secretParams])],
    foundIn: [],
  };
}
