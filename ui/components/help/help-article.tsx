import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { HELP_GROUPS, type HelpSummary, helpHref } from "@/lib/help-groups";
import type { HelpArticle } from "@/lib/help";
import { HelpDiagram } from "./diagrams";
import { HelpProse } from "./help-prose";
import { LiveBlock } from "./live";
import "./help.css";

export function HelpArticleView({ article, related }: { article: HelpArticle; related: HelpSummary[] }) {
  const group = HELP_GROUPS.find((g) => g.id === article.group)?.title;
  return (
    <article className="mx-auto max-w-3xl">
      <Link href="/help/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Help
        {group && <span className="text-muted-foreground/70">· {group}</span>}
      </Link>
      <h1 className="font-heading text-2xl font-semibold tracking-tight">{article.title}</h1>
      <p className="mt-1 text-muted-foreground">{article.summary}</p>

      <div className="mt-6 grid gap-5">
        {article.blocks.map((b, i) => {
          const key = `${b.kind}-${i}`;
          if (b.kind === "html") return <HelpProse key={key} html={b.html} />;
          if (b.kind === "diagram") return <HelpDiagram key={key} name={b.name} />;
          return (
            <Suspense key={key}>
              <LiveBlock name={b.name} arg={b.arg} />
            </Suspense>
          );
        })}
      </div>

      {related.length > 0 && (
        <nav className="mt-10 border-t pt-5" aria-label="Related">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Also in {group}</h2>
          <ul className="grid gap-1.5 text-sm">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={helpHref(r.slug)} className="text-brand hover:underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </article>
  );
}
