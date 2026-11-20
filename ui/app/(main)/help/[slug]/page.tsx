import { notFound } from "next/navigation";
import { HelpArticleView } from "@/components/help/help-article";
import { loadHelp } from "@/lib/help";

export const dynamicParams = false;

export function generateStaticParams() {
  return loadHelp().map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const a = loadHelp().find((x) => x.slug === slug);
  return { title: a ? `${a.title} · Help` : "Help" };
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const all = loadHelp();
  const article = all.find((a) => a.slug === slug);
  if (!article) notFound();
  const related = all
    .filter((a) => a.group === article.group && a.slug !== slug)
    .map(({ blocks: _, ...s }) => s);
  return <HelpArticleView article={article} related={related} />;
}
