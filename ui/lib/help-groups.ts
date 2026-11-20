// Help article groups, in display order. Shared by the build-time loader and the client index.

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

export type HelpGroupId = (typeof HELP_GROUPS)[number]["id"];

/** What the index and search need: no body. */
export interface HelpSummary {
  slug: string;
  title: string;
  summary: string;
  group: HelpGroupId;
  order: number;
  /** Has a live panel that reads this gateway's state. */
  live: boolean;
}

/** Help URL for an article: "/help/add-server-by-url/". */
export const helpHref = (slug: string, query?: Record<string, string>) =>
  `/help/${slug}/${query ? `?${new URLSearchParams(query)}` : ""}`;

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "");

/** Every word of the query must appear in the title or summary. Title hits rank first. */
export function searchHelp(articles: HelpSummary[], query: string): HelpSummary[] {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return articles;
  return articles
    .map((a) => {
      const title = norm(a.title);
      const text = `${title} ${norm(a.summary)}`;
      if (!words.every((w) => text.includes(w))) return undefined;
      return { a, score: words.filter((w) => title.includes(w)).length };
    })
    .filter((x) => x !== undefined)
    .sort((x, y) => y.score - x.score)
    .map((x) => x.a);
}
