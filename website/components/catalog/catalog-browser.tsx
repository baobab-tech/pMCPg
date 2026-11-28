"use client";

// Filters over the catalog, which is shipped in the page at build time; nothing is fetched.
import { ExternalLinkIcon } from "lucide-react";
import { useState } from "react";
import { CopyLine } from "@/components/copy-line";
import { addTarget, type CatalogEntry, cur, TIER_LABEL, TRUST_LABEL, type Tier, words } from "@/lib/catalog";
import { cn } from "@/lib/utils";

const TIER_STYLE: Record<Tier, string> = {
  "baobab-built": "border-brand/40 bg-brand-soft text-brand",
  approved: "border-ok/40 bg-ok/10 text-ok",
  community: "text-muted-foreground",
};

export function TierBadge({ tier }: { tier: Tier }) {
  return (
    <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap", TIER_STYLE[tier])}>
      {TIER_LABEL[tier]}
    </span>
  );
}

const SIGN_IN: Record<string, string> = { none: "No sign-in", oauth: "Sign in", header: "API key" };

function Chips({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-1.5">
      <legend className="sr-only">{label}</legend>
      <span className="mr-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</span>
      {["", ...options].map((o) => (
        <button
          key={o || "all"}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
            value === o ? "border-brand bg-brand-soft text-foreground" : "text-muted-foreground hover:bg-muted",
          )}
        >
          {o ? words(o) : "All"}
        </button>
      ))}
    </fieldset>
  );
}

function EntryCard({ e }: { e: CatalogEntry }) {
  const c = cur(e);
  const add = addTarget(e);
  const id = e.name.replace(/[^a-z0-9]+/gi, "-");
  return (
    <li id={id} className="flex scroll-mt-20 flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 font-semibold">{e.title ?? e.name}</h3>
        <TierBadge tier={c.tier} />
      </div>
      <p className="text-sm text-muted-foreground">{e.description}</p>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-md bg-muted px-1.5 py-0.5">{SIGN_IN[c.auth.type]}</span>
        {c.trust.map((t) => (
          <span key={t} className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">
            {TRUST_LABEL[t]}
          </span>
        ))}
        {c.privacy === "strict" && (
          <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">Strict masking</span>
        )}
      </div>
      {add && (
        <div className="mt-auto grid gap-1">
          <span className="text-xs text-muted-foreground">
            {add.kind === "url" ? "Paste in pMCPg → Servers → Add a server" : "pMCPg → Add a server → On this computer"}
          </span>
          <CopyLine text={add.text} />
        </div>
      )}
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="font-mono">{e.name}</span>
        {(e.websiteUrl ?? c.source) && (
          <a href={e.websiteUrl ?? c.source} className="inline-flex items-center gap-1 hover:text-foreground">
            Docs <ExternalLinkIcon className="size-3" />
          </a>
        )}
        <span>Reviewed {c.reviewedAt}</span>
      </div>
    </li>
  );
}

export function CatalogBrowser({ entries }: { entries: CatalogEntry[] }) {
  const [audience, setAudience] = useState("");
  const [category, setCategory] = useState("");
  const uniq = (xs: string[]) => [...new Set(xs)].sort((a, b) => words(a).localeCompare(words(b)));
  const audiences = uniq(entries.flatMap((e) => cur(e).audience));
  const categories = uniq(entries.flatMap((e) => cur(e).categories));
  const shown = entries.filter(
    (e) =>
      (!audience || cur(e).audience.includes(audience)) && (!category || cur(e).categories.includes(category)),
  );
  return (
    <div>
      <div className="grid gap-3">
        <Chips label="For" options={audiences} value={audience} onChange={setAudience} />
        <Chips label="Kind" options={categories} value={category} onChange={setCategory} />
      </div>
      <p className="mt-4 text-sm text-muted-foreground" aria-live="polite">
        {shown.length} of {entries.length} servers
      </p>
      <ul className="mt-3 grid gap-3 md:grid-cols-2">
        {shown.map((e) => (
          <EntryCard key={e.name} e={e} />
        ))}
      </ul>
    </div>
  );
}
