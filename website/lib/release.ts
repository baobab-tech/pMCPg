// The latest release, read once at build time from the GitHub API. A failed call falls back to a pinned
// release, so a build never breaks. Archive names follow the release workflow: pmcpg-<version>-<target>.<ext>.
import { GITHUB } from "@/lib/site";

const FALLBACK = { tag: "v0.1.3", date: "2026-11-22T18:27:26Z" };

export const TARGETS = [
  { id: "darwin-arm64", label: "Mac (Apple silicon)", os: "mac", ext: "tar.gz" },
  { id: "darwin-x64", label: "Mac (Intel)", os: "mac", ext: "tar.gz" },
  { id: "windows-x64", label: "Windows", os: "windows", ext: "zip" },
  { id: "windows-arm64", label: "Windows (ARM)", os: "windows", ext: "zip" },
  { id: "linux-x64", label: "Linux (x64)", os: "linux", ext: "tar.gz" },
  { id: "linux-arm64", label: "Linux (ARM64)", os: "linux", ext: "tar.gz" },
  { id: "linux-x64-musl", label: "Linux x64, Alpine / musl", os: "linux", ext: "tar.gz", musl: true },
  { id: "linux-arm64-musl", label: "Linux ARM64, Alpine / musl", os: "linux", ext: "tar.gz", musl: true },
] as const;

export type TargetId = (typeof TARGETS)[number]["id"];

export interface Release {
  version: string;
  tag: string;
  date: string;
  /** Download URL per target, only for archives the release has. */
  files: Partial<Record<TargetId, string>>;
  url: string;
}

export async function latestRelease(): Promise<Release> {
  let tag = FALLBACK.tag;
  let date = FALLBACK.date;
  let assets: Set<string> | null = null;
  try {
    const r = await fetch("https://api.github.com/repos/baobab-tech/pMCPg/releases/latest", {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "pmcpg-website-build" },
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const j = (await r.json()) as { tag_name?: string; published_at?: string; assets?: { name: string }[] };
      if (j.tag_name?.startsWith("v")) {
        tag = j.tag_name;
        date = j.published_at ?? date;
        assets = new Set((j.assets ?? []).map((a) => a.name));
      }
    }
  } catch {
    // Offline or rate-limited: keep the pinned release.
  }
  const version = tag.slice(1);
  const files: Release["files"] = {};
  for (const t of TARGETS) {
    const name = `pmcpg-${version}-${t.id}.${t.ext}`;
    if (!assets || assets.has(name)) files[t.id] = `${GITHUB}/releases/download/${tag}/${name}`;
  }
  return { version, tag, date, files, url: `${GITHUB}/releases/tag/${tag}` };
}
