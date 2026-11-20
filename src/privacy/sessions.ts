// Privacy sessions: one placeholder map and taint set per profile and client. In memory only.
import type { SessionState } from "../pipeline/step.ts";
import { sessionTag } from "./mask.ts";

/** Idle time after which a session starts over. */
export const SESSION_IDLE_MS = 8 * 60 * 60 * 1000;
/** Sessions kept at once; past this the least recently used one is dropped. */
export const MAX_SESSIONS = 256;
/** Tags of dropped sessions that new sessions may not reuse. Oldest are forgotten first. */
export const MAX_RETIRED_TAGS = 4096;

export interface ResetCounts {
  /** Sessions dropped. */
  sessions: number;
  /** Placeholders those sessions held. */
  placeholders: number;
}

export class SessionStore {
  // Map order is the LRU order: a used session is moved to the end.
  private readonly sessions = new Map<string, { state: SessionState; usedAt: number }>();
  private readonly retired = new Set<string>();

  constructor(
    private readonly idleMs = SESSION_IDLE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** The session for a profile and client, created when missing or idle too long. */
  get(profileId: string, clientId: string | undefined): SessionState {
    const key = `${profileId}/${clientId ?? ""}`;
    const now = this.now();
    const found = this.sessions.get(key);
    this.sessions.delete(key);
    let state: SessionState;
    if (found && now - found.usedAt < this.idleMs) state = found.state;
    else {
      if (found) this.retire(found.state);
      state = this.create(profileId);
    }
    this.sessions.set(key, { state, usedAt: now });
    while (this.sessions.size > MAX_SESSIONS) {
      const [oldest, entry] = this.sessions.entries().next().value as [string, { state: SessionState }];
      this.sessions.delete(oldest);
      this.retire(entry.state);
    }
    return state;
  }

  /**
   * Forgets every placeholder of one profile, or of all profiles when `profileId` is undefined.
   * Later calls start new sessions with new tags, so an old placeholder stays literal text.
   */
  reset(profileId?: string): ResetCounts {
    let sessions = 0;
    let placeholders = 0;
    for (const [key, { state }] of this.sessions) {
      if (profileId !== undefined && state.profileId !== profileId) continue;
      sessions++;
      placeholders += state.placeholders.size;
      this.sessions.delete(key);
      this.retire(state);
    }
    return { sessions, placeholders };
  }

  clear(): void {
    this.sessions.clear();
  }

  private retire(state: SessionState): void {
    const tag = sessionTag(state);
    this.retired.delete(tag);
    this.retired.add(tag);
    while (this.retired.size > MAX_RETIRED_TAGS)
      this.retired.delete(this.retired.values().next().value as string);
    // Drop the values now rather than when the object is collected.
    state.placeholders.clear();
    state.reverse.clear();
    state.seenTrust.clear();
  }

  /** A new session whose random id gives a tag no dropped session used. */
  private create(profileId: string): SessionState {
    for (;;) {
      const state: SessionState = {
        id: crypto.randomUUID(),
        profileId,
        placeholders: new Map(),
        reverse: new Map(),
        seenTrust: new Set(),
      };
      if (!this.retired.has(sessionTag(state))) return state;
    }
  }
}
