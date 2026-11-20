"use client";

// Adapted from Watermelon UI "Continuous Tabs" (registry.watermelon.sh/r/continuous-tabs.json):
// a pill that slides between tabs. Controlled, themed, sized for forms.
import { LayoutGroup, motion } from "motion/react";
import { useId } from "react";
import { cn } from "@/lib/utils";

export interface TabItem<T extends string> {
  id: T;
  label: string;
}

export function ContinuousTabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
  "aria-label": ariaLabel,
}: {
  tabs: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  className?: string;
  "aria-label"?: string;
}) {
  const layoutId = useId();
  return (
    <LayoutGroup id={layoutId}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          "relative inline-flex w-fit max-w-full flex-wrap items-center gap-0.5 rounded-full border bg-linear-to-b from-background to-muted p-1",
          "shadow-[inset_0_-2px_4px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.6)] dark:shadow-[inset_0_-2px_4px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.05)]",
          className,
        )}
      >
        {tabs.map((tab) => {
          const active = value === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(tab.id)}
              className="relative rounded-full px-3.5 py-1.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {active && (
                <motion.span
                  layoutId="active-pill"
                  transition={{ type: "spring", stiffness: 380, damping: 30, mass: 0.9 }}
                  className="absolute inset-0 rounded-full bg-foreground shadow-xs"
                />
              )}
              <motion.span
                layout="position"
                className={cn(
                  "relative z-10 text-sm font-medium transition-colors duration-200",
                  active ? "text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </motion.span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
