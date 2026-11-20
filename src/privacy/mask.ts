// Masking and re-hydration. Detectors find spans; this file turns them into placeholders and back.
import type { PrivacyLevel } from "../core/config.ts";
import type { MaskRecord, SessionState } from "../pipeline/step.ts";
import type { Detector, PiiType, Span } from "./detector.ts";
import { mergeSpans, patternDetector, secretDetector } from "./detectors.ts";

/** Secrets are replaced with this and never re-hydrated. */
export const SECRET_PLACEHOLDER = "[SECRET_REDACTED]";

/**
 * Matches placeholders this module creates: [EMAIL_1_k7qx], [NATIONAL_ID_12_k7qx].
 * The last part is the session tag. A new session (after a restart, or on another profile) has a new tag,
 * so a placeholder from an old conversation can never restore a value that a later session numbered the same.
 */
export const PLACEHOLDER_RE =
  /\[(EMAIL|PHONE|CARD|IBAN|IP|NATIONAL_ID|PERSON|ORG|ADDRESS)_(\d{1,6})_([a-z0-9]{4})\]/g;

const tags = new WeakMap<SessionState, string>();

/** Four base-36 characters derived from the session id. Session ids are random per gateway run. */
export function sessionTag(session: SessionState): string {
  let tag = tags.get(session);
  if (!tag) {
    tag = (BigInt(Bun.hash(session.id)) % 36n ** 4n).toString(36).padStart(4, "0");
    tags.set(session, tag);
  }
  return tag;
}

export interface MaskOptions {
  level: PrivacyLevel;
  /** Mask secrets too (as [SECRET_REDACTED]). */
  secrets: boolean;
  allow?: string[];
  skipTypes?: PiiType[];
  /** Defaults to the tier 0 detectors. */
  detectors?: Detector[];
  /** Account the text came from. Placeholders remember it, so values only go back to that account. */
  source?: string;
}

/** Runs the detectors and returns merged spans after allow and skip filters. */
export async function findSpans(text: string, opts: MaskOptions): Promise<Span[]> {
  const detectors = opts.detectors ?? [secretDetector, patternDetector];
  const allow = new Set((opts.allow ?? []).map((a) => a.trim().toLowerCase()));
  const skip = new Set(opts.skipTypes ?? []);
  const spans: Span[] = [];
  for (const d of detectors) {
    if (d === secretDetector && !opts.secrets) continue;
    if (d !== secretDetector && opts.level === "off") continue;
    for (const s of await d.detect(text, opts.level)) {
      if (skip.has(s.type)) continue;
      if (s.type === "SECRET" && !opts.secrets) continue;
      if (allow.size && allow.has(text.slice(s.start, s.end).trim().toLowerCase())) continue;
      spans.push(s);
    }
  }
  return mergeSpans(spans);
}

/** Placeholders a session keeps. Past this, the least recently used one is dropped and stops re-hydrating. */
export const MAX_PLACEHOLDERS = 10_000;

const counters = new WeakMap<SessionState, Map<string, number>>();
/** placeholder -> accounts whose results contained the value. Kept beside the session, in memory only. */
const origins = new WeakMap<SessionState, Map<string, Set<string>>>();

function recordOrigin(session: SessionState, placeholder: string, source: string | undefined): void {
  if (source === undefined) return;
  let map = origins.get(session);
  if (!map) {
    map = new Map();
    origins.set(session, map);
  }
  const set = map.get(placeholder) ?? new Set<string>();
  set.add(source);
  map.set(placeholder, set);
}

/** The session's placeholder for a value, created on first sight. `source` is the account it came from. */
export function placeholderFor(session: SessionState, type: PiiType, value: string, source?: string): string {
  if (type === "SECRET") return SECRET_PLACEHOLDER;
  const existing = session.reverse.get(value);
  if (existing) {
    touch(session, existing, value);
    recordOrigin(session, existing, source);
    return existing;
  }
  let byType = counters.get(session);
  if (!byType) {
    byType = new Map();
    for (const p of session.placeholders.keys()) {
      const m = /^\[([A-Z_]+)_(\d+)_[a-z0-9]{4}\]$/.exec(p);
      if (m?.[1] && m[2]) byType.set(m[1], Math.max(byType.get(m[1]) ?? 0, Number(m[2])));
    }
    counters.set(session, byType);
  }
  const n = (byType.get(type) ?? 0) + 1;
  byType.set(type, n);
  const placeholder = `[${type}_${n}_${sessionTag(session)}]`;
  session.placeholders.set(placeholder, value);
  session.reverse.set(value, placeholder);
  recordOrigin(session, placeholder, source);
  evict(session);
  return placeholder;
}

/** Marks a placeholder as recently used: Map order is the LRU order. */
function touch(session: SessionState, placeholder: string, value: string): void {
  session.placeholders.delete(placeholder);
  session.placeholders.set(placeholder, value);
}

/** Drops the least recently used placeholders past MAX_PLACEHOLDERS. Numbers are never reused. */
function evict(session: SessionState): void {
  while (session.placeholders.size > MAX_PLACEHOLDERS) {
    const [oldest, value] = session.placeholders.entries().next().value as [string, string];
    session.placeholders.delete(oldest);
    session.reverse.delete(value);
    origins.get(session)?.delete(oldest);
  }
}

