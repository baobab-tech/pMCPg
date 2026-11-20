"use client";

import { Popover } from "@base-ui/react/popover";
import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small (i) button: opens on hover, click or keyboard focus + Enter. */
export function InfoTip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        aria-label={label}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <InfoIcon className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" sideOffset={6} className="isolate z-50">
          <Popover.Popup className="max-w-xs rounded-lg border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0">
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** What the pMCPg password is, for every place that asks for it. */
export function PasswordHelp() {
  return (
    <InfoTip label="About the pMCPg password">
      <p>It protects this page, so only you can change pMCPg's settings.</p>
      <p className="mt-1.5">It is not a password for an AI app or for any of your accounts.</p>
      <p className="mt-1.5">
        Forgot it? On the computer running pMCPg, run <code className="font-mono">pmcpg ui reset-password</code>.
      </p>
    </InfoTip>
  );
}

export const PASSWORD_LABEL = "Your pMCPg password";
export const PASSWORD_HINT = "The one you set when you started pMCPg.";
