// Client ID Metadata Document (CIMD): pMCPg's OAuth client ID is the URL of a public JSON file.
// Authorization servers that advertise `client_id_metadata_document_supported` fetch the file to
// learn the client's name and redirect addresses. The file holds no secret; tokens never pass through it.
// Spec: draft-ietf-oauth-client-id-metadata-document, MCP authorization (2025-11-25).

/** Hosted copy of `clientMetadataDocument()`, served by GitHub Pages from the gh-pages branch (copied from site/oauth/client.json). */
export const CLIENT_METADATA_URL = "https://baobab-tech.github.io/pMCPg/oauth/client.json";

/** Points pMCPg at a self-hosted document instead. It must list this gateway's redirect address. */
export const CLIENT_METADATA_ENV = "PMCPG_CLIENT_METADATA_URL";

/** Redirect addresses in the hosted document: the default gateway port on both loopback names. */
export const CLIENT_METADATA_REDIRECTS = [
  "http://127.0.0.1:7431/oauth/callback",
  "http://localhost:7431/oauth/callback",
];

/** The document at CLIENT_METADATA_URL. A test checks the hosted file against it. */
export function clientMetadataDocument(
  clientId = CLIENT_METADATA_URL,
  redirectUris = CLIENT_METADATA_REDIRECTS,
) {
  return {
    client_id: clientId,
    client_name: "pMCPg",
    // Same origin as client_id: authorization servers refuse a client_uri on another origin.
    client_uri: new URL("..", clientId).toString(),
    redirect_uris: redirectUris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  };
}

/** https, a path other than "/", no fragment or user info (draft section 3). */
export function isValidClientMetadataUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.pathname !== "/" && !u.hash && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * The client ID URL to offer for this redirect address, or undefined when CIMD cannot work:
 * the hosted document lists only the default port, and a self-hosted URL must be valid https.
 */
export function clientMetadataUrlFor(
  redirectUrl: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const custom = env[CLIENT_METADATA_ENV]?.trim();
  if (custom) return isValidClientMetadataUrl(custom) ? custom : undefined;
  return CLIENT_METADATA_REDIRECTS.includes(redirectUrl) ? CLIENT_METADATA_URL : undefined;
}
