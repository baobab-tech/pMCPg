// OAuth for remote servers: an OAuthClientProvider on the vault, token refresh and revocation,
// and the OAuthController that drives interactive sign-in.
import {
  auth,
  type FetchLike,
  type OAuthClientInformationContext,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  OAuthError,
  OAuthErrorCode,
  refreshAuthorization,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens,
} from "@modelcontextprotocol/client";
import type { AccountDef, ServerDef } from "../core/config.ts";
import { type Vault, vaultKeys } from "../vault/vault.ts";
import { clientMetadataUrlFor } from "./cimd.ts";
import type { ConnectorDeps, OAuthController } from "./connector.ts";
import { checkGuardedUrl, guardedFetch } from "./guarded-fetch.ts";
import { checkRemoteUrl } from "./remote-url.ts";

/** Stored token set: the SDK shape plus an absolute expiry, so refresh timing survives restarts. */
export type VaultTokens = StoredOAuthTokens & { expires_at?: number };

/** Thrown when the account has no usable credentials and a person must sign in again. */
export class SignInNeededError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SignInNeededError";
  }
}

/** Thrown when a client secret the user entered would go to an authorization server it was not entered for. */
export class ClientIssuerMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientIssuerMismatchError";
  }
}

export const STATE_TTL_MS = 10 * 60 * 1000;
const REVOKE_TIMEOUT_MS = 5000;

/**
 * Stored client registration. `entered` marks a client ID and secret the user typed in; its
 * `issuer` is set when it is entered, and the secret is only sent to that issuer.
 */
export type VaultClientInformation = StoredOAuthClientInformation & { entered?: boolean };

/** Same issuer, tolerating one trailing slash (as the SDK does). */
export function issuersMatch(a: string, b: string): boolean {
  return a === b || a.replace(/\/$/, "") === b.replace(/\/$/, "");
}

/** True for a secret the user entered, including entries saved before `entered` existed (no issuer). */
function isEnteredSecret(c: VaultClientInformation | undefined): boolean {
  return !!c && "client_secret" in c && !!c.client_secret && (c.entered === true || !c.issuer);
}

export interface VaultOAuthProviderOptions {
  vault: Vault;
  gatewayUrl: string;
  scopes?: string[];
  /** Pre-registered public client id. Without it the provider registers dynamically. */
  clientId?: string;
  /**
   * Called with the authorization URL during interactive sign-in.
   * Absent for background use: then a needed redirect throws SignInNeededError instead.
   */
  onAuthorizationUrl?: (url: URL) => void | Promise<void>;
  /** OAuth `state` for the interactive flow. */
  state?: string;
  /** Origin allowed over plain http for OAuth requests: the server's own, when it is `allowInsecure`. */
  httpOrigin?: string;
}

