// Remote connector: Streamable HTTP through the SDK client, legacy SSE fallback,
// header auth with vault placeholders, OAuth with background refresh.
import {
  type AuthProvider,
  Client,
  type FetchLike,
  ProtocolError,
  SdkError,
  SdkErrorCode,
  SdkHttpError,
  SSEClientTransport,
  StreamableHTTPClientTransport,
  type Transport,
  UnauthorizedError,
} from "@modelcontextprotocol/client";
import type { AccountDef, ServerDef } from "../core/config.ts";
import { type AccountState, GatewayError, type ToolResult } from "../core/types.ts";
import { resolveSecrets } from "../vault/vault.ts";
import type {
  Connector,
  ConnectorDeps,
  ConnectorFactory,
  DownstreamSkill,
  DownstreamTool,
} from "./connector.ts";
import { httpOriginOf, refreshTokens, SignInNeededError, VaultOAuthProvider } from "./oauth.ts";
import { checkRemoteUrl } from "./remote-url.ts";
import { listServerSkills, readServerSkillFile, SKILLS_CLIENT_CAPABILITIES } from "./skills.ts";

export interface RemoteConnectorOptions {
  /** Refresh access tokens this long before they expire. Default 60 s. */
  refreshLeadMs?: number;
  /** Retry delay after a refresh failed on a network or server error. Default 30 s. */
  refreshRetryMs?: number;
  /** Fetch used for every request (MCP and OAuth). Default global fetch. */
  fetch?: FetchLike;
  clientVersion?: string;
}

const NOT_STREAMABLE = new Set([400, 404, 405]);

function sameState(a: AccountState, b: AccountState): boolean {
  return a.status === b.status && ("reason" in a ? a.reason : "") === ("reason" in b ? b.reason : "");
}

class RemoteConnector implements Connector {
  private st: AccountState = { status: "stopped" };
  private client?: Client;
  private connecting?: Promise<Client>;
  private refreshing?: Promise<boolean>;
  private timer?: ReturnType<typeof setTimeout>;
  private closed = false;
  private readonly stateListeners = new Set<(s: AccountState) => void>();
  private readonly toolsListeners = new Set<() => void>();
  private readonly oauth?: VaultOAuthProvider;
  private readonly url: string;
  private readonly invalidUrl?: string;
  private readonly lead: number;
  private readonly baseFetch: FetchLike;

  constructor(
    readonly accountId: string,
    private readonly account: AccountDef,
    private readonly server: Extract<ServerDef, { transport: "http" | "sse" }>,
    private readonly deps: ConnectorDeps,
    private readonly opts: RemoteConnectorOptions,
  ) {
    this.url = server.url;
    this.invalidUrl = checkRemoteUrl(server.url, server.allowInsecure);
    this.lead = opts.refreshLeadMs ?? 60_000;
    this.baseFetch = opts.fetch ?? fetch;
    if (account.auth.type === "oauth")
      this.oauth = new VaultOAuthProvider(accountId, {
        vault: deps.vault,
        gatewayUrl: deps.gatewayUrl,
        scopes: account.auth.scopes,
        clientId: account.auth.clientId,
        httpOrigin: httpOriginOf(server),
      });
    if (this.invalidUrl) this.setState({ status: "error", reason: this.invalidUrl });
  }

  state(): AccountState {
    return this.st;
  }

