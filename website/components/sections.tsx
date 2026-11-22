"use client";

import { ArrowLeftRightIcon, ArrowRightIcon, CheckIcon, ShieldCheckIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAudience } from "@/components/audience";
import { CopyLine } from "@/components/copy-line";
import { Download } from "@/components/download";
import SpotlightCard from "@/components/SpotlightCard";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FORK, INSTALL, ISSUES, LICENSE, PRIVACY, ROADMAP, SECURITY, VERIFY } from "@/lib/site";
import type { Release } from "@/lib/release";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

export function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
  className,
}: {
  id?: string;
  eyebrow?: string;
  title: string;
  lead?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <section id={id} className={cn("border-t py-20 sm:py-24", className)}>
      <motion.div
        className="mx-auto max-w-6xl px-4"
        initial={reduce ? false : { opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-80px" }}
        transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }}
      >
        {eyebrow && <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-brand uppercase">{eyebrow}</p>}
        <h2 className="text-[clamp(1.6rem,3.4vw,2.4rem)] leading-tight font-bold tracking-tight">{title}</h2>
        {lead && <p className="mt-3 max-w-2xl text-muted-foreground">{lead}</p>}
        <div className="mt-10">{children}</div>
      </motion.div>
    </section>
  );
}

export function HowItWorks() {
  const { audience } = useAudience();
  const reduce = useReducedMotion();
  // The highlight walks through the steps in order, on a loop.
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const t = setInterval(() => setActive((n) => (n + 1) % audience.steps.length), 1800);
    return () => clearInterval(t);
  }, [reduce, audience.steps.length]);
  return (
    <Section id="how" eyebrow={audience.label} title="How it works">
      <ol className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {audience.steps.map((s, i) => (
          <motion.li
            key={`${audience.id}-${s.title}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
            className={cn(
              "rounded-2xl border bg-card p-5 transition-[border-color,box-shadow] duration-500",
              !reduce && i === active && "border-brand shadow-[0_0_0_1px_var(--brand),0_0_32px_-8px_var(--brand)]",
            )}
          >
            <span className="text-xs font-semibold tracking-wide text-brand uppercase">Step {i + 1}</span>
            <h3 className="mt-2 font-semibold">{s.title}</h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{s.body}</p>
          </motion.li>
        ))}
      </ol>
      <Link
        href="/help/move-claude-connectors/"
        className="group mt-5 grid items-center gap-4 rounded-2xl border border-brand/40 bg-[linear-gradient(100deg,var(--brand-soft),transparent_70%)] px-5 py-4 transition-colors hover:border-brand sm:grid-cols-[44px_1fr_auto]"
      >
        <span className="hidden size-11 place-items-center rounded-xl bg-brand text-primary-foreground sm:grid">
          <ArrowLeftRightIcon className="size-5" />
        </span>
        <span className="text-sm text-muted-foreground">
          <b className="block text-base text-foreground">Move over your Claude connectors</b>
          Claude keeps the connectors you add in Anthropic's cloud, so no app can import them. Bring them over once:
          about a minute each.
        </span>
        <span className="flex items-center gap-1 font-semibold whitespace-nowrap text-brand">
          Guide <ArrowRightIcon className="size-4 transition-transform group-hover:translate-x-0.5" />
        </span>
      </Link>
    </Section>
  );
}

const FEATURES = [
  { title: "One connection", body: "Two tools, search_tools and call_tool, in front of any number of connectors." },
  { title: "Keys in your keychain", body: "OAuth sign-in and token refresh. The AI never sees a key." },
  {
    title: "Personal data masking",
    beta: true,
    body: "Masks emails, phone numbers and IDs in tool results before a cloud model reads them. It doesn't touch what you type into the chat. It can miss things.",
  },
  { title: "Profiles", body: "One address per purpose. An agent sees only its profile's tools." },
  { title: "Approvals", body: "Allow, ask or block each call, with one plain sentence saying why." },
  { title: "Tool pinning", body: "A tool that changes after you added it is quarantined until you review the change." },
  { title: "Secret scanning", body: "API keys and tokens in results or arguments are redacted. Calls carrying one are blocked." },
  { title: "Activity log", body: "Every search and call, encrypted, values left out. 30 days by default." },
];

export function Features() {
  const { resolvedTheme } = useTheme();
  // The theme is only known in the browser; render dark first so server and client HTML match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const dark = !mounted || resolvedTheme !== "light";
  return (
    <Section title="What it does" lead="One local process sits between your AI apps and your connectors. Every call passes through it.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <SpotlightCard
            key={f.title}
            theme={dark ? "dark" : "light"}
            spotlightColor="#3db8d8"
            intensity={0.18}
            className="rounded-2xl! p-5! [--spotlight-card-surface:var(--card)]!"
          >
            <h3 className="flex items-center gap-2 font-semibold">
              {f.title}
              {f.beta && (
                <span className="rounded-full border px-1.5 text-[10px] font-medium text-brand">Beta</span>
              )}
            </h3>
            <p className="mt-1.5 text-sm text-muted-foreground">{f.body}</p>
          </SpotlightCard>
        ))}
      </div>
    </Section>
  );
}

const PRIVACY_ROWS = [
  { model: "Local", servers: "Local", leaves: "Nothing", setup: "Masking off", none: true },
  { model: "Local", servers: "Some remote", leaves: "What the AI sends to those servers", setup: "Rules and approvals on tools that send data out" },
  { model: "Cloud", servers: "Local", leaves: "Every tool result the AI reads, inside the prompt", setup: "Masking standard or strict" },
  { model: "Cloud", servers: "Some remote", leaves: "Tool results to the model provider, and what the AI sends to remote servers", setup: "Masking, rules and approvals" },
];

export function Privacy() {
  const [pick, setPick] = useState(0);
  return (
    <Section
      id="privacy"
      eyebrow="Privacy"
      title="What leaves your machine"
      lead={
        <>
          It depends on where your AI model and your connectors run. pMCPg talks only to your connectors and their sign-in
          services: no account, no telemetry, no update ping. What you type into a cloud AI app goes to its provider,
          as always.
        </>
      }
    >
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-[auto_1fr_1fr] gap-2 text-sm">
          <span />
          <span className="px-1 text-xs text-muted-foreground">Local connectors</span>
          <span className="px-1 text-xs text-muted-foreground">Some remote</span>
          {["Local model", "Cloud model"].map((m, mi) => (
            <div key={m} className="contents">
              <span className="self-center pr-2 text-xs text-muted-foreground">{m}</span>
              {[0, 1].map((si) => {
                const i = mi * 2 + si;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setPick(i)}
                    className={cn(
                      "min-h-20 rounded-xl border p-3 text-left transition-colors",
                      pick === i ? "border-brand bg-brand-soft" : "bg-card hover:border-brand/50",
                    )}
                  >
                    <span className={cn("text-xs", PRIVACY_ROWS[i].none ? "text-ok" : "text-muted-foreground")}>
                      {PRIVACY_ROWS[i].none ? "Nothing leaves" : "Some data leaves"}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="rounded-2xl border bg-card p-5">
          <p className="text-xs text-muted-foreground">
            {PRIVACY_ROWS[pick].model} model · {PRIVACY_ROWS[pick].servers.toLowerCase()} connectors
          </p>
          <h3 className="mt-2 font-semibold">What leaves</h3>
          <p className={cn("mt-1 text-sm", PRIVACY_ROWS[pick].none ? "text-ok" : "text-muted-foreground")}>
            {PRIVACY_ROWS[pick].leaves}
          </p>
          <h3 className="mt-4 font-semibold">Suggested setup</h3>
          <p className="mt-1 text-sm text-muted-foreground">{PRIVACY_ROWS[pick].setup}</p>
          <p className="mt-5 border-t pt-4 text-xs text-muted-foreground">
            Masking is in beta. It catches common patterns like emails and phone numbers, and can miss names in free
            text. <a className="text-brand underline underline-offset-3" href={PRIVACY}>Privacy details</a>
          </p>
        </div>
      </div>
    </Section>
  );
}

const TODAY = [
  "Profiles with their own URLs and tokens",
  "Policy presets (open, balanced, careful) and custom rules",
  "Approvals in the web UI or the terminal",
  "Privacy level per profile, secret scanning, tool pinning",
  "Encrypted activity log, JSON-lines export",
  "Docker images: slim (remote connectors) and full (local ones too)",
];
const COMING = [
  "Managed setup through MDM or a script",
  "Org policy packs: one signed file",
  "A private catalog of approved connectors",
  "A team gateway on your own server",
  "Audit summaries to your log system",
  "Keys from your secret manager",
];

export function Teams() {
  return (
    <Section
      id="teams"
      eyebrow="Teams and IT"
      title="Control for small teams today"
      lead="We are working on an enterprise self-hosted edition. We run no service and hold no data."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-brand/40 bg-card p-6">
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">Works today</p>
          <ul className="mt-4 grid gap-2.5 text-sm">
            {TODAY.map((t) => (
              <li key={t} className="flex gap-2.5">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-brand" />
                {t}
              </li>
            ))}
          </ul>
          <a href={SECURITY} className="mt-5 inline-block text-sm text-brand underline underline-offset-3">
            Read the security model
          </a>
        </div>
        <div className="rounded-2xl border border-dashed bg-card/50 p-6">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Coming · ideas on the roadmap</p>
          <ul className="mt-4 grid gap-2.5 text-sm text-muted-foreground">
            {COMING.map((t) => (
              <li key={t} className="flex gap-2.5">
                <span className="mt-2 size-1.5 shrink-0 rounded-full bg-muted-foreground/50" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-5 text-sm text-muted-foreground">
            <a href={ROADMAP} className="text-brand underline underline-offset-3">Roadmap</a> ·{" "}
            <a href={ISSUES} className="text-brand underline underline-offset-3">Tell us what you need</a>
          </p>
        </div>
      </div>
    </Section>
  );
}

export function InstallTabs({ compact = false }: { compact?: boolean }) {
  const tabs = compact
    ? [
        { v: "unix", label: "macOS / Linux", cmd: INSTALL.unix },
        { v: "windows", label: "Windows", cmd: INSTALL.windows },
      ]
    : [
        { v: "unix", label: "macOS / Linux", cmd: INSTALL.unix },
        { v: "windows", label: "Windows", cmd: INSTALL.windows },
        { v: "npm", label: "npm", cmd: INSTALL.npm },
        { v: "brew", label: "Homebrew", cmd: INSTALL.brew },
        { v: "docker", label: "Docker", cmd: INSTALL.docker },
      ];
  return (
    <Tabs defaultValue="unix" className="gap-2.5">
      <TabsList variant="line" className="h-auto! flex-wrap">
        {tabs.map((t) => (
          <TabsTrigger key={t.v} value={t.v} className="flex-none px-2.5 text-[13px]">
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent key={t.v} value={t.v}>
          <CopyLine text={t.cmd} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export function Install({ release }: { release: Release }) {
  return (
    <Section
      id="download"
      eyebrow="Download"
      title="One binary for macOS, Windows and Linux"
      lead="Works with Claude Desktop, Claude Code, VS Code, LM Studio, and other apps that can run an MCP command. claude.ai, ChatGPT and Gemini in the browser can't reach pMCPg yet: it's on the roadmap."
    >
      <Download release={release} />
      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-4 rounded-2xl border border-dashed border-brand/50 bg-card p-6 sm:grid-cols-[44px_minmax(0,1fr)]">
        <span className="hidden size-11 place-items-center rounded-xl bg-brand-soft text-brand sm:grid">
          <ShieldCheckIcon className="size-5" />
        </span>
        <div>
          <h3 className="text-lg font-semibold">Don't trust our code? You shouldn't!</h3>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Run your own security checks, or fork this code and build your own. It's{" "}
            <a href={LICENSE} className="text-brand underline underline-offset-3">
              Apache 2.0
            </a>
            . Every release ships SHA-256 sums and GitHub build provenance you can check yourself.
          </p>
          <CopyLine text="gh attestation verify <downloaded-file> --repo baobab-tech/pMCPg" className="mt-4" />
          <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium">
            <a href={FORK} className="text-brand hover:underline">
              Fork on GitHub
            </a>
            <a href={SECURITY} className="text-brand hover:underline">
              Security model
            </a>
            <a href={VERIFY} className="text-brand hover:underline">
              Verify a download
            </a>
          </div>
        </div>
      </div>
    </Section>
  );
}
