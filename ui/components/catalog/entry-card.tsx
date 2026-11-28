"use client";

import { CheckIcon, GlobeIcon, MonitorIcon, PlusIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { CatalogEntry } from "@/lib/api";
import { cn } from "@/lib/utils";
import { signInLabel, TIER_HINT, TIER_LABEL, TIER_TONE, trustTitle } from "./labels";

export function TierBadge({ entry }: { entry: Pick<CatalogEntry, "tier"> }) {
  return (
    <Badge variant="secondary" className={TIER_TONE[entry.tier]} title={TIER_HINT[entry.tier]}>
      {TIER_LABEL[entry.tier]}
    </Badge>
  );
}

/** One catalog entry: name, one line, tier, sign-in type, trust in plain words, Add. */
export function EntryCard({ entry, onAdd }: { entry: CatalogEntry; onAdd: () => void }) {
  const local = entry.available && entry.kind === "package";
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm" data-entry={entry.name}>
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted font-semibold">
          {entry.title.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            <span className="truncate">{entry.title}</span>
            <TierBadge entry={entry} />
          </p>
          <p className="truncate text-muted-foreground" title={entry.description}>
            {entry.description}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <Badge variant="outline" className="gap-1">
          {local ? <MonitorIcon className="size-3" /> : <GlobeIcon className="size-3" />}
          {entry.available ? (local ? "On this computer" : "Online") : "Not supported yet"}
        </Badge>
        <Badge variant="outline">{signInLabel(entry)}</Badge>
        {entry.trust.map((t) => (
          <Badge
            key={t}
            variant="outline"
            className={cn(t === "can-send" || t === "private-data" ? "border-amber-500/40 text-amber-700 dark:text-amber-400" : "")}
          >
            {trustTitle(t)}
          </Badge>
        ))}
      </div>
      <div className="mt-auto flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {!entry.available ? entry.reason : entry.addedAs ? `Added as ${entry.addedAs}` : ""}
        </span>
        {entry.addedAs ? (
          <Badge variant="secondary" className="gap-1 bg-brand/15 text-brand">
            <CheckIcon className="size-3" />
            Added
          </Badge>
        ) : (
          <Button size="sm" onClick={onAdd} disabled={!entry.available}>
            <PlusIcon />
            Add
          </Button>
        )}
      </div>
    </div>
  );
}