async function readJson<T>(vault: Vault, key: string): Promise<T | undefined> {
  const raw = await vault.get(key);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

/**
 * OAuthClientProvider whose storage hooks read and write the vault, one entry per account.
 * Tokens and client registrations carry the issuer stamp; a read for another issuer returns nothing.
 */
export class VaultOAuthProvider implements OAuthClientProvider {
  private verifier?: string;

  constructor(
    readonly accountId: string,
    private readonly opts: VaultOAuthProviderOptions,
  ) {}

  /** Fetch for every OAuth request of this account: checked URLs and redirects, timeout, size cap. */
  guardFetch(fetchFn?: FetchLike, timeoutMs?: number): FetchLike {
    return guardedFetch({ fetch: fetchFn, httpOrigin: this.opts.httpOrigin, timeoutMs });
  }

  get httpOrigin(): string | undefined {
    return this.opts.httpOrigin;
  }

  get redirectUrl(): string {
    return `${this.opts.gatewayUrl.replace(/\/+$/, "")}/oauth/callback`;
  }

  /** Client ID document URL, used when the authorization server supports CIMD and no client is stored. */
  get clientMetadataUrl(): string | undefined {
    return clientMetadataUrlFor(this.redirectUrl);
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "pMCPg",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      ...(this.opts.scopes?.length && { scope: this.opts.scopes.join(" ") }),
    };
  }

  state(): string {
    if (!this.opts.state) throw new SignInNeededError("sign-in needs a state");
    return this.opts.state;
  }

  async clientInformation(
    ctx?: OAuthClientInformationContext,
  ): Promise<StoredOAuthClientInformation | undefined> {
    const stored = await readJson<VaultClientInformation>(
      this.opts.vault,
      vaultKeys.oauthClient(this.accountId),
    );
    if (ctx && isEnteredSecret(stored)) {
      // Never let the SDK stamp an entered secret with whichever issuer the server names.
      if (!stored?.issuer)
        throw new ClientIssuerMismatchError(
          "the client secret was saved without its sign-in provider; enter the client secret again",
        );
      if (!issuersMatch(stored.issuer, ctx.issuer))
        throw new ClientIssuerMismatchError(
          `the client secret was entered for ${stored.issuer}, but the server now signs in with ${ctx.issuer}; ` +
            "check the server, or enter the client secret again for the new provider",
        );
      return stored;
    }
    if (stored && (!ctx || !stored.issuer || stored.issuer === ctx.issuer)) return stored;
    if (this.opts.clientId) return { client_id: this.opts.clientId };
    return undefined;
  }

  async saveClientInformation(info: StoredOAuthClientInformation): Promise<void> {
    await this.opts.vault.set(vaultKeys.oauthClient(this.accountId), JSON.stringify(info));
  }

  async tokens(ctx?: OAuthClientInformationContext): Promise<VaultTokens | undefined> {
    const stored = await readJson<VaultTokens>(this.opts.vault, vaultKeys.oauthTokens(this.accountId));
    if (!stored) return undefined;
    if (ctx && stored.issuer && stored.issuer !== ctx.issuer) return undefined;
    return stored;
  }

  async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    const prev = await this.tokens();
    const next: VaultTokens = { ...tokens };
    // A refresh response without refresh_token keeps the old one; a rotated one replaces it.
    if (!next.refresh_token && prev?.refresh_token && prev.issuer === next.issuer)
      next.refresh_token = prev.refresh_token;
    if (typeof tokens.expires_in === "number") next.expires_at = Date.now() + tokens.expires_in * 1000;
    await this.opts.vault.set(vaultKeys.oauthTokens(this.accountId), JSON.stringify(next));
    this.verifier = undefined;
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    if (!this.opts.onAuthorizationUrl) throw new SignInNeededError("sign-in needed");
    await this.opts.onAuthorizationUrl(url);
  }

  saveCodeVerifier(verifier: string): void {
    this.verifier = verifier;
  }

  codeVerifier(): string {
    if (!this.verifier) throw new SignInNeededError("no sign-in in progress");
    return this.verifier;
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.opts.vault.set(vaultKeys.oauthDiscovery(this.accountId), JSON.stringify(state));
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return readJson<OAuthDiscoveryState>(this.opts.vault, vaultKeys.oauthDiscovery(this.accountId));
  }

  async invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery"): Promise<void> {
    const v = this.opts.vault;
    if (scope === "all" || scope === "tokens") await v.delete(vaultKeys.oauthTokens(this.accountId));
    // A client ID and secret the user entered stay; only the user replaces them.
    if ((scope === "all" || scope === "client") && !(await this.hasEnteredSecret()))
      await v.delete(vaultKeys.oauthClient(this.accountId));
    if (scope === "all" || scope === "discovery") await v.delete(vaultKeys.oauthDiscovery(this.accountId));
    if (scope === "all" || scope === "verifier") this.verifier = undefined;
  }

  private async hasEnteredSecret(): Promise<boolean> {
    const c = await readJson<VaultClientInformation>(this.opts.vault, vaultKeys.oauthClient(this.accountId));
    return c?.entered === true;
  }
}

function issuerOf(disc: OAuthDiscoveryState): string {
  return disc.authorizationServerMetadata?.issuer ?? disc.authorizationServerUrl;
}

