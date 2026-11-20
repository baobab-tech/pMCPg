// Static files of the web UI (the Next.js export in ui/out), served with a strict CSP.
// Release builds embed the files through a generated module (scripts/embed-ui.ts writes ui-assets.gen.ts);
// development and tests can read a directory instead.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";

export interface UiAsset {
  /** File to serve: a path on disk, or the embedded path `bun build --compile` gives. */
  file: string;
  type: string;
  /** CSP hashes ('sha256-…') of the inline scripts in an HTML file. */
  scriptHashes?: string[];
}

/** Keyed by URL path: "/index.html", "/_next/static/…". */
export type UiAssets = Record<string, UiAsset>;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".webmanifest": "application/manifest+json",
  ".map": "application/json",
};

export function contentType(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
}

/** SHA-256 CSP sources for every inline <script> (no src attribute) in an HTML document. */
export function inlineScriptHashes(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(m[1] ?? "")) continue;
    const body = m[2] ?? "";
    if (body === "") continue;
    out.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return [...out];
}

/** Read a built export directory into an asset table. */
export function scanUiDir(dir: string): UiAssets {
  const assets: UiAssets = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else {
        const urlPath = `/${relative(dir, full).split(sep).join("/")}`;
        const type = contentType(full);
        assets[urlPath] = {
          file: full,
          type,
          ...(type.startsWith("text/html")
            ? { scriptHashes: inlineScriptHashes(readFileSync(full, "utf8")) }
            : {}),
        };
      }
    }
  };
  walk(dir);
  return assets;
}

/** The assets embedded at build time, or none when the UI was not built. */
export async function embeddedAssets(): Promise<UiAssets> {
  try {
    return (await import("./ui-assets.gen.ts")).assets;
  } catch {
    return {};
  }
}

export function csp(scriptHashes: string[] = []): string {
  return [
    "default-src 'none'",
    `script-src 'self' ${scriptHashes.join(" ")}`.trim(),
    // Components set inline style attributes; scripts stay hash-locked.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "same-origin",
  "x-frame-options": "DENY",
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
};

/** Map a request path to an asset key: "/" and "/servers/" serve index.html. */
export function resolveAsset(assets: UiAssets, path: string): UiAsset | undefined {
  if (path.includes("..")) return undefined;
  if (assets[path]) return assets[path];
  if (path.endsWith("/")) return assets[`${path}index.html`];
  return assets[`${path}/index.html`] ?? assets[`${path}.html`];
}

/** Response for a UI file, or undefined when the path is not one (so other routes can answer). */
export function assetResponse(assets: UiAssets, method: string, path: string): Response | undefined {
  if (method !== "GET" && method !== "HEAD") return undefined;
  const asset = resolveAsset(assets, path);
  if (!asset) return undefined;
  // Pages live under a trailing slash, as the export links them.
  if (asset.type.startsWith("text/html") && !path.endsWith("/") && !path.endsWith(".html"))
    return new Response(null, { status: 308, headers: { location: `${path}/` } });
  const headers: Record<string, string> = { ...SECURITY_HEADERS, "content-type": asset.type };
  if (asset.type.startsWith("text/html")) {
    headers["content-security-policy"] = csp(asset.scriptHashes);
    headers["cache-control"] = "no-cache";
  } else if (path.startsWith("/_next/static/")) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  } else {
    headers["cache-control"] = "no-cache";
  }
  return new Response(method === "HEAD" ? null : Bun.file(asset.file), { headers });
}
