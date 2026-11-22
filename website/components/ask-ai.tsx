"use client";

import { CheckIcon, CopyIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";

const PROMPT = "Explain how this works in simple terms https://pmcpg.io/llms.txt";

// Thin bar above "How it works": points readers' AI chat at /llms.txt.
export function AskAi() {
  const [done, setDone] = useState(false);
  return (
    <div className="mx-auto mb-10 flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-2xl border bg-card/70 py-1.5 pr-1.5 pl-3.5 text-xs text-muted-foreground sm:text-sm">
      <SparklesIcon className="hidden size-3.5 shrink-0 text-brand sm:block" />
      <span>Need AI to explain this better? Paste this into your chat:</span>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(PROMPT);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[11px] text-foreground sm:text-xs hover:bg-muted"
        aria-label="Copy prompt"
      >
        <span className="truncate">{PROMPT}</span>
        {done ? <CheckIcon className="size-3.5 shrink-0 text-ok" /> : <CopyIcon className="size-3.5 shrink-0" />}
      </button>
    </div>
  );
}
