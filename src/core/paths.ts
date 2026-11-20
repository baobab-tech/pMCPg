// Data directory per OS. PMCPG_HOME overrides everything (tests, Docker: /data).
import { homedir } from "node:os";
import { join } from "node:path";

export function dataDir(env = process.env, platform = process.platform): string {
  if (env.PMCPG_HOME) return env.PMCPG_HOME;
  if (platform === "darwin") return join(homedir(), "Library", "Application Support", "Private MCP Gateway");
  if (platform === "win32")
    return join(env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Private MCP Gateway");
  return join(env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "private-mcp-gateway");
}

export const paths = (dir = dataDir()) => ({
  dir,
  config: join(dir, "config.yaml"),
  db: join(dir, "state.db"),
});
