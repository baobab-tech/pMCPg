// Tier 0 detectors: PII patterns and secret rules. Both run on the CPU with no model.
import type { PrivacyLevel } from "../core/config.ts";
import type { Detector, PiiType, Span } from "./detector.ts";
import { PATTERNS, type PiiPattern } from "./patterns.ts";
import { findSecrets } from "./secrets/scan.ts";

/** Types each level masks. Secrets are scanned separately and at every level. */
export const LEVEL_TYPES: Record<Exclude<PrivacyLevel, "off">, PiiType[]> = {
  standard: ["EMAIL", "PHONE", "CARD", "IBAN", "IP", "NATIONAL_ID"],
  strict: ["EMAIL", "PHONE", "CARD", "IBAN", "IP", "NATIONAL_ID", "PERSON", "ORG", "ADDRESS"],
};

export function patternsFor(level: PrivacyLevel): PiiPattern[] {
  if (level === "off") return [];
  return PATTERNS.filter((p) => level === "strict" || p.level === "standard");
}

/** Spans plus the id of the pattern or rule that found them, for reports. */
export interface Finding extends Span {
  rule: string;
}

export function findPii(text: string, level: PrivacyLevel): Finding[] {
  const out: Finding[] = [];
  for (const p of patternsFor(level)) {
    p.re.lastIndex = 0;
    for (let m = p.re.exec(text); m; m = p.re.exec(text)) {
      if (m[0].length === 0) {
        p.re.lastIndex++;
        continue;
      }
      const g = p.group ?? 0;
      const idx = m.indices?.[g];
      const value = m[g];
      if (!idx || !value) continue;
      // Retry from the next character so a rejected wide match does not hide a valid narrower one.
      if (p.check && !p.check(value, text.slice(Math.max(0, idx[0] - 40), idx[0]))) {
        p.re.lastIndex = m.index + 1;
        continue;
      }
      // Trim trailing separators that a labelled value may have swallowed.
      let end = idx[1];
      while (end > idx[0] && /[\s,;.]/.test(text[end - 1] ?? "") && p.type !== "ORG") end--;
      out.push({ start: idx[0], end, type: p.type, confidence: p.confidence, rule: p.id });
    }
  }
  return out;
}

export const patternDetector: Detector = {
  name: "patterns",
  tier: 0,
  async detect(text, level) {
    return findPii(text, level);
  },
};

/** Ignores the level: secrets are redacted whenever secret scanning is on. */
export const secretDetector: Detector = {
  name: "secrets",
  tier: 0,
  async detect(text) {
    return findSecrets(text).map((s) => ({
      start: s.start,
      end: s.end,
      type: "SECRET" as const,
      confidence: 0.95,
    }));
  },
};

export const TIER0: Detector[] = [secretDetector, patternDetector];

/**
 * Resolves overlaps: secrets first, then higher confidence, then longer spans.
 * Returns non-overlapping spans sorted by start.
 */
export function mergeSpans<T extends Span>(spans: T[]): T[] {
  const rank = (s: Span) => (s.type === "SECRET" ? 10 : 0) + s.confidence;
  const sorted = [...spans].sort(
    (a, b) => rank(b) - rank(a) || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  // `kept` stays sorted by start and non-overlapping, so one binary search finds the neighbours.
  const kept: T[] = [];
  for (const s of sorted) {
    if (s.end <= s.start) continue;
    let lo = 0;
    let hi = kept.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((kept[mid]?.start ?? 0) < s.start) lo = mid + 1;
      else hi = mid;
    }
    const prev = kept[lo - 1];
    const next = kept[lo];
    if ((prev && prev.end > s.start) || (next && next.start < s.end)) continue;
    kept.splice(lo, 0, s);
  }
  return kept;
}
