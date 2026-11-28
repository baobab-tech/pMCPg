// toolsHash: one digest for a server's whole tool list, recorded at review and compared on first connect.
import { createHash } from "node:crypto";
import type { DownstreamTool } from "../connectors/connector.ts";
import { pinHash } from "../pinning/store.ts";

/** sha256 over the sorted per-tool pin hashes, one per line. Order of the server's list does not matter. */
export function catalogToolsHash(tools: readonly DownstreamTool[]): string {
  const lines = tools.map(pinHash).sort().join("\n");
  return createHash("sha256").update(lines).digest("hex");
}
