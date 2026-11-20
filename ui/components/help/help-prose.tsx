"use client";

import { useRouter } from "next/navigation";
import type { MouseEvent } from "react";

/** Article HTML from the build. In-app links navigate without a full page load. */
export function HelpProse({ html }: { html: string }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    const href = a.getAttribute("href");
    if (!href?.startsWith("/")) return;
    e.preventDefault();
    router.push(href);
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: delegates clicks on links, which stay keyboard-accessible
    // biome-ignore lint/security/noDangerouslySetInnerHtml: our own Markdown, rendered at build time
    <div className="help-prose" onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
  );
}
