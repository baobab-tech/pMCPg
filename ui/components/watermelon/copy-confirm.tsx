"use client";

// Adapted from Watermelon UI "Copy Confirm" (registry.watermelon.sh/r/copy-confirm.json):
// a copy button whose icon and label morph to a confirmation. Theme tokens instead of fixed colors.
import { CheckIcon, CopyIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function CopyConfirm({
  value,
  copyText = "Copy",
  copiedText = "Copied",
  className,
}: {
  value: string;
  copyText?: string;
  copiedText?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Could not copy. Select the text and copy it by hand.");
    }
  }

  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={handleCopy}
      aria-label={copied ? copiedText : copyText}
      className={cn(
        "relative inline-flex h-7 shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-full border px-3 text-[0.8rem] font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        copied
          ? "border-brand bg-brand text-background"
          : "border-border bg-background text-foreground hover:bg-muted dark:bg-input/30",
        className,
      )}
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={copied ? "check" : "copy"}
          initial={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{ opacity: 0, scale: 0.25, filter: "blur(4px)" }}
          transition={{ type: "spring", duration: 0.3, bounce: 0 }}
        >
          {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
        </motion.span>
      </AnimatePresence>
      <AnimatedText from={copyText} to={copiedText} active={copied} />
    </motion.button>
  );
}

/** Letters swap one by one between two words. */
export function AnimatedText({ from, to, active }: { from: string; to: string; active: boolean }) {
  const text = active ? to : from;
  return (
    <span className="flex will-change-transform">
      <AnimatePresence mode="popLayout" initial={false}>
        {text.split("").map((char, index) => (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity
            key={char + index}
            layout
            initial={{ opacity: 0, y: 5, scale: 0.7 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
              transition: { type: "spring", stiffness: 200, damping: 20, delay: 0.03 * index },
            }}
            exit={{ opacity: 0, y: -5, scale: 0.7 }}
          >
            {char === " " ? " " : char}
          </motion.span>
        ))}
      </AnimatePresence>
    </span>
  );
}
