// Build-time loader for the shared help articles in help/*.md at the repo root. The gateway's web UI reads the
// same files (ui/lib/help.ts). Runs only during `next build`, so `marked` and `fs` never reach the browser.
//
// Differences from the web UI:
// - Links to web UI pages (/import/, /servers/…) become plain bold text: the site has no such pages.
// - {{live:…}} panels read a running gateway; here they become a note pointing to the same page in pMCPg.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Marked } from "marked";

// Keep in step with ui/lib/help-groups.ts and ui/lib/help.ts.
export const HELP_GROUPS = [
  { id: "getting-started", title: "Getting started" },
  { id: "connect", title: "Connect your AI app" },
  { id: "servers", title: "Servers and accounts" },
  { id: "profiles", title: "Profiles" },
  { id: "privacy", title: "Privacy and masking" },
  { id: "policy", title: "Approvals and policy" },
  { id: "security", title: "Security and your keys" },
  { id: "troubleshooting", title: "Troubleshooting" },
] as const;
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
export type Diagram = (typeof DIAGRAMS)[number];
type GroupId = (typeof HELP_GROUPS)[number]["id"];

export type HelpBlock = { kind: "html"; html: string } | { kind: "live" } | { kind: "diagram"; name: Diagram };

export interface HelpSummary {
  slug: string;
  title: string;
  summary: string;
  group: GroupId;
  order: number;
}
export interface HelpArticle extends HelpSummary {
  blocks: HelpBlock[];
}

export const helpHref = (slug: string) => `/help/${slug}/`;

// `next build` runs in website/, so the shared folder is one level up.
const DIR = join(process.cwd(), "..", "help");
const MARKER = /^\{\{(live|diagram):([a-z-]+)(?:\s+([a-z0-9-]+))?\}\}$/;

function parseFrontMatter(file: string, src: string) {
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
        const slug = token.href.slice(5).split("?")[0];
        if (!slug || !slugs.has(slug)) throw new Error(`${file}: link to unknown article "${token.href}"`);
        token.href = helpHref(slug);
      }
    },
    renderer: {
      link({ href, text, tokens }) {
        const inner = tokens ? this.parser.parseInline(tokens) : text;
        if (href.startsWith("/") && !href.startsWith("/help/"))
          return `<span class="app-link" title="A page in the pMCPg web UI">${inner}</span>`;
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
      const [, kind, name] = m;
      if (kind === "live") {
        if (!blocks.some((b) => b.kind === "live")) blocks.push({ kind: "live" });
      } else {
        if (!DIAGRAMS.includes(name as Diagram)) throw new Error(`${file}: unknown diagram "${name}"`);
        blocks.push({ kind: "diagram", name: name as Diagram });
      }
    }
    flush();
    return { slug: file.replace(/\.md$/, ""), title, summary, group: group as GroupId, order: Number(order), blocks };
  });
  const gi = (g: string) => HELP_GROUPS.findIndex((x) => x.id === g);
  articles.sort((a, b) => gi(a.group) - gi(b.group) || a.order - b.order);
  cache = articles;
  return articles;
}
