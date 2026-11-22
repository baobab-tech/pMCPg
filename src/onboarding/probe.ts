// Probe a remote MCP server URL: is it reachable, which transport, and how do we sign in?
// Same discovery a client like Claude runs: an unauthenticated request, then RFC 9728 / RFC 8414 metadata.
import { discoverOAuthServerInfo, extractWWWAuthenticateParams } from "@modelcontextprotocol/client";
import { guardedFetch } from "../connectors/guarded-fetch.ts";
import { checkRemoteUrl } from "../connectors/remote-url.ts";

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

export type ProbeAuth =
  | { type: "none" }
  | {
      type: "oauth";
      /** Authorization server, shown as "Sign in with <host>". */
      issuer: string;
      /** How pMCPg can register as a client: dynamic registration, a client ID document, or a pasted client ID. */
      registration: "dcr" | "cimd" | "manual";
      scopes?: string[];
    }
  /** A 401/403 with no OAuth metadata: the server wants a key in a header. */
  | { type: "header"; hint: string };

export type ProbeResult =
  | {
      ok: true;
      url: string;
      transport: "http" | "sse";
      auth: ProbeAuth;
      /** Server name from its initialize answer, when it answered without auth. */
      serverName?: string;
      /** Suggested slug for config.yaml, from the server name or host. */
      suggestedId: string;
    }
  | { ok: false; url: string; error: string };

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "pmcpg-probe", version: "0" },
  },
});

/** "mcp.linear.app" -> "linear"; "api.example-search.com" -> "example-search". */
export function suggestId(url: string, serverName?: string): string {
  const fromName = serverName
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (fromName && fromName.length >= 2 && fromName.length <= 40) return fromName;
  const host = new URL(url).hostname.toLowerCase();
  const parts = host.split(".").filter((p) => !["www", "mcp", "api", "app", "server"].includes(p));
  const base = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  const slug = (base ?? "server").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.slice(0, 40) || "server";
}

async function authFrom(res: Response, url: string, fetchFn: FetchLike, cimdOk: boolean): Promise<ProbeAuth> {
  const params = extractWWWAuthenticateParams(res);
  try {
    const info = await discoverOAuthServerInfo(url, {
      ...(params.resourceMetadataUrl ? { resourceMetadataUrl: params.resourceMetadataUrl } : {}),
      fetchFn,
    });
    const md = info.authorizationServerMetadata;
    if (md?.authorization_endpoint && md.token_endpoint) {
      const scopes =
        params.scope?.split(" ").filter(Boolean) ??
        (info.resourceMetadata?.scopes_supported as string[] | undefined);
      const cimd = (md as Record<string, unknown>).client_id_metadata_document_supported === true;
      return {
        type: "oauth",
        issuer: md.issuer ?? info.authorizationServerUrl,
        // MCP order: a client ID document first, then dynamic registration, then a pasted client ID.
        registration: cimd && cimdOk ? "cimd" : md.registration_endpoint ? "dcr" : "manual",
        ...(scopes?.length ? { scopes } : {}),
      };
    }
  } catch {
    // No usable OAuth metadata: fall through to header auth.
  }
  return {
    type: "header",
    hint: "This server needs a key. Most use the Authorization header: Bearer <key>.",
  };
}

/** Pull serverInfo.name from a JSON or SSE initialize answer. */
async function serverNameOf(res: Response): Promise<string | undefined> {
  const text = await res.text().catch(() => "");
  const json = text.trimStart().startsWith("{")
    ? text
    : text
        .split("\n")
        .find((l) => l.startsWith("data:"))
        ?.slice(5);
  try {
    const name = (JSON.parse(json ?? "") as { result?: { serverInfo?: { name?: unknown } } }).result
      ?.serverInfo?.name;
    return typeof name === "string" ? name : undefined;
  } catch {
    return undefined;
  }
}

export async function probeServer(
  rawUrl: string,
  opts: {
    fetch?: FetchLike;
    allowInsecure?: boolean;
    timeoutMs?: number;
    /** False when this gateway has no usable client ID document (see clientMetadataUrlFor). Default true. */
    cimd?: boolean;
  } = {},
): Promise<ProbeResult> {
  let url: string;
  try {
    url = new URL(rawUrl.trim()).toString();
  } catch {
    return { ok: false, url: rawUrl, error: "This is not a valid URL." };
  }
  const problem = checkRemoteUrl(url, opts.allowInsecure ?? false);
  if (problem) return { ok: false, url, error: problem };

  // Every request, discovery included: timeout, size cap, https or loopback, each redirect re-checked.
  const fetchFn = guardedFetch({
    fetch: opts.fetch,
    timeoutMs: opts.timeoutMs,
    httpOrigin: opts.allowInsecure ? new URL(url).origin : undefined,
  });
  let res: Response;
  try {
    res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: INITIALIZE,
    });
  } catch (e) {
    return { ok: false, url, error: `Could not reach the server: ${(e as Error).message}` };
  }

  if (res.ok) {
    const serverName = await serverNameOf(res);
    return {
      ok: true,
      url,
      transport: "http",
      auth: { type: "none" },
      serverName,
      suggestedId: suggestId(url, serverName),
    };
  }
  if (res.status === 401 || res.status === 403) {
    const auth = await authFrom(res, url, fetchFn, opts.cimd ?? true);
    return { ok: true, url, transport: "http", auth, suggestedId: suggestId(url) };
  }

  // Older servers only speak HTTP+SSE: GET opens the event stream.
  if ([400, 404, 405].includes(res.status)) {
    try {
      const sse = await fetchFn(url, {
        method: "GET",
        headers: { accept: "text/event-stream" },
      });
      if (sse.status === 401 || sse.status === 403) {
        const auth = await authFrom(sse, url, fetchFn, opts.cimd ?? true);
        return { ok: true, url, transport: "sse", auth, suggestedId: suggestId(url) };
      }
      if (sse.ok && sse.headers.get("content-type")?.includes("text/event-stream")) {
        await sse.body?.cancel();
        return { ok: true, url, transport: "sse", auth: { type: "none" }, suggestedId: suggestId(url) };
      }
    } catch {
      // fall through
    }
  }
  return {
    ok: false,
    url,
    error: `The server answered ${res.status}; it does not look like an MCP endpoint.`,
  };
}
