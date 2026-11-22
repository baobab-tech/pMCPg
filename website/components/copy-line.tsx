"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function CopyLine({ text, className }: { text: string; className?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border bg-card py-1.5 pr-1.5 pl-4", className)}>
      <code className="min-w-0 flex-1 overflow-x-auto py-1 font-mono text-[13px] whitespace-nowrap">{text}</code>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label="Copy command"
      >
        {done ? <CheckIcon className="size-4 text-ok" /> : <CopyIcon className="size-4" />}
      </button>
    </div>
  );
}
