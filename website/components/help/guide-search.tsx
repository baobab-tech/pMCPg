"use client";

// In-browser search over the help articles. The index is built at build time (app/help/page.tsx) and shipped
// in the page; nothing is fetched. Every query word must match somewhere; title and summary hits rank above body hits.
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { GuideCard } from "@/components/help/guide-card";

export interface GuideEntry {
  href: string;
  title: string;
  summary: string;
  group: string;
  words: string;
}

// Lowercase, punctuation to spaces, padded so " word" finds a word start.
const norm = (s: string) => ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} `;

function score(fields: { title: string; summary: string; group: string; words: string }, tokens: string[]) {
  let total = 0;
  for (const t of tokens) {
    const start = ` ${t}`;
    let s = 0;
    if (fields.title.includes(start)) s = 12;
    else if (fields.title.includes(t)) s = 8;
    if (fields.summary.includes(start)) s += 5;
    else if (fields.summary.includes(t)) s += 3;
    if (fields.group.includes(start)) s += 2;
    if (!s) {
      if (fields.words.includes(start)) s = 1;
      else if (fields.words.includes(t)) s = 0.5;
    }
    if (!s) return 0;
    total += s;
  }
  return total;
}

export function GuideSearch({ entries, children }: { entries: GuideEntry[]; children: ReactNode }) {
  const [query, setQuery] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const index = useMemo(
    () =>
      entries.map((e) => ({
        entry: e,
        title: norm(e.title),
        summary: norm(e.summary),
        group: norm(e.group),
        words: norm(e.words),
      })),
    [entries],
  );

  const tokens = norm(query).trim().split(" ").filter(Boolean);
  const results = tokens.length
    ? index
        .map((f, i) => ({ entry: f.entry, i, s: score(f, tokens) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s || a.i - b.i)
        .map((r) => r.entry)
    : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else e.currentTarget.blur();
    } else if (e.key === "Enter" && results[0]) {
      e.preventDefault();
      router.push(results[0].href);
    }
  };

  return (
    <>
      <div className="relative mt-6 max-w-2xl">
        <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          ref={input}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search guides"
          aria-label="Search guides"
          aria-controls="guide-results"
          autoComplete="off"
          spellCheck={false}
          className="h-11 w-full rounded-lg border bg-background pr-10 pl-9 text-base outline-none placeholder:text-muted-foreground focus-visible:border-brand focus-visible:ring-2 focus-visible:ring-brand/30 sm:text-sm"
        />
        {!query && (
          <kbd className="pointer-events-none absolute top-1/2 right-3 hidden -translate-y-1/2 rounded border px-1.5 font-mono text-xs text-muted-foreground sm:block">
            /
          </kbd>
        )}
      </div>
      <div id="guide-results" className="mt-10">
        {!tokens.length ? (
          children
        ) : (
          <section>
            <h2 aria-live="polite" className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {results.length === 1 ? "1 guide" : `${results.length} guides`}
            </h2>
            {results.length ? (
              <ul className="grid max-w-2xl gap-1">
                {results.map((r, i) => (
                  <li key={r.href}>
                    <GuideCard href={r.href} title={r.title} summary={r.summary} label={r.group} active={i === 0} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-3 text-sm text-muted-foreground">
                No guide matches “{query.trim()}”.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    input.current?.focus();
                  }}
                  className="text-brand underline underline-offset-3"
                >
                  Show all guides
                </button>
              </p>
            )}
          </section>
        )}
      </div>
    </>
  );
}
