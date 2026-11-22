import { ArrowLeftIcon, MonitorIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HelpDiagram } from "@/components/help/diagrams";
import { HELP_GROUPS, helpHref, loadHelp } from "@/lib/help";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadHelp().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = loadHelp().find((x) => x.slug === slug);
  return a ? { title: a.title, description: a.summary } : {};
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const all = loadHelp();
  const article = all.find((a) => a.slug === slug);
  if (!article) notFound();
  const group = HELP_GROUPS.find((g) => g.id === article.group)?.title;
  const related = all.filter((a) => a.group === article.group && a.slug !== slug);
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <Link href="/help/" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Guides
        {group && <span className="text-muted-foreground/70">· {group}</span>}
      </Link>
      <h1 className="text-[clamp(1.7rem,4vw,2.3rem)] leading-tight font-bold tracking-tight">{article.title}</h1>
      <p className="mt-2 text-lg text-muted-foreground">{article.summary}</p>

      <div className="mt-8 grid gap-5">
        {article.blocks.map((b, i) => {
          const key = `${b.kind}-${i}`;
          if (b.kind === "html")
            // biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown, rendered at build time
            return <div key={key} className="prose-help" dangerouslySetInnerHTML={{ __html: b.html }} />;
          if (b.kind === "diagram") return <HelpDiagram key={key} name={b.name} />;
          return (
            <div key={key} className="flex gap-3 rounded-xl border border-brand/40 bg-brand-soft p-4 text-sm">
              <MonitorIcon className="mt-0.5 size-4 shrink-0 text-brand" />
              <p className="text-muted-foreground">
                In pMCPg, this page checks your own setup as you read. Open it from the web UI: <b className="text-foreground">Help</b> → <b className="text-foreground">{article.title}</b>.
              </p>
            </div>
          );
        })}
      </div>

      {related.length > 0 && (
        <nav className="mt-12 border-t pt-5" aria-label="Related">
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Also in {group}</h2>
          <ul className="grid gap-1.5 text-sm">
            {related.map((r) => (
              <li key={r.slug}>
                <Link href={helpHref(r.slug)} className="text-brand underline-offset-3 hover:underline">
                  {r.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </main>
  );
}
