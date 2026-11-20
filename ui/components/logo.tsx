import { cn } from "@/lib/utils";

/** The mark: three paths (your AI apps) meet at a shield (pMCPg) and leave as one, metro-map style. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <g fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 32h48M8 16h6l9 12M8 48h6l9-12" />
      </g>
      <g fill="currentColor">
        <circle cx="7" cy="16" r="4.5" />
        <circle cx="7" cy="32" r="4.5" />
        <circle cx="7" cy="48" r="4.5" />
        <circle cx="57" cy="32" r="4.5" />
      </g>
      <path
        d="M34 18l11 4v8.5c0 8-4.5 12.5-11 15.5c-6.5-3-11-7.5-11-15.5V22z"
        strokeWidth="3"
        strokeLinejoin="round"
        className="fill-brand stroke-background"
      />
    </svg>
  );
}

/** Mark and name. `full` spells out "Private MCP Gateway" with pMCPg underneath. */
export function Logo({ full = false, className }: { full?: boolean; className?: string }) {
  if (full)
    return (
      <span className={cn("flex items-center gap-3", className)}>
        <LogoMark className="size-12" />
        <span className="flex flex-col text-left leading-tight">
          <span className="font-heading text-xl font-semibold tracking-tight">Private MCP Gateway</span>
          <span className="text-xs text-muted-foreground">pMCPg</span>
        </span>
      </span>
    );
  return (
    <span className={cn("flex items-center gap-2 font-heading font-semibold tracking-tight", className)}>
      <LogoMark className="size-8" />
      pMCPg
    </span>
  );
}
