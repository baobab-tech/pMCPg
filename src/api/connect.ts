// Copy-ready snippets for "Connect a client".
import { ALL_PROFILE } from "../core/config.ts";

export interface ClientSnippet {
  id: "claude-code" | "claude-desktop" | "vscode" | "http";
  title: string;
  /** Where to paste it, in plain words. */
  hint: string;
  language: "bash" | "json" | "text";
  code: string;
}

export function profileUrl(baseUrl: string, profileId: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return profileId === ALL_PROFILE ? `${base}/mcp` : `${base}/p/${profileId}/mcp`;
}

/** Name the client shows for this connection. */
export function clientName(profileId: string): string {
  return profileId === ALL_PROFILE ? "pmcpg" : `pmcpg-${profileId}`;
}

/**
 * Snippets lead with the stdio bridge (`pmcpg connect <profile>`): the app stores no token.
 * Only "Other clients" uses the URL and the token.
 */
export function snippets(baseUrl: string, profileId: string, token: string): ClientSnippet[] {
  const url = profileUrl(baseUrl, profileId);
  const name = clientName(profileId);
  const bridge = { command: "pmcpg", args: ["connect", profileId] };
  return [
    {
      id: "claude-code",
      title: "Claude Code",
      hint: "Run this in a terminal. Claude Code starts pMCPg itself; no token is stored in its settings.",
      language: "bash",
      code: `claude mcp add --scope user ${name} -- pmcpg connect ${profileId}`,
    },
    {
      id: "claude-desktop",
      title: "Claude Desktop, Cursor, LM Studio",
      hint: "Add this to claude_desktop_config.json (Settings → Developer → Edit Config), ~/.cursor/mcp.json or ~/.lmstudio/mcp.json, then restart the app. The token stays in pMCPg. If the app cannot find pmcpg, use its full path (run: which pmcpg).",
      language: "json",
      code: JSON.stringify({ mcpServers: { [name]: bridge } }, null, 2),
    },
    {
      id: "vscode",
      title: "VS Code",
      hint: "Add this to .vscode/mcp.json in your project, or to your user mcp.json. The token stays in pMCPg.",
      language: "json",
      code: JSON.stringify({ servers: { [name]: { type: "stdio", ...bridge } } }, null, 2),
    },
    {
      id: "http",
      title: "Other clients",
      hint: "For clients that cannot run a command: Streamable HTTP with a custom header. The client's settings then hold the token; treat them like a password.",
      language: "text",
      code: `URL:    ${url}\nHeader: Authorization: Bearer ${token}`,
    },
  ];
}
