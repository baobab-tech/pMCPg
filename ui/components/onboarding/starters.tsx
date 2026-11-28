"use client";

import { useEffect, useState } from "react";
import { SIMPLE_TIERS } from "@/components/catalog/labels";
import { api, type CatalogEntry, type CatalogResponse } from "@/lib/api";
import { cn } from "@/lib/utils";

// Starters: Built by Baobab and Approved catalog entries when the saved catalog has any, otherwise a few
// public remote servers that work today (docs/plans/onboarding-v2.md). Loading the catalog reads the
// saved copy and never contacts pmcpg.io. A static starter is probed when picked; a catalog starter
// opens the catalog add dialog.

export interface Starter {
  id: string;
  name: string;
  url: string;
  blurb: string;
  signIn: "none" | "sign-in";
  /** Something to ask the AI app to try it out. */
  prompt: string;
  color: string;
  /** Set for starters taken from the catalog. */
  entry?: Extract<CatalogEntry, { available: true }>;
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


const COLORS = STARTERS.map((s) => s.color);

/** Catalog starters, best tier first; empty when the catalog has none to offer. */
export function catalogStarters(entries: CatalogEntry[], max = 6): Starter[] {
  return entries
    .filter((e): e is Extract<CatalogEntry, { available: true }> => e.available && SIMPLE_TIERS.includes(e.tier))
    .sort((a, b) => SIMPLE_TIERS.indexOf(a.tier) - SIMPLE_TIERS.indexOf(b.tier))
    .slice(0, max)
    .map((e, i) => ({
      id: e.name,
      name: e.title,
      url: e.kind === "remote" ? e.target : "",
      blurb: e.description,
      signIn: e.auth.type === "none" && e.credentials.length === 0 ? "none" : "sign-in",
      prompt: e.samplePrompt ?? `Using ${e.title}, what can you do for me?`,
      color: COLORS[i % COLORS.length] as string,
      entry: e,
    }));
}

/** Starters to show: from the saved catalog when it has any, else the static list. */
export function useStarters(): Starter[] {
  const [starters, setStarters] = useState<Starter[]>(STARTERS);
  useEffect(() => {
    let stop = false;
    api
      .get<CatalogResponse>("/catalog")
      .then((c) => {
        const fromCatalog = catalogStarters(c.entries);
        if (!stop && fromCatalog.length) setStarters(fromCatalog);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, []);
  return starters;
}

export function StarterTiles({
  starters,
  value,
  onPick,
  compact,
}: {
  starters: Starter[];
  /** Id of the picked starter. */
  value?: string;
  onPick: (s: Starter) => void;
  compact?: boolean;
}) {
  const fromCatalog = starters.some((s) => s.entry);
  return (
    <div className="grid gap-2">
      <p className="text-sm text-muted-foreground">
        {compact
          ? "Start with one of these, or paste an address below."
          : fromCatalog
            ? "Services reviewed by the pMCPg team. More in the catalog."
            : "A few public services to start with. More in the catalog."}
      </p>
      <div className={cn("grid grid-cols-1 gap-2", compact ? "sm:grid-cols-2" : "min-[420px]:grid-cols-2")}>
        {starters.map((s) => (
          <button
            key={s.id}
            type="button"
            aria-pressed={value === s.id}
            onClick={() => onPick(s)}
            className={cn(
              "flex items-center gap-3 rounded-xl border p-3 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              value === s.id ? "border-brand bg-brand/5 ring-1 ring-brand" : "hover:bg-muted/50",
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