  onStateChange(listener: (s: AccountState) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onToolsChanged(listener: () => void): () => void {
    this.toolsListeners.add(listener);
    return () => this.toolsListeners.delete(listener);
  }

  async listTools(signal?: AbortSignal): Promise<DownstreamTool[]> {
    return this.run(async (client) => {
      const res = await client.listTools(undefined, { signal });
      return res.tools.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema as Record<string, unknown>,
        annotations: t.annotations as Record<string, unknown> | undefined,
      }));
    });
  }

  listSkills(signal?: AbortSignal): Promise<DownstreamSkill[]> {
    return this.run((client) => listServerSkills(client, signal));
  }

  readSkillFile(skill: DownstreamSkill, uri: string, signal?: AbortSignal): Promise<Uint8Array> {
    return this.run((client) => readServerSkillFile(client, skill, uri, signal));
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    return this.run(async (client) => {
      const res = await client.callTool({ name, arguments: args }, { signal });
      return {
        content: (res.content ?? []) as ToolResult["content"],
        ...(res.structuredContent !== undefined && {
          structuredContent: res.structuredContent as Record<string, unknown>,
        }),
        ...(res.isError !== undefined && { isError: res.isError }),
      };
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.clearTimer();
    await this.dropClient();
    this.setState({ status: "stopped" });
  }

  // --- internals ---

  private setState(s: AccountState) {
    if (sameState(this.st, s)) return;
    this.st = s;
    this.deps.events.emit({
      type: "account-state",
      accountId: this.accountId,
      status: s.status,
      ...("reason" in s && { reason: s.reason }),
    });
    for (const l of this.stateListeners) l(s);
  }

  private async run<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    if (this.invalidUrl) throw new GatewayError("unreachable", this.invalidUrl);
    if (this.closed) throw new GatewayError("unreachable", "connector is closed");
    try {
      const client = await this.ensureClient();
      const out = await fn(client);
      if (this.st.status !== "connected") this.setState({ status: "connected" });
      return out;
    } catch (e) {
      throw await this.toGatewayError(e);
    }
  }

  private ensureClient(): Promise<Client> {
    if (this.client) return Promise.resolve(this.client);
    this.connecting ??= this.connect().finally(() => {
      this.connecting = undefined;
    });
    return this.connecting;
  }

  private async connect(): Promise<Client> {
    if (this.oauth && !(await this.oauth.tokens())?.access_token)
      throw new SignInNeededError("not signed in");
    this.setState({ status: "starting" });
    let client: Client;
    if (this.server.transport === "sse") client = await this.open("sse");
    else {
      try {
        client = await this.open("http");
      } catch (e) {
        if (!(e instanceof SdkHttpError && NOT_STREAMABLE.has(e.status))) throw e;
        client = await this.open("sse");
      }
    }
    this.client = client;
    this.setState({ status: "connected" });
    this.scheduleRefresh();
    return client;
  }

  private async open(kind: "http" | "sse"): Promise<Client> {
    const client = new Client(
      { name: "pmcpg", version: this.opts.clientVersion ?? "0.0.0" },
      {
        capabilities: SKILLS_CLIENT_CAPABILITIES,
        versionNegotiation: { mode: "auto" },
        listChanged: {
          tools: {
            autoRefresh: false,
            onChanged: () => {
              for (const l of this.toolsListeners) l();
            },
          },
        },
      },
    );
    const url = new URL(this.url);
    const common = { authProvider: this.authProvider(), fetch: this.requestFetch() };
    const transport: Transport =
      kind === "http" ? new StreamableHTTPClientTransport(url, common) : new SSEClientTransport(url, common);
    client.onclose = () => {
      if (this.client === client) this.client = undefined;
    };
    try {
      await client.connect(transport);
    } catch (e) {
      await client.close().catch(() => {});
      throw e;
    }
    return client;
  }

  private async dropClient() {
    const c = this.client;
    this.client = undefined;
    await c?.close().catch(() => {});
  }

  /**
   * Header auth and URL parameters: resolve {{vault:...}} / vault: references on every request,
   * only toward the server's own origin and path, never toward OAuth or other hosts.
   */
  private requestFetch(): FetchLike {
    const auth = this.account.auth;
    const params = Object.entries(this.account.urlParams ?? {});
    if (auth.type !== "header" && params.length === 0) return this.baseFetch;
    const server = new URL(this.url);
    const vault = this.deps.vault;
    return async (input, init) => {
      const target = new URL(String(input));
      if (target.origin !== server.origin) return this.baseFetch(input, init);
      let next: string | URL = input;
      if (params.length && target.pathname === server.pathname) {
        for (const [k, v] of params) target.searchParams.set(k, await resolveSecrets(v, vault));
        next = target;
      }
      if (auth.type !== "header") return this.baseFetch(next, init);
      const headers = new Headers(init?.headers);
      for (const [k, v] of Object.entries(auth.headers)) headers.set(k, await resolveSecrets(v, vault));
      return this.baseFetch(next, { ...init, headers });
    };
  }

  private authProvider(): AuthProvider | undefined {
    const oauth = this.oauth;
    if (!oauth) return undefined;
    return {
      token: async () => {
        const t = await oauth.tokens();
        if (t?.expires_at && t.refresh_token && t.expires_at - Date.now() <= this.lead) {
          // Timer missed (sleep, clock jump): refresh inline before sending.
          await this.refresh().catch(() => false);
          return (await oauth.tokens())?.access_token;
        }
        return t?.access_token;
      },
      onUnauthorized: async () => {
        if (!(await this.refresh())) throw new SignInNeededError("sign-in needed: refresh failed");
      },
    };
  }

  /** Single-flight refresh. True when new tokens are stored; false when sign-in is needed. */
  private refresh(): Promise<boolean> {
    const oauth = this.oauth;
    if (!oauth) return Promise.resolve(false);
    this.refreshing ??= (async () => {
      try {
        const ok = await refreshTokens(oauth, this.baseFetch);
        if (ok) {
          this.deps.events.emit({ type: "token-refreshed", accountId: this.accountId });
          this.scheduleRefresh();
        } else {
          this.clearTimer();
          this.setState({ status: "sign-in-needed", reason: "token refresh was rejected; sign in again" });
        }
        return ok;
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private scheduleRefresh(delayOverride?: number) {
    if (!this.oauth || this.closed) return;
    this.clearTimer();
    void this.oauth.tokens().then((t) => {
      if (this.closed || !t?.refresh_token || !t.expires_at) return;
      const delay = delayOverride ?? Math.max(0, t.expires_at - Date.now() - this.lead);
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.refresh().catch(() => {
          // Network or server error: keep the tokens and try again later.
          this.setState({ status: "unreachable", reason: "token refresh failed; retrying" });
          this.scheduleRefresh(this.opts.refreshRetryMs ?? 30_000);
        });
      }, delay);
      this.timer.unref?.();
    });
  }

  private async toGatewayError(e: unknown): Promise<GatewayError> {
    if (e instanceof GatewayError) return e;
    const message = e instanceof Error ? e.message : String(e);
    const authFailure =
      e instanceof SignInNeededError ||
      e instanceof UnauthorizedError ||
      (e instanceof Error && e.cause instanceof SignInNeededError) ||
      (e instanceof SdkHttpError && (e.status === 401 || e.status === 403));
    if (authFailure) {
      await this.dropClient();
      const reason = this.st.status === "sign-in-needed" ? this.st.reason : "sign-in needed";
      this.setState({ status: "sign-in-needed", reason });
      return new GatewayError("sign-in-needed", `${this.accountId}: ${reason}`);
    }
    if (e instanceof ProtocolError) return new GatewayError("downstream-error", message);
    if (e instanceof SdkError && e.code === SdkErrorCode.RequestTimeout)
      return new GatewayError("timeout", message);
    if (e instanceof Error && (e.name === "AbortError" || e.name === "TimeoutError"))
      return new GatewayError("timeout", message);
    await this.dropClient();
    this.setState({ status: "unreachable", reason: message.slice(0, 200) });
    return new GatewayError("unreachable", `${this.accountId}: ${message}`);
  }
}

export function remoteConnectorFactory(opts: RemoteConnectorOptions = {}): ConnectorFactory {
  return (accountId, account, server, deps) => {
    if (server.transport === "stdio") throw new Error(`server for ${accountId} is stdio, not remote`);
    return new RemoteConnector(accountId, account, server, deps, opts);
  };
}

/** ConnectorFactory for `transport: http | sse` servers with default options. */
export const createRemoteConnector: ConnectorFactory = remoteConnectorFactory();
