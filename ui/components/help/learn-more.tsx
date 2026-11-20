import { CircleHelpIcon } from "lucide-react";
import Link from "next/link";
import { helpHref } from "@/lib/help-groups";
import { cn } from "@/lib/utils";

/** Small "Learn more" link to a help article, for empty states, error cards and page headers. */
export function LearnMore({
  slug,
  query,
  children = "Learn more",
  className,
}: {
  slug: string;
  query?: Record<string, string>;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={helpHref(slug, query)}
      className={cn("inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline", className)}
    >
      <CircleHelpIcon className="size-3.5" />
      {children}
    </Link>
  );
}