/** Replaces spans in `text` with placeholders and records what was masked (never the values). */
export function applySpans(
  text: string,
  spans: Span[],
  session: SessionState,
  where: MaskRecord["where"],
  records: MaskRecord[],
  source?: string,
): string {
  if (!spans.length) return text;
  let out = "";
  let at = 0;
  for (const s of spans) {
    const placeholder = placeholderFor(session, s.type, text.slice(s.start, s.end), source);
    out += text.slice(at, s.start) + placeholder;
    at = s.end;
    records.push({ type: s.type, placeholder, where });
  }
  return out + text.slice(at);
}

export async function maskText(
  text: string,
  session: SessionState,
  opts: MaskOptions,
  where: MaskRecord["where"] = "result",
  records: MaskRecord[] = [],
): Promise<string> {
  return applySpans(text, await findSpans(text, opts), session, where, records, opts.source);
}

/**
 * Masks every string inside a JSON-like value, object keys included (a map keyed by email is common).
 * Keys in `skipFields` keep their values. Numbers and booleans pass through: changing their type would
 * break output schemas.
 */
export async function maskValue(
  value: unknown,
  session: SessionState,
  opts: MaskOptions & { skipFields?: string[] },
  where: MaskRecord["where"],
  records: MaskRecord[],
): Promise<unknown> {
  const skip = new Set(opts.skipFields ?? []);
  const walk = async (v: unknown, depth: number): Promise<unknown> => {
    if (typeof v === "string") return maskText(v, session, opts, where, records);
    if (v === null || typeof v !== "object") return v;
    // Past this depth, mask the serialised subtree rather than recurse further or let it through.
    if (depth > 64) return maskText(JSON.stringify(v), session, opts, where, records);
    if (Array.isArray(v)) {
      const out: unknown[] = [];
      for (const item of v) out.push(await walk(item, depth + 1));
      return out;
    }
    const out: [string, unknown][] = [];
    for (const [k, item] of Object.entries(v)) {
      if (skip.has(k)) out.push([k, item]);
      else out.push([await maskText(k, session, opts, where, records), await walk(item, depth + 1)]);
    }
    // fromEntries defines own properties, so a "__proto__" key stays data.
    return Object.fromEntries(out);
  };
  return walk(value, 0);
}

export interface RehydrateOptions {
  /** Account the call goes to. Placeholders from other accounts are not restored. */
  target?: string;
  /** Accounts that may receive values from any account. "*" means all. */
  shareWith?: string[];
}

export interface Rehydrated {
  count: number;
  /** Placeholders left in place because their value came from another account. */
  blocked: string[];
  /** Placeholder-shaped text this session never created: from before a restart, another profile, or made up. */
  unknown: string[];
}

function mayRestore(session: SessionState, placeholder: string, opts: RehydrateOptions): boolean {
  if (opts.target === undefined) return true;
  const share = opts.shareWith ?? [];
  if (share.includes("*") || share.includes(opts.target)) return true;
  const from = origins.get(session)?.get(placeholder);
  // No recorded source: created outside the masking pipeline (CLI, tests), so not tied to an account.
  return !from || from.has(opts.target);
}

/**
 * Puts real values back for placeholders this session created. Unknown placeholders stay as they are and
 * are listed in `unknown`. With `target`, a value only goes back to an account whose results contained it.
 */
export function rehydrateText(
  text: string,
  session: SessionState,
  opts: RehydrateOptions = {},
): Rehydrated & { text: string } {
  const blocked: string[] = [];
  const unknown: string[] = [];
  if (!text.includes("[")) return { text, count: 0, blocked, unknown };
  let count = 0;
  const out = text.replace(PLACEHOLDER_RE, (m) => {
    const real = session.placeholders.get(m);
    if (real === undefined) {
      unknown.push(m);
      return m;
    }
    if (!mayRestore(session, m, opts)) {
      blocked.push(m);
      return m;
    }
    touch(session, m, real);
    count++;
    return real;
  });
  return { text: out, count, blocked, unknown };
}

/** Re-hydrates every string in a JSON-like value, object keys included. Returns a new value; the input is not changed. */
export function rehydrateValue(
  value: unknown,
  session: SessionState,
  opts: RehydrateOptions = {},
): Rehydrated & { value: unknown } {
  let count = 0;
  const blocked = new Set<string>();
  const unknown = new Set<string>();
  const walk = (v: unknown, depth: number): unknown => {
    if (typeof v === "string") {
      const r = rehydrateText(v, session, opts);
      count += r.count;
      for (const b of r.blocked) blocked.add(b);
      for (const u of r.unknown) unknown.add(u);
      return r.text;
    }
    if (depth > 64 || v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1));
    return Object.fromEntries(
      Object.entries(v).map(([k, x]) => [walk(k, depth) as string, walk(x, depth + 1)]),
    );
  };
  return { value: walk(value, 0), count, blocked: [...blocked], unknown: [...unknown] };
}

/** A fresh in-memory session, for the CLI and tests. */
export function newSession(id = "local", profileId = "default"): SessionState {
  return { id, profileId, placeholders: new Map(), reverse: new Map(), seenTrust: new Set() };
}
