"use client";

// Adapted from Watermelon UI "Onboarding Checklist" (registry.watermelon.sh/r/onboarding-checklist.json):
// a collapsible progress card. Steps link to pages; colors come from the theme.
import { Check, ChevronRight, ChevronUp } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/utils";

export interface ChecklistStep {
  id: string;
  title: string;
  href: string;
  done: boolean;
}

const spring = { type: "spring", stiffness: 300, damping: 30 } as const;

export function OnboardingChecklist({
  steps,
  title = "Getting started",
  defaultExpanded = true,
}: {
  steps: ChecklistStep[];
  title?: string;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const done = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)?.id;
  const BARS = 14;

  return (
    <motion.div layout transition={spring} className="w-full overflow-hidden rounded-xl border bg-muted/40 shadow-sm">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-3 p-3 text-left outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <motion.span animate={{ rotate: expanded ? 0 : 180 }} className="text-muted-foreground">
            <ChevronUp className="size-5" />
          </motion.span>
          <span className="truncate font-semibold">{title}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <span className="flex gap-[3px]" aria-hidden>
            {Array.from({ length: BARS }).map((_, i) => (
              <span
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed bars
                key={i}
                className={cn(
                  "h-4 w-[3px] rounded-full transition-colors duration-500",
                  i < (done / steps.length) * BARS ? "bg-brand" : "bg-border",
                )}
              />
            ))}
          </span>
          <span className="min-w-8 text-right text-xs font-semibold text-muted-foreground tabular-nums">
            {done}/{steps.length}
          </span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={spring}
            className="rounded-t-2xl border-t bg-card"
          >
            <ul className="space-y-0.5 p-1.5">
              {steps.map((step, i) => (
                <li key={step.id}>
                  <Link
                    href={step.href}
                    className="group flex items-center justify-between rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/60"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      {step.done ? (
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-background shadow-sm">
                          <Check className="size-3" strokeWidth={4} />
                        </span>
                      ) : (
                        <span
                          className={cn(
                            "flex size-5 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold",
                            step.id === next
                              ? "border-foreground bg-foreground text-background"
                              : "border-border text-muted-foreground",
                          )}
                        >
                          {i + 1}
                        </span>
                      )}
                      <span
                        className={cn(
                          "truncate text-sm font-medium",
                          step.done ? "text-muted-foreground line-through decoration-muted-foreground/40" : "",
                        )}
                      >
                        {step.title}
                      </span>
                    </span>
                    {!step.done && <ChevronRight className="size-4 shrink-0 text-muted-foreground" />}
                  </Link>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
