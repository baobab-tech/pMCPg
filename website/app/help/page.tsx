import type { Metadata } from "next";
import Link from "next/link";
import { GuideCard } from "@/components/help/guide-card";
import { GuideSearch } from "@/components/help/guide-search";
import { HELP_GROUPS, helpHref, loadHelp } from "@/lib/help";

export const metadata: Metadata = {
  title: "Guides",
  description: "Short answers in plain words: install, connect your AI app, move your connectors, privacy and keys.",
};

export default function HelpIndex() {
  const all = loadHelp();
  const groupTitle = (id: string) => HELP_GROUPS.find((g) => g.id === id)?.title ?? "";
  const entries = all.map((a) => ({
    href: helpHref(a.slug),
    title: a.title,
    summary: a.summary,
    group: groupTitle(a.group),
    words: a.words,
  }));
  return (
    <main className="mx-auto max-w-4xl px-4 py-14">
      <h1 className="text-[clamp(1.8rem,4vw,2.6rem)] font-bold tracking-tight">Guides</h1>
      <p className="mt-2 max-w-2xl text-muted-foreground">
        The same help pages as the pMCPg web UI. Start with{" "}
        <Link className="text-brand underline underline-offset-3" href={helpHref("move-claude-connectors")}>
          Move your Claude connectors
        </Link>{" "}
        if you already use Claude.
      </p>
      <GuideSearch entries={entries}>
        <div className="grid gap-8 md:grid-cols-2">
          {HELP_GROUPS.map((g) => {
            const items = all.filter((a) => a.group === g.id);
            if (!items.length) return null;
            return (
              <section key={g.id}>
                <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h2>
                <ul className="grid gap-1">
                  {items.map((a) => (
                    <li key={a.slug}>
                      <GuideCard href={helpHref(a.slug)} title={a.title} summary={a.summary} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </GuideSearch>
    </main>
  );
}
