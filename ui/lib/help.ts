// Build-time loader for help articles in help/*.md at the repo root, shared with website/. Runs only during `next build`
// (server components with static export), so `marked` and `fs` never reach the browser.
//
// Front matter: title, summary, group, order. Body: Markdown, plus two kinds of block markers on
// their own line: {{live:<name>}} for a panel that reads live state, {{diagram:<name>}} for a picture.
// Links to other articles use help:<slug>; the build fails on an unknown slug, group or marker.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";
import { HELP_GROUPS, type HelpGroupId, type HelpSummary, helpHref } from "./help-groups";

export const LIVE_PANELS = ["get-started", "connect-app", "account-doctor", "password-status", "key-source"] as const;
export const DIAGRAMS = [
  "request-flow",
  "profiles",
  "where-data-goes",
  "before-after",
  "objects",
  "keychain-prompt",
  "claude-manage-plugins",
  "claude-copy-url",
  "claude-turn-off",
] as const;
const CONNECT_APPS = ["claude-desktop", "claude-code", "lm-studio", "cursor", "vscode"];
export type LivePanel = (typeof LIVE_PANELS)[number];
export type Diagram = (typeof DIAGRAMS)[number];

export type HelpBlock =
  | { kind: "html"; html: string }
  | { kind: "live"; name: LivePanel; arg?: string }
  | { kind: "diagram"; name: Diagram };

export interface HelpArticle extends HelpSummary {
  blocks: HelpBlock[];
}

// `next build` runs in ui/, so the shared folder is one level up.
const DIR = join(process.cwd(), "..", "help");
const MARKER = /^\{\{(live|diagram):([a-z-]+)(?:\s+([a-z0-9-]+))?\}\}$/;

function parseFrontMatter(file: string, src: string): { meta: Record<string, string>; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(src);
  if (!m) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of (m[1] ?? "").split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    meta[line.slice(0, i).trim()] = line
      .slice(i + 1)
      .trim()
      .replace(/^"(.*)"$/, "$1");
  }
  return { meta, body: src.slice(m[0].length) };
}

function makeMarked(file: string, slugs: Set<string>) {
  const marked = new Marked({ gfm: true });
  marked.use({
    walkTokens(token) {
      if (token.type !== "link") return;
      if (token.href.startsWith("help:")) {
        const [slug, query] = token.href.slice(5).split("?");
        if (!slug || !slugs.has(slug)) throw new Error(`${file}: link to unknown article "${token.href}"`);
        token.href = `${helpHref(slug)}${query ? `?${query}` : ""}`;
      }
    },
    renderer: {
      // Outside links open in a new tab; in-app links stay put.
      link({ href, text, tokens }) {
        const inner = tokens ? this.parser.parseInline(tokens) : text;
        const external = /^https?:\/\//.test(href);
        return `<a href="${href}"${external ? ' target="_blank" rel="noreferrer"' : ""}>${inner}</a>`;
      },
    },
  });
  return marked;
}

let cache: HelpArticle[] | undefined;

export function loadHelp(): HelpArticle[] {
  if (cache) return cache;
  const files = readdirSync(DIR).filter((f) => f.endsWith(".md"));
  const slugs = new Set(files.map((f) => f.replace(/\.md$/, "")));
  const groups = new Set<string>(HELP_GROUPS.map((g) => g.id));
  const articles = files.map((file): HelpArticle => {
    const { meta, body } = parseFrontMatter(file, readFileSync(join(DIR, file), "utf8"));
    const { title, summary, group, order } = meta;
    if (!title || !summary || !group || !order) throw new Error(`${file}: needs title, summary, group and order`);
    if (!groups.has(group)) throw new Error(`${file}: unknown group "${group}"`);
    const marked = makeMarked(file, slugs);
    const blocks: HelpBlock[] = [];
    let chunk: string[] = [];
    const flush = () => {
      const md = chunk.join("\n").trim();
      if (!md) return;
      // Wide tables scroll inside their own box on small screens.
      const html = marked
        .parse(md, { async: false })
        .replaceAll("<table>", '<div class="help-table"><table>')
        .replaceAll("</table>", "</table></div>");
      blocks.push({ kind: "html", html });
      chunk = [];
    };
    for (const line of body.split("\n")) {
      const m = MARKER.exec(line.trim());
      if (!m) {
        chunk.push(line);
        continue;
      }
      flush();
      const [, kind, name, arg] = m;
      if (kind === "live") {
        if (!LIVE_PANELS.includes(name as LivePanel)) throw new Error(`${file}: unknown live panel "${name}"`);
        if (name === "connect-app" && !CONNECT_APPS.includes(arg ?? ""))
          throw new Error(`${file}: connect-app needs one of ${CONNECT_APPS.join(", ")}`);
        blocks.push({ kind: "live", name: name as LivePanel, ...(arg ? { arg } : {}) });
      } else {
        if (!DIAGRAMS.includes(name as Diagram)) throw new Error(`${file}: unknown diagram "${name}"`);
        blocks.push({ kind: "diagram", name: name as Diagram });
      }
    }
    flush();
    return {
      slug: file.replace(/\.md$/, ""),
      title,
      summary,
      group: group as HelpGroupId,
      order: Number(order),
      live: blocks.some((b) => b.kind === "live"),
      blocks,
    };
  });
  const groupIndex = (g: string) => HELP_GROUPS.findIndex((x) => x.id === g);
  articles.sort((a, b) => groupIndex(a.group) - groupIndex(b.group) || a.order - b.order);
  cache = articles;
  return articles;
}

export function helpSummaries(): HelpSummary[] {
  return loadHelp().map(({ blocks: _, ...s }) => s);
}
