"use client";

// Adapted from Watermelon UI "Run Action Button" (registry.watermelon.sh/r/run-action-button.json):
// a button that morphs idle → running → done/failed. Driven by a real async action instead of a timer.
import { CheckCircle2Icon, Loader2Icon, PlayIcon, XCircleIcon } from "lucide-react";
import { AnimatePresence, motion, type Transition } from "motion/react";
import { useState } from "react";
import { cn } from "@/lib/utils";

const spring: Transition = { type: "spring", stiffness: 260, damping: 22, mass: 0.8 };
const enter = { opacity: 0, scale: 0.8, filter: "blur(4px)" };
const shown = { opacity: 1, scale: 1, filter: "blur(0px)" };

type Status = "idle" | "running" | "done" | "failed";

/** Letters rise in one by one. */
function RisingText({ text }: { text: string }) {
  return (
    <span className="inline-flex">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={text} className="inline-flex">
          {text.split("").map((char, i) => (
            <motion.span
              // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
              key={i}
              initial={{ y: 8, opacity: 0, scale: 0.5, filter: "blur(2px)" }}
              animate={{ y: 0, opacity: 1, scale: 1, filter: "blur(0px)" }}
              exit={{ y: -8, opacity: 0, scale: 0.5, filter: "blur(2px)" }}
              transition={{ type: "spring", stiffness: 240, damping: 16, mass: 1.2, delay: i * 0.014 }}
              className="inline-block whitespace-pre"
            >
              {char}
            </motion.span>
          ))}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * Runs `action`; shows its result label for a few seconds, then returns to idle.
 * `action` resolves to the label to show ("2 tools found"); throwing shows the failed state.
 */
export function RunActionButton({
  label = "Test",
  runningLabel = "Testing…",
  action,
  className,
}: {
  label?: string;
  runningLabel?: string;
  action: () => Promise<{ ok: boolean; label: string }>;
  className?: string;
}) {
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState("");

  async function run() {
    if (status === "running") return;
    setStatus("running");
    try {
      const r = await action();
      setResult(r.label);
      setStatus(r.ok ? "done" : "failed");
    } catch (e) {
      setResult(e instanceof Error ? e.message : "Failed");
      setStatus("failed");
    }
    setTimeout(() => setStatus("idle"), 3500);
  }

  const text = status === "idle" ? label : status === "running" ? runningLabel : result;
  const Icon =
    status === "idle" ? PlayIcon : status === "running" ? Loader2Icon : status === "done" ? CheckCircle2Icon : XCircleIcon;

  return (
    <motion.button
      type="button"
      layout
      transition={spring}
      onClick={run}
      disabled={status === "running"}
      aria-live="polite"
      aria-label={text}
      className={cn(
        "inline-flex h-7 max-w-64 items-center gap-1.5 overflow-hidden rounded-full border px-3 text-[0.8rem] font-medium whitespace-nowrap outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        status === "running" && "border-dashed text-muted-foreground",
        status === "done" && "border-brand/40 bg-brand/10 text-brand",
        status === "failed" && "border-destructive/40 bg-destructive/10 text-destructive",
        status === "idle" && "bg-background hover:bg-muted dark:bg-input/30",
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span key={status} initial={enter} animate={shown} exit={enter} transition={spring}>
          <Icon className={cn("size-3.5", status === "running" && "animate-spin")} />
        </motion.span>
      </AnimatePresence>
      <span className="truncate">
        <RisingText text={text} />
      </span>
    </motion.button>
  );
}
