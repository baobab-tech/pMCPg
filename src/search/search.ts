// Search contract. Owner: search + front door (Phase 1, session D).
import type { ToolRef } from "../core/types.ts";

export interface ToolIndex {
  /** Replace the tool set for one profile. Cheap enough to call on every change. */
  setTools(profileId: string, tools: ToolRef[]): void;
  /** Best matches first. `limit` defaults to 5, max 10. */
  search(profileId: string, query: string, limit?: number): ToolRef[];
  /** Exact lookup by qualified name, for call_tool. */
  get(profileId: string, qualifiedName: string): ToolRef | undefined;
}
