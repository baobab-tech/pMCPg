import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { auth } from "@modelcontextprotocol/client";
import {
  CLIENT_METADATA_ENV,
  CLIENT_METADATA_URL,
  clientMetadataDocument,
  clientMetadataUrlFor,
  isValidClientMetadataUrl,
} from "../../src/connectors/cimd.ts";
import { VaultOAuthProvider } from "../../src/connectors/oauth.ts";
import { probeServer } from "../../src/onboarding/probe.ts";
import { type Vault, vaultKeys } from "../../src/vault/vault.ts";

class MemoryVault implements Vault {
  readonly keySource = "env" as const;
  readonly data = new Map<string, string>();
  async get(k: string) {
    return this.data.get(k);
  }
  async set(k: string, v: string) {
    this.data.set(k, v);
  }
  async delete(k: string) {
    return this.data.delete(k);
  }
  async list(prefix: string) {
    return [...this.data.keys()].filter((k) => k.startsWith(prefix));
  }
}

const DEFAULT_REDIRECT = "http://127.0.0.1:7431/oauth/callback";

describe("client ID document", () => {
  test("hosted file matches the code", async () => {
    const hosted = await Bun.file(`${import.meta.dir}/../../site/oauth/client.json`).json();
    expect(hosted).toEqual(clientMetadataDocument());
    expect(hosted.client_id).toBe(CLIENT_METADATA_URL);
  });

  test("document holds no secret and uses no shared-secret auth", () => {
    const doc = clientMetadataDocument() as Record<string, unknown>;
    expect(doc.client_secret).toBeUndefined();
    expect(doc.token_endpoint_auth_method).toBe("none");
  });

  test("offered only for the redirect addresses the hosted file lists", () => {
    expect(clientMetadataUrlFor(DEFAULT_REDIRECT, {})).toBe(CLIENT_METADATA_URL);
    expect(clientMetadataUrlFor("http://localhost:7431/oauth/callback", {})).toBe(CLIENT_METADATA_URL);
    expect(clientMetadataUrlFor("http://127.0.0.1:9000/oauth/callback", {})).toBeUndefined();
  });

  test("a self-hosted URL replaces the default, and an invalid one turns CIMD off", () => {
    const own = "https://example.org/pmcpg/client.json";
    expect(clientMetadataUrlFor("http://127.0.0.1:9000/oauth/callback", { [CLIENT_METADATA_ENV]: own })).toBe(
      own,
    );
    expect(
      clientMetadataUrlFor(DEFAULT_REDIRECT, { [CLIENT_METADATA_ENV]: "http://example.org/c.json" }),
    ).toBeUndefined();
  });

  test("URL rules: https, a path, no fragment or user info", () => {
    expect(isValidClientMetadataUrl(CLIENT_METADATA_URL)).toBe(true);
    expect(isValidClientMetadataUrl("https://example.org/")).toBe(false);
    expect(isValidClientMetadataUrl("https://example.org/c.json#x")).toBe(false);
    expect(isValidClientMetadataUrl("https://u:p@example.org/c.json")).toBe(false);
  });
});

describe("sign-in with a CIMD authorization server", () => {
  let srv: ReturnType<typeof Bun.serve>;
  let registrations = 0;

  beforeAll(() => {
    srv = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch(req) {
        const origin = new URL(req.url).origin;
        const path = new URL(req.url).pathname;
        if (path.startsWith("/.well-known/oauth-protected-resource"))
          return Response.json({ resource: `${origin}/mcp`, authorization_servers: [origin] });
        if (path === "/.well-known/oauth-authorization-server")
          return Response.json({
            issuer: origin,
            authorization_endpoint: `${origin}/authorize`,
            token_endpoint: `${origin}/token`,
            registration_endpoint: `${origin}/register`,
            response_types_supported: ["code"],
            code_challenge_methods_supported: ["S256"],
            client_id_metadata_document_supported: true,
          });
        if (path === "/register") {
          registrations++;
          return Response.json({ client_id: "dcr-client" }, { status: 201 });
        }
        return new Response("unauthorized", {
          status: 401,
          headers: {
            "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`,
          },
        });
      },
    });
  });
  afterAll(() => srv.stop(true));

  test("probe reports CIMD ahead of dynamic registration, unless the gateway cannot use it", async () => {
    const url = `http://127.0.0.1:${srv.port}/mcp`;
    const r = await probeServer(url, { allowInsecure: true });
    expect(r.ok && r.auth.type === "oauth" && r.auth.registration).toBe("cimd");
    const off = await probeServer(url, { allowInsecure: true, cimd: false });
    expect(off.ok && off.auth.type === "oauth" && off.auth.registration).toBe("dcr");
  });

  test("authorization URL carries the document URL as client_id; no registration request", async () => {
    const vault = new MemoryVault();
    let authUrl: URL | undefined;
    const provider = new VaultOAuthProvider("acct", {
      vault,
      gatewayUrl: "http://127.0.0.1:7431",
      state: "s",
      httpOrigin: `http://127.0.0.1:${srv.port}`,
      onAuthorizationUrl: (u) => {
        authUrl = u;
      },
    });
    const result = await auth(provider, {
      serverUrl: `http://127.0.0.1:${srv.port}/mcp`,
      fetchFn: provider.guardFetch(),
    });
    expect(result).toBe("REDIRECT");
    expect(authUrl?.searchParams.get("client_id")).toBe(CLIENT_METADATA_URL);
    expect(authUrl?.searchParams.get("redirect_uri")).toBe(DEFAULT_REDIRECT);
    expect(registrations).toBe(0);
    const stored = JSON.parse((await vault.get(vaultKeys.oauthClient("acct"))) ?? "{}");
    expect(stored.client_id).toBe(CLIENT_METADATA_URL);
  });
});
