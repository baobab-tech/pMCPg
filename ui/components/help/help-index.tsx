"use client";

import { ActivityIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/common";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { HELP_GROUPS, type HelpSummary, helpHref, searchHelp } from "@/lib/help-groups";

function Row({ a }: { a: HelpSummary }) {
  return (
    <li>
      <Link
        href={helpHref(a.slug)}
        className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {a.title}
            {a.live && (
              <Badge variant="secondary" className="gap-1 bg-brand/10 text-brand">
                <ActivityIcon className="size-3" />
                Uses your setup
              </Badge>
            )}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{a.summary}</span>
        </span>
        <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

export function HelpIndex({ articles }: { articles: HelpSummary[] }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchHelp(articles, query), [articles, query]);
  const searching = query.trim() !== "";

  return (
    <>
      <PageHeader title="Help" description="Short answers in plain words. Pages marked “Uses your setup” check this gateway as you read." />
      <div className="relative mb-6 max-w-xl">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help, e.g. “sign-in” or “Claude Desktop”"
          aria-label="Search help"
          className="pl-8"
          autoFocus
        />
      </div>

      {searching ? (
        results.length ? (
          <Card>
            <CardContent>
              <ul className="-mx-3 grid gap-0.5">
                {results.map((a) => (
                  <Row key={a.slug} a={a} />
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">No article matches “{query.trim()}”. Try a shorter word.</p>
        )
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {HELP_GROUPS.map((g) => {
            const items = articles.filter((a) => a.group === g.id);
            if (!items.length) return null;
            return (
              <Card key={g.id} size="sm">
                <CardContent>
                  <h2 className="mb-1 px-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    {g.title}
                  </h2>
                  <ul className="-mx-3 grid gap-0.5">
                    {items.map((a) => (
                      <Row key={a.slug} a={a} />
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