/**
 * Exchanges the stored refresh token for new tokens. Returns false when a person must sign in
 * again (no refresh token, or the server rejected it). Throws on network and server errors.
 */
export async function refreshTokens(provider: VaultOAuthProvider, fetchFn?: FetchLike): Promise<boolean> {
  const [tokens, disc] = await Promise.all([provider.tokens(), provider.discoveryState()]);
  if (!tokens?.refresh_token || !disc) return false;
  const issuer = issuerOf(disc);
  if (tokens.issuer && tokens.issuer !== issuer) return false;
  const clientInformation = await provider.clientInformation({ issuer });
  if (!clientInformation) return false;
  let next: StoredOAuthTokens;
  try {
    next = await refreshAuthorization(disc.authorizationServerUrl, {
      metadata: disc.authorizationServerMetadata,
      clientInformation,
      refreshToken: tokens.refresh_token,
      resource: disc.resourceMetadata?.resource ? new URL(disc.resourceMetadata.resource) : undefined,
      fetchFn: provider.guardFetch(fetchFn),
    });
  } catch (e) {
    if (e instanceof OAuthError && e.code !== OAuthErrorCode.ServerError) {
      await provider.invalidateCredentials("tokens");
      return false;
    }
    throw e;
  }
  await provider.saveTokens({ ...next, issuer });
  return true;
}

/**
 * RFC 7009 revocation of the stored tokens, best effort. Returns how many tokens the server accepted.
 * The endpoint must be https (or loopback); a redirect is followed only to the same origin (307/308).
 */
export async function revokeTokens(provider: VaultOAuthProvider, fetchFn?: FetchLike): Promise<number> {
  const [tokens, disc] = await Promise.all([provider.tokens(), provider.discoveryState()]);
  const meta = disc?.authorizationServerMetadata as { revocation_endpoint?: string } | undefined;
  const endpoint = meta?.revocation_endpoint;
  if (!tokens || !disc || !endpoint) return 0;
  if (checkGuardedUrl(endpoint, provider.httpOrigin)) return 0;
  let client: StoredOAuthClientInformation | undefined;
  try {
    client = await provider.clientInformation({ issuer: issuerOf(disc) });
  } catch {
    return 0; // An entered secret for another issuer: do not send it.
  }
  if (!client) return 0;
  const guarded = provider.guardFetch(fetchFn, REVOKE_TIMEOUT_MS);
  let revoked = 0;
  const pairs: [string, string | undefined][] = [
    ["refresh_token", tokens.refresh_token],
    ["access_token", tokens.access_token],
  ];
  for (const [hint, token] of pairs) {
    if (!token) continue;
    const body = new URLSearchParams({ token, token_type_hint: hint });
    const headers = new Headers({ "content-type": "application/x-www-form-urlencoded" });
    const secret = "client_secret" in client ? client.client_secret : undefined;
    if (secret)
      headers.set(
        "authorization",
        `Basic ${btoa(`${encodeURIComponent(client.client_id)}:${encodeURIComponent(secret)}`)}`,
      );
    else body.set("client_id", client.client_id);
    try {
      const res = await guarded(endpoint, { method: "POST", headers, body });
      if (res.ok) revoked++;
    } catch {
      // Revocation is best effort; local credentials are deleted either way.
    }
  }
  return revoked;
}

/** Finds the account and its server for an account id. */
export type AccountLookup = (accountId: string) => { account: AccountDef; server: ServerDef } | undefined;

export interface OAuthControllerHooks {
  /** Called after tokens are saved, so the live connector can reconnect. */
  onSignedIn?(accountId: string): void;
  /** Called after local credentials are deleted. */
  onSignedOut?(accountId: string): void;
}

interface Pending {
  accountId: string;
  provider: VaultOAuthProvider;
  serverUrl: string;
  expiresAt: number;
}

function randomState(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
}

