"use client";

import { cn } from "@/lib/utils";

// A few public remote servers that work today, until the catalog exists (docs/plans/onboarding-v2.md).
// Nothing is fetched until the user picks one; the probe then decides the sign-in type.

export interface Starter {
  id: string;
  name: string;
  url: string;
  blurb: string;
  signIn: "none" | "sign-in";
  /** Something to ask the AI app to try it out. */
  prompt: string;
  color: string;
}

export const STARTERS: Starter[] = [
  {
    id: "deepwiki",
    name: "DeepWiki",
    url: "https://mcp.deepwiki.com/mcp",
    blurb: "Ask about any public code project",
    signIn: "none",
    prompt: "Using DeepWiki, explain what the modelcontextprotocol/typescript-sdk repository does.",
    color: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  },
  {
    id: "huggingface",
    name: "Hugging Face",
    url: "https://huggingface.co/mcp",
    blurb: "Search AI models, datasets and papers",
    signIn: "none",
    prompt: "Using Hugging Face, find three small open models for translating French to English.",
    color: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  },
  {
    id: "notion",
    name: "Notion",
    url: "https://mcp.notion.com/mcp",
    blurb: "Your pages and notes",
    signIn: "sign-in",
    prompt: "Using Notion, list the pages I edited this week.",
    color: "bg-zinc-500/15 text-zinc-700 dark:text-zinc-300",
  },
  {
    id: "linear",
    name: "Linear",
    url: "https://mcp.linear.app/mcp",
    blurb: "Your team's issues and projects",
    signIn: "sign-in",
    prompt: "Using Linear, show the issues assigned to me.",
    color: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
  },
  {
    id: "atlassian",
    name: "Atlassian",
    url: "https://mcp.atlassian.com/v1/mcp",
    blurb: "Jira issues and Confluence pages",
    signIn: "sign-in",
    prompt: "Using Jira, list my open issues.",
    color: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  },
];

export const starterByUrl = (url?: string) => STARTERS.find((s) => s.url === url);

export function StarterTiles({
  value,
  onPick,
  compact,
}: {
  value?: string;
  onPick: (url: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        {compact ? "Start with one of these, or paste an address below." : "A few public services to start with. More will come with the catalog."}
      </p>
      <div className={cn("grid grid-cols-1 gap-2", compact ? "sm:grid-cols-2" : "min-[420px]:grid-cols-2")}>
        {STARTERS.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={value === s.url}
            onClick={() => onPick(s.url)}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              value === s.url ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-muted/50",
            )}
          >
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg font-semibold", s.color)}>
              {s.name[0]}
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium">{s.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {s.blurb} · {s.signIn === "none" ? "no sign-in" : "sign in"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
