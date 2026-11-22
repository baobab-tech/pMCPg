import { ChevronRightIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function GuideCard({
  href,
  title,
  summary,
  label,
  active,
}: {
  href: string;
  title: string;
  summary: string;
  label?: string;
  active?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group flex items-start gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60",
        active && "bg-muted/60",
      )}
    >
      <span className="min-w-0 flex-1">
        {label && <span className="mb-0.5 block text-xs text-muted-foreground">{label}</span>}
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-sm text-muted-foreground">{summary}</span>
      </span>
      <ChevronRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
