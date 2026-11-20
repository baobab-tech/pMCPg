// Shared runtime types. Owner: core (Phase 0). Change only through the main session.
import type { TrustLevel } from "./config.ts";

/** JSON Schema object as returned by MCP tools/list. */
export type JsonSchema = Record<string, unknown>;

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** A downstream tool as the gateway sees it, bound to one account. */
export interface ToolRef {
  /** Namespaced name shown to the model: "<account>__<tool>". */
  qualifiedName: string;
  accountId: string;
  serverId: string;
  /** Name on the downstream server. */
  toolName: string;
  title?: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: ToolAnnotations;
  /** SHA-256 of name + description + inputSchema, for pinning. */
  hash: string;
  trust: TrustLevel[];
}

export const NAME_SEPARATOR = "__";

export function qualify(accountId: string, toolName: string): string {
  return `${accountId}${NAME_SEPARATOR}${toolName}`;
}

export function unqualify(qualifiedName: string): { accountId: string; toolName: string } | undefined {
  const i = qualifiedName.indexOf(NAME_SEPARATOR);
  if (i <= 0) return undefined;
  return { accountId: qualifiedName.slice(0, i), toolName: qualifiedName.slice(i + NAME_SEPARATOR.length) };
}

/** MCP content block, kept loose: the gateway passes unknown types through. */
export type ContentBlock = { type: "text"; text: string } | { type: string; [k: string]: unknown };

export interface ToolResult {
  content: ContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export type AccountState =
  | { status: "stopped" }
  | { status: "starting" }
  | { status: "connected" }
  | { status: "sign-in-needed"; reason: string }
  | { status: "unreachable"; reason: string; retryAt?: number }
  | { status: "error"; reason: string };

/** Errors the gateway returns to clients. `code` is stable; `message` is for humans. */
export class GatewayError extends Error {
  constructor(
    public readonly code:
      | "unknown-tool"
      | "not-in-profile"
      | "denied"
      | "approval-required"
      | "sign-in-needed"
      | "unreachable"
      | "timeout"
      | "downstream-error"
      | "invalid-arguments",
    message: string,
  ) {
    super(message);
    this.name = "GatewayError";
  }
}
