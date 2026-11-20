// Readable diffs between a pinned tool and its listed version. Used by `pmcpg tools review` and the web UI.
import type { DownstreamTool } from "../connectors/connector.ts";

export interface DiffLine {
  op: "same" | "added" | "removed";
  text: string;
}

export interface ToolDiff {
  /** Empty when unchanged. */
  name: DiffLine[];
  /** Empty when unchanged. */
  title: DiffLine[];
  description: DiffLine[];
  inputSchema: DiffLine[];
  /** Empty when unchanged. Policy reads readOnlyHint and destructiveHint from here. */
  annotations: DiffLine[];
}

/** Above this many lines per side, the diff shows everything as removed then added. */
const MAX_LINES = 2000;

/** Lines of a JSON value with object keys sorted, so key order never shows up as a change. */
export function schemaLines(value: unknown): string[] {
  return JSON.stringify(sortKeys(value), null, 2).split("\n");
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(o)
        .sort()
        .map((k) => [k, sortKeys(o[k])]),
    );
  }
  return v;
}

/** Line diff (longest common subsequence). */
export function diffLines(before: string[], after: string[]): DiffLine[] {
  if (before.length > MAX_LINES || after.length > MAX_LINES) {
    return [
      ...before.map((text) => ({ op: "removed" as const, text })),
      ...after.map((text) => ({ op: "added" as const, text })),
    ];
  }
  const n = before.length;
  const m = after.length;
  // lcs[i][j] = LCS length of before[i..] and after[j..]
  const lcs = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const row = lcs[i] as Uint32Array;
      const next = lcs[i + 1] as Uint32Array;
      row[j] =
        before[i] === after[j]
          ? (next[j + 1] as number) + 1
          : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ op: "same", text: before[i++] as string });
      j++;
    } else if (((lcs[i + 1] as Uint32Array)[j] as number) >= ((lcs[i] as Uint32Array)[j + 1] as number)) {
      out.push({ op: "removed", text: before[i++] as string });
    } else {
      out.push({ op: "added", text: after[j++] as string });
    }
  }
  while (i < n) out.push({ op: "removed", text: before[i++] as string });
  while (j < m) out.push({ op: "added", text: after[j++] as string });
  return out;
}

/** Description split into sentences, one per line, so a changed sentence stands out in a long paragraph. */
export function descriptionLines(text: string | undefined): string[] {
  if (!text) return [];
  return text
    .split("\n")
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=\S)/))
    .map((l) => l.trimEnd())
    .filter((l, idx, all) => l !== "" || (idx > 0 && all[idx - 1] !== ""));
}

const changed = (lines: DiffLine[]) => lines.some((l) => l.op !== "same");

/** Diff of the hashed fields. With no pinned version, everything shows as added. */
export function diffTool(pinned: DownstreamTool | undefined, current: DownstreamTool): ToolDiff {
  const name = diffLines(pinned ? [pinned.name] : [], [current.name]);
  const title = diffLines(pinned?.title ? [pinned.title] : [], current.title ? [current.title] : []);
  const annotations = diffLines(
    pinned?.annotations ? schemaLines(pinned.annotations) : [],
    current.annotations ? schemaLines(current.annotations) : [],
  );
  return {
    name: changed(name) ? name : [],
    title: changed(title) ? title : [],
    description: diffLines(descriptionLines(pinned?.description), descriptionLines(current.description)),
    inputSchema: diffLines(pinned ? schemaLines(pinned.inputSchema) : [], schemaLines(current.inputSchema)),
    annotations: changed(annotations) ? annotations : [],
  };
}

/**
 * Plain-text rendering: `+` added, `-` removed, unchanged lines indented.
 * Unchanged runs longer than `context` lines around changes are collapsed to "…".
 */
export function formatDiff(diff: ToolDiff, context = 3): string {
  const out: string[] = [];
  const section = (title: string, lines: DiffLine[]) => {
    if (!changed(lines)) return;
    out.push(`${title}:`);
    for (const l of collapse(lines, context)) out.push(l);
  };
  section("name", diff.name);
  section("title", diff.title);
  section("description", diff.description);
  section("input schema", diff.inputSchema);
  section("annotations", diff.annotations);
  return out.join("\n");
}

function collapse(lines: DiffLine[], context: number): string[] {
  const near = lines.map(() => false);
  lines.forEach((l, i) => {
    if (l.op === "same") return;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) near[k] = true;
  });
  const out: string[] = [];
  let skipped = false;
  lines.forEach((l, i) => {
    if (!near[i]) {
      if (!skipped) out.push("  …");
      skipped = true;
      return;
    }
    skipped = false;
    out.push(`${l.op === "added" ? "+ " : l.op === "removed" ? "- " : "  "}${l.text}`);
  });
  return out;
}
