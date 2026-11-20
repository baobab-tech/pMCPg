// Activity log contract. Implementation owner: p2-pinning-log (table `activity`, payload encrypted with the data key).
import type { EventSink, GatewayEvent } from "./events.ts";

export interface ActivityEntry {
  id: number;
  at: number;
  event: GatewayEvent;
}

export interface ActivityQuery {
  since?: number;
  before?: number;
  type?: GatewayEvent["type"];
  profileId?: string;
  accountId?: string;
  limit?: number;
}

export interface ActivityLog extends EventSink {
  query(q?: ActivityQuery): Promise<ActivityEntry[]>;
  /** Delete entries older than the retention period. Returns rows removed. */
  prune(retentionDays: number): number;
  subscribe(listener: (e: ActivityEntry) => void): () => void;
}