function oauthTarget(lookup: AccountLookup, accountId: string) {
  const found = lookup(accountId);
  if (!found) throw new Error(`unknown account: ${accountId}`);
  const { account, server } = found;
  if (server.transport === "stdio") throw new Error(`account ${accountId} is not on a remote server`);
  if (account.auth.type !== "oauth") throw new Error(`account ${accountId} does not use OAuth`);
  const problem = checkRemoteUrl(server.url, server.allowInsecure);
  if (problem) throw new Error(problem);
  return { url: server.url, auth: account.auth, httpOrigin: httpOriginOf(server) };
}

/** The server's own origin when plain http to it is allowed; OAuth requests may use it too. */
export function httpOriginOf(server: ServerDef): string | undefined {
  if (server.transport === "stdio" || !server.allowInsecure) return undefined;
  try {
    return new URL(server.url).origin;
  } catch {
    return undefined;
  }
}

export interface OAuthControllerOptions {
  /** Fetch for discovery, registration, token and revocation requests. */
  fetch?: FetchLike;
  now?: () => number;
}

/**
 * Drives interactive sign-in. `state` is bound to one account, single-use, and expires after 10 minutes.
 * Starting a new sign-in for an account cancels the previous one.
 */
export function createOAuthController(
  deps: ConnectorDeps,
  lookup: AccountLookup,
  hooks: OAuthControllerHooks = {},
  opts: OAuthControllerOptions = {},
): OAuthController {
  const pending = new Map<string, Pending>();
  const now = opts.now ?? Date.now;

  function prune(accountId?: string) {
    for (const [k, p] of pending) if (p.expiresAt <= now() || p.accountId === accountId) pending.delete(k);
  }

  return {
    async beginSignIn(accountId) {
      const target = oauthTarget(lookup, accountId);
      prune(accountId);
      const state = randomState();
      let authorizationUrl: URL | undefined;
      const provider = new VaultOAuthProvider(accountId, {
        vault: deps.vault,
        gatewayUrl: deps.gatewayUrl,
        scopes: target.auth.scopes,
        clientId: target.auth.clientId,
        httpOrigin: target.httpOrigin,
        state,
        onAuthorizationUrl: (url) => {
          authorizationUrl = url;
        },
      });
      const result = await auth(provider, {
        serverUrl: target.url,
        forceReauthorization: true,
        fetchFn: provider.guardFetch(opts.fetch),
      });
      if (result !== "REDIRECT" || !authorizationUrl)
        throw new Error("authorization server did not start a sign-in");
      pending.set(state, { accountId, provider, serverUrl: target.url, expiresAt: now() + STATE_TTL_MS });
      const href = authorizationUrl.toString();
      await deps.openBrowser(href).catch(() => {});
      return { authorizationUrl: href };
    },

    async handleCallback(url) {
      const state = url.searchParams.get("state") ?? "";
      const p = pending.get(state);
      pending.delete(state);
      if (!p || p.expiresAt <= now()) throw new Error("sign-in link expired or already used; start again");
      const error = url.searchParams.get("error");
      if (error) throw new Error(`authorization server refused sign-in: ${error.slice(0, 64)}`);
      const code = url.searchParams.get("code");
      if (!code) throw new Error("callback has no authorization code");
      const result = await auth(p.provider, {
        serverUrl: p.serverUrl,
        authorizationCode: code,
        iss: url.searchParams.get("iss") ?? undefined,
        fetchFn: p.provider.guardFetch(opts.fetch),
      });
      if (result !== "AUTHORIZED") throw new Error("sign-in did not complete");
      hooks.onSignedIn?.(p.accountId);
      return { accountId: p.accountId };
    },

    async signOut(accountId) {
      prune(accountId);
      const found = lookup(accountId);
      const provider = new VaultOAuthProvider(accountId, {
        vault: deps.vault,
        gatewayUrl: deps.gatewayUrl,
        httpOrigin: found ? httpOriginOf(found.server) : undefined,
      });
      await revokeTokens(provider, opts.fetch);
      await provider.invalidateCredentials("all");
      hooks.onSignedOut?.(accountId);
    },
  };
}
