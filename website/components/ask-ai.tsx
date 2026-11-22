"use client";

import { CheckIcon, CopyIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";

const LLMS = "https://pmcpg.io/llms.txt";

// Thin bar above "How it works": points readers' AI chat at /llms.txt.
export function AskAi() {
  const [done, setDone] = useState(false);
  return (
    <div className="mx-auto mb-10 flex w-fit max-w-full flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border bg-card/70 py-1 pr-1 pl-3.5 text-xs text-muted-foreground sm:text-sm">
      <SparklesIcon className="size-3.5 shrink-0 text-brand" />
      <span>Need AI to explain this better? Point your chat to</span>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(LLMS);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-mono text-foreground hover:bg-muted"
        aria-label={`Copy ${LLMS}`}
      >
        {LLMS.replace("https://", "")}
        {done ? <CheckIcon className="size-3.5 text-ok" /> : <CopyIcon className="size-3.5" />}
      </button>
    </div>
  );
}
