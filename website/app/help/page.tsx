import { ChevronRightIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { HELP_GROUPS, helpHref, loadHelp } from "@/lib/help";

export const metadata: Metadata = {
  title: "Guides",
  description: "Short answers in plain words: install, connect your AI app, move your connectors, privacy and keys.",
};

export default function HelpIndex() {
  const all = loadHelp();
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
      <div className="mt-10 grid gap-8 md:grid-cols-2">
        {HELP_GROUPS.map((g) => {
          const items = all.filter((a) => a.group === g.id);
          if (!items.length) return null;
          return (
            <section key={g.id}>
              <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.title}</h2>
              <ul className="grid gap-1">
                {items.map((a) => (
                  <li key={a.slug}>
                    <Link
                      href={helpHref(a.slug)}
                      className="group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{a.title}</span>
                        <span className="mt-0.5 block text-sm text-muted-foreground">{a.summary}</span>
                      </span>
                      <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </main>
  );
}
