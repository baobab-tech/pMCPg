import { ArrowRightIcon, LibraryIcon } from "lucide-react";
import Link from "next/link";

/** Entry point to the catalog page from the Servers page and its add dialog. */
export function CatalogLink({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link
      href="/servers/catalog/"
      onClick={onNavigate}
      className="flex items-start gap-3 rounded-xl border p-3 text-sm transition-colors outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <LibraryIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
      <span className="grid flex-1 gap-1">
        <span className="font-medium">Browse the catalog</span>
        <span className="text-muted-foreground">Servers reviewed by the pMCPg team, with what each one needs to sign in.</span>
      </span>
      <ArrowRightIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
    </Link>
  );
}
