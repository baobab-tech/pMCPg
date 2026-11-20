import { LibraryIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/** Disabled entry point for the public catalog, which is not built yet (docs/catalog.md). */
export function CatalogSoon() {
  return (
    <div aria-disabled="true" className="flex items-start gap-3 rounded-xl border border-dashed p-3 text-sm text-muted-foreground">
      <LibraryIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="grid gap-1">
        <p className="flex flex-wrap items-center gap-2 font-medium">
          Browse the catalog <Badge variant="secondary">Coming soon</Badge>
        </p>
        <p>A searchable catalog of MCP servers is coming soon. For now, add a server by its URL or import it from your AI apps.</p>
      </div>
    </div>
  );
}
