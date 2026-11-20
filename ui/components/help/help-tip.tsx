"use client";

import { Popover } from "@base-ui/react/popover";
import { InfoIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LearnMore } from "./learn-more";

/** Small (i) button that opens a short explanation, with a link to a help article. */
export function HelpTip({
  title,
  children,
  slug,
  label = "More about this",
  className,
}: {
  title: string;
  children: ReactNode;
  /** Help article for "Learn more". */
  slug?: string;
  label?: string;
  className?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className={cn(
          "inline-flex size-5 shrink-0 items-center justify-center rounded-full align-middle text-muted-foreground outline-none hover:text-brand focus-visible:ring-3 focus-visible:ring-ring/50",
          className,
        )}
      >
        <InfoIcon className="size-4" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="start" sideOffset={6} className="isolate z-50">
          <Popover.Popup className="grid w-80 max-w-[calc(100vw-2rem)] origin-(--transform-origin) gap-2 rounded-lg border bg-popover p-3 text-sm text-popover-foreground shadow-md outline-none data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">
            <Popover.Title className="font-medium">{title}</Popover.Title>
            <div className="grid gap-2 text-muted-foreground">{children}</div>
            {slug && <LearnMore slug={slug} className="w-fit" />}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Server → accounts → profiles in one small table, for HelpTips on the Servers and Accounts pages. */
export function ServerAccountTable() {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-muted-foreground">
          <th className="pb-1 font-medium">Server</th>
          <th className="pb-1 font-medium">Accounts</th>
          <th className="pb-1 font-medium">In profile</th>
        </tr>
      </thead>
      <tbody className="text-foreground">
        <tr className="border-t">
          <td className="py-1 align-top">Gmail</td>
          <td className="py-1 font-mono">gmail-work</td>
          <td className="py-1">Work</td>
        </tr>
        <tr>
          <td />
          <td className="py-1 font-mono">gmail-personal</td>
          <td className="py-1">Personal</td>
        </tr>
      </tbody>
    </table>
  );
}
