// Skill file helpers: path rules, text-only filter, digests and limits.
import { createHash } from "node:crypto";
import { SKILL_LIMITS } from "@modelcontextprotocol/server/ext/skills";
import { SkillError, type SkillFileInfo, type SkillFileInput } from "./skills.ts";

export { SKILL_LIMITS };

/** Files kept in "text" mode. SKILL.md always matches. */
const TEXT_EXTENSIONS = [".md", ".markdown", ".txt"];

export function isTextFile(path: string): boolean {
  const lower = path.toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/** A relative, "/"-separated path with no empty, "." or ".." segments, no backslash and no control characters. */
export function validPath(path: string): boolean {
  if (!path || path.length > 500 || path.startsWith("/") || path.includes("\\")) return false;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control characters is the point
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== "..");
}

export function digestOf(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function fileInfo(path: string, content: Uint8Array): SkillFileInfo {
  return { path, size: content.byteLength, digest: digestOf(content) };
}

/** SKILL.md first, then the rest by path. */
export function sortFiles<T extends { path: string }>(files: T[]): T[] {
  return [...files].sort((a, b) =>
    a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : a.path.localeCompare(b.path),
  );
}

/** Problems with a set of files for one skill: paths, duplicates, limits, a SKILL.md at the root. */
export function checkFiles(files: SkillFileInput[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  let bytes = 0;
  for (const f of files) {
    if (!validPath(f.path))
      problems.push(`${JSON.stringify(f.path.slice(0, 100))}: not a valid relative path`);
    else if (seen.has(f.path)) problems.push(`${f.path}: listed twice`);
    seen.add(f.path);
    bytes += f.content.byteLength;
  }
  if (!seen.has("SKILL.md")) problems.push("SKILL.md: missing; every skill needs one at its root");
  if (files.length > SKILL_LIMITS.files)
    problems.push(`too many files: ${files.length} (limit ${SKILL_LIMITS.files})`);
  if (bytes > SKILL_LIMITS.bytes)
    problems.push(`too large: ${bytes} bytes (limit ${SKILL_LIMITS.bytes / 1024 / 1024} MiB)`);
  return problems;
}

export function assertFiles(files: SkillFileInput[]): void {
  const problems = checkFiles(files);
  if (problems.length) throw new SkillError(problems);
}

const decoder = new TextDecoder("utf-8", { fatal: true });

/** The bytes as UTF-8 text, or undefined when they are not valid UTF-8 (or hold NUL bytes). */
export function asText(bytes: Uint8Array): string | undefined {
  if (bytes.includes(0)) return undefined;
  try {
    return decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** Frontmatter name and description of a SKILL.md, or undefined when it has none. Not a validator: see skillEntry. */
export function frontmatter(text: string): { name?: string; description?: string } | undefined {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?(?:\n|$)/.exec(text);
  if (!m) return undefined;
  try {
    const data = Bun.YAML.parse(m[1] ?? "") as Record<string, unknown> | null;
    if (!data || typeof data !== "object") return undefined;
    return {
      ...(typeof data.name === "string" ? { name: data.name } : {}),
      ...(typeof data.description === "string" ? { description: data.description } : {}),
    };
  } catch {
    return undefined;
  }
}
