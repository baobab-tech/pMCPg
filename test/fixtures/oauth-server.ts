// Fake OAuth authorization server plus a protected MCP server, for tests. One Bun.serve on 127.0.0.1.
// RFC 9728 and RFC 8414 metadata, dynamic client registration, PKCE (S256), short-lived tokens,
// refresh with rotation, revocation (RFC 7009), and switches to revoke tokens.
import { McpServer, WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface OAuthServerOptions {
  /** Access token lifetime in seconds. */
  accessTtlSec?: number;
  /**
   * Protect /mcp with a static header instead of OAuth (header-auth tests).
   * OAuth endpoints stay up but are unused.
   */
  requireHeader?: { name: string; value: string };
  /** Advertise a revocation endpoint. Default true. */
  revocation?: boolean;
}

export interface OAuthServerFixture {
  /** Origin and issuer, e.g. http://127.0.0.1:51234 */
  issuer: string;
  /** Protected MCP endpoint. */
  mcpUrl: string;
  counters: {
    registrations: number;
    codeExchanges: number;
    refreshes: number;
    revocations: number;
    mcp401: number;
  };
  /** Refresh tokens that were presented after being rotated out. */
  reusedRefreshTokens: string[];
  /** Invalidate every access token (refresh tokens keep working): the next MCP call gets 401. */
  revokeAccessTokens(): void;
  /** Invalidate every access and refresh token. */
  revokeAll(): void;
  isAccessTokenValid(token: string): boolean;
  stop(): Promise<void>;
}

interface Client {
  redirectUris: string[];
}
interface Code {
  clientId: string;
  redirectUri: string;
  challenge: string;
  resource?: string;
  expiresAt: number;
}

const rand = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("base64url");

async function s256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return Buffer.from(digest).toString("base64url");
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

const oauthError = (error: string, status = 400) => json({ error }, status);

function mcpServer(): McpServer {
  const s = new McpServer({ name: "protected", version: "0.0.1" });
  s.registerTool(
    "whoami",
    { description: "Return a fixed identity", inputSchema: z.object({}) },
    async () => ({ content: [{ type: "text", text: "you are signed in" }] }),
  );
  s.registerTool(
    "echo",
    { description: "Echo back the given text", inputSchema: z.object({ text: z.string() }) },
    async ({ text }) => ({ content: [{ type: "text", text: `echo: ${text}` }] }),
  );
  return s;
}

export function startOAuthServer(opts: OAuthServerOptions = {}): OAuthServerFixture {
  const accessTtlSec = opts.accessTtlSec ?? 3600;
  const clients = new Map<string, Client>();
  const codes = new Map<string, Code>();
  const access = new Map<string, { clientId: string; expiresAt: number }>();
  const refresh = new Map<string, { clientId: string }>();
  const rotated = new Set<string>();
  const counters = { registrations: 0, codeExchanges: 0, refreshes: 0, revocations: 0, mcp401: 0 };
  const reusedRefreshTokens: string[] = [];
  let issuer = "";

  function issueTokens(clientId: string) {
    const at = rand();
    const rt = rand();
    access.set(at, { clientId, expiresAt: Date.now() + accessTtlSec * 1000 });
    refresh.set(rt, { clientId });
    return {
      access_token: at,
      token_type: "Bearer",
      expires_in: accessTtlSec,
      refresh_token: rt,
      scope: "mcp",
    };
  }

  async function token(req: Request): Promise<Response> {
    const form = new URLSearchParams(await req.text());
    const clientId = form.get("client_id") ?? "";
    if (!clients.has(clientId)) return oauthError("invalid_client", 401);
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const code = codes.get(form.get("code") ?? "");
      codes.delete(form.get("code") ?? "");
      if (!code || code.expiresAt < Date.now() || code.clientId !== clientId)
        return oauthError("invalid_grant");
      if (code.redirectUri !== form.get("redirect_uri")) return oauthError("invalid_grant");
      if ((await s256(form.get("code_verifier") ?? "")) !== code.challenge)
        return oauthError("invalid_grant");
      counters.codeExchanges++;
      return json(issueTokens(clientId));
    }
    if (grant === "refresh_token") {
      const rt = form.get("refresh_token") ?? "";
      if (rotated.has(rt)) reusedRefreshTokens.push(rt);
      const entry = refresh.get(rt);
      if (!entry || entry.clientId !== clientId) return oauthError("invalid_grant");
      refresh.delete(rt);
      rotated.add(rt);
      counters.refreshes++;
      return json(issueTokens(clientId));
    }
    return oauthError("unsupported_grant_type");
  }

  function authorize(url: URL): Response {
    const p = url.searchParams;
    const client = clients.get(p.get("client_id") ?? "");
    const redirectUri = p.get("redirect_uri") ?? "";
    if (!client?.redirectUris.includes(redirectUri)) return new Response("bad client", { status: 400 });
    if (
      p.get("response_type") !== "code" ||
      p.get("code_challenge_method") !== "S256" ||
      !p.get("code_challenge")
    )
      return new Response("PKCE S256 required", { status: 400 });
    const resource = p.get("resource") ?? undefined;
    if (resource && resource !== `${issuer}/mcp`) return new Response("bad resource", { status: 400 });
    const code = rand();
    codes.set(code, {
      clientId: p.get("client_id") as string,
      redirectUri,
      challenge: p.get("code_challenge") as string,
      resource,
      expiresAt: Date.now() + 60_000,
    });
    const back = new URL(redirectUri);
    back.searchParams.set("code", code);
    back.searchParams.set("iss", issuer);
    const state = p.get("state");
    if (state) back.searchParams.set("state", state);
    // Auto-approve: the "user" consents immediately.
    return new Response(null, { status: 302, headers: { location: back.toString() } });
  }

  async function mcp(req: Request): Promise<Response> {
    if (opts.requireHeader) {
      if (req.headers.get(opts.requireHeader.name) !== opts.requireHeader.value) {
        counters.mcp401++;
        return new Response("unauthorized", { status: 401 });
      }
    } else {
      const auth = req.headers.get("authorization") ?? "";
      const at = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      if (!isAccessTokenValid(at)) {
        counters.mcp401++;
        return new Response("unauthorized", {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${issuer}/.well-known/oauth-protected-resource/mcp"`,
          },
        });
      }
    }
    const t = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    await mcpServer().connect(t);
    return t.handleRequest(req);
  }

  function isAccessTokenValid(at: string): boolean {
    const entry = access.get(at);
    return !!entry && entry.expiresAt > Date.now();
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;
      if (
        path === "/.well-known/oauth-protected-resource/mcp" ||
        path === "/.well-known/oauth-protected-resource"
      )
        return json({
          resource: `${issuer}/mcp`,
          authorization_servers: [issuer],
          bearer_methods_supported: ["header"],
        });
      if (path === "/.well-known/oauth-authorization-server")
        return json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          registration_endpoint: `${issuer}/register`,
          ...(opts.revocation !== false && { revocation_endpoint: `${issuer}/revoke` }),
          response_types_supported: ["code"],
          grant_types_supported: ["authorization_code", "refresh_token"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          authorization_response_iss_parameter_supported: true,
        });
      if (path === "/register" && req.method === "POST") {
        const body = (await req.json()) as { redirect_uris?: string[] };
        const clientId = rand();
        clients.set(clientId, { redirectUris: body.redirect_uris ?? [] });
        counters.registrations++;
        return json({ ...body, client_id: clientId, token_endpoint_auth_method: "none" }, 201);
      }
      if (path === "/authorize" && req.method === "GET") return authorize(url);
      if (path === "/token" && req.method === "POST") return token(req);
      if (path === "/revoke" && req.method === "POST") {
        const form = new URLSearchParams(await req.text());
        const t = form.get("token") ?? "";
        access.delete(t);
        refresh.delete(t);
        counters.revocations++;
        return new Response(null, { status: 200 });
      }
      if (path === "/mcp") return mcp(req);
      return new Response("not found", { status: 404 });
    },
  });
  issuer = `http://127.0.0.1:${server.port}`;

  return {
    issuer,
    mcpUrl: `${issuer}/mcp`,
    counters,
    reusedRefreshTokens,
    revokeAccessTokens: () => access.clear(),
    revokeAll: () => {
      access.clear();
      refresh.clear();
    },
    isAccessTokenValid,
    stop: () => server.stop(true),
  };
}
