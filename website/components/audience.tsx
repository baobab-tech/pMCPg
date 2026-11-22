"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { createContext, type ReactNode, useContext, useState } from "react";
import { cn } from "@/lib/utils";

export type AudienceId = "new" | "connectors" | "teams";

interface Audience {
  id: AudienceId;
  label: string;
  headline: string;
  /** Plain text; {hl}…{/hl} marks the highlighted phrase. */
  body: string;
  cta: { label: string; href: string };
  steps: { title: string; body: string }[];
}

export const AUDIENCES: Audience[] = [
  {
    id: "new",
    label: "New to connectors",
    headline: "Let your AI app use your tools, safely.",
    body: "Connectors (MCPs) let Claude and other AI apps search information, read files or query data. pMCPg {hl}runs on your computer{/hl}, holds the sign-ins, and masks personal data in what your connectors send back to the AI.",
    cta: { label: "How it works", href: "#how" },
    steps: [
      { title: "Install pMCPg", body: "One line in a terminal. It starts at login and opens its web UI." },
      { title: "Add a connector", body: "Paste its URL. If it needs a sign-in, you sign in once in your browser." },
      { title: "Connect your AI app", body: "One click for Claude Desktop, Claude Code, VS Code or LM Studio." },
      { title: "Ask your AI", body: "It searches pMCPg for the right tool and calls it. Every call shows in the activity log." },
    ],
  },
  {
    id: "connectors",
    label: "I use connectors",
    headline: "Set up each connector once. Use it in every AI app.",
    body: "Import the connectors you already added to Claude Desktop, Claude Code, VS Code or LM Studio, and move over the ones Claude keeps in its cloud. Each app then connects once, to pMCPg. Keys live in your keychain, not in config files.",
    cta: { label: "Move your connectors", href: "/help/move-claude-connectors/" },
    steps: [
      { title: "Install pMCPg", body: "One line in a terminal, or npm, Homebrew or Docker." },
      { title: "Import from your desktop apps", body: "pMCPg reads their settings files and lists what it finds. You pick." },
      { title: "Move your Claude connectors", body: "Claude keeps them in its cloud. Let Claude list them, or copy each URL." },
      { title: "One entry per app", body: "Swap each app's list for one pMCPg entry. pMCPg backs up the file first." },
    ],
  },
  {
    id: "teams",
    label: "IT teams",
    headline: "Decide which connectors your team's AI can use, and what it can do with them.",
    body: "Profiles, approval rules, personal data masking and an encrypted activity log, on each machine or in Docker. No cloud service, no account. Org-wide management is coming.",
    cta: { label: "For teams", href: "#teams" },
    steps: [
      { title: "Run it where you want", body: "On each machine, or in Docker with a master key file and a UI password." },
      { title: "One profile per purpose", body: "Each profile has its own URL and token. An agent sees only its profile's tools." },
      { title: "Pick rules and privacy", body: "Presets: open, balanced or careful. Privacy level per profile: off, standard or strict." },
      { title: "Review", body: "Answer approvals in the web UI. Browse the activity log or export it as JSON lines." },
    ],
  },
];

const Ctx = createContext<{ audience: Audience; setId: (id: AudienceId) => void } | null>(null);

export function AudienceProvider({ children }: { children: ReactNode }) {
  const [id, setId] = useState<AudienceId>("new");
  const audience = AUDIENCES.find((a) => a.id === id) ?? AUDIENCES[0];
  return <Ctx.Provider value={{ audience, setId }}>{children}</Ctx.Provider>;
}

export function useAudience() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useAudience outside AudienceProvider");
  return c;
}

export function AudienceToggle() {
  const { audience, setId } = useAudience();
  return (
    <div role="tablist" aria-label="Who are you?" className="inline-flex max-w-full rounded-full border bg-card p-1">
      {AUDIENCES.map((a) => {
        const on = a.id === audience.id;
        return (
          <button
            key={a.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => setId(a.id)}
            className={cn(
              "relative rounded-full px-2.5 py-1.5 text-[12.5px] whitespace-nowrap transition-colors sm:px-4 sm:text-sm",
              on ? "font-semibold text-primary-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {on && (
              <motion.span
                layoutId="audience-pill"
                className="absolute inset-0 rounded-full bg-brand"
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <span className="relative">{a.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function Body({ text }: { text: string }) {
  const parts = text.split(/\{hl\}|\{\/hl\}/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: static split of one string
          <mark key={i} className="hl">
            {p}
          </mark>
        ) : (
          p
        ),
      )}
    </>
  );
}

export function AudienceCopy() {
  const { audience } = useAudience();
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={audience.id}
        initial={reduce ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -6 }}
        transition={{ duration: 0.22 }}
      >
        <h1 className="text-[clamp(2.2rem,5.2vw,3.6rem)] leading-[1.04] font-bold tracking-tight text-balance">
          {audience.headline}
        </h1>
        <p className="mt-5 max-w-xl text-lg text-muted-foreground">
          <Body text={audience.body} />
        </p>
      </motion.div>
    </AnimatePresence>
  );
}
