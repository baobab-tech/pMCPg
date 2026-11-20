// Connector contract. Owners: stdio (Phase 1, session B), remote + OAuth (session C).
import type { AccountDef, ServerDef } from "../core/config.ts";
import type { AccountState, ToolResult } from "../core/types.ts";
import type { EventSink } from "../store/events.ts";
import type { Vault } from "../vault/vault.ts";

/** Tool as listed by the downstream server (before the gateway namespaces it). */
export interface DownstreamTool {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

/** One live connection to one server, signed in as one account. */
export interface Connector {
  readonly accountId: string;
  state(): AccountState;
  /** Connects if needed. Throws GatewayError("sign-in-needed" | "unreachable" | "timeout"). */
  listTools(signal?: AbortSignal): Promise<DownstreamTool[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult>;
  /** Called when the server reports tools/list_changed or the cached list expires. */
  onToolsChanged(listener: () => void): () => void;
  onStateChange(listener: (s: AccountState) => void): () => void;
  close(): Promise<void>;
}

export interface ConnectorDeps {
  vault: Vault;
  events: EventSink;
  /** Base URL of the gateway, for the OAuth redirect: http://127.0.0.1:7431 */
  gatewayUrl: string;
  /** Opens a URL in the user's browser (OAuth sign-in). Injected so tests and Docker can override. */
  openBrowser: (url: string) => Promise<void>;
}

export type ConnectorFactory = (
  accountId: string,
  account: AccountDef,
  server: ServerDef,
  deps: ConnectorDeps,
) => Connector;

/** Remote-only: interactive sign-in, driven by the UI or CLI. Owner: session C. */
export interface OAuthController {
  /** Starts sign-in; returns the authorization URL the user must open. */
  beginSignIn(accountId: string): Promise<{ authorizationUrl: string }>;
  /** Handles GET /oauth/callback. Returns the account that finished signing in. */
  handleCallback(url: URL): Promise<{ accountId: string }>;
  signOut(accountId: string): Promise<void>;
}
