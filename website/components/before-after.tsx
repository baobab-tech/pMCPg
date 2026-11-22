"use client";

import { AlertTriangleIcon, CircleCheckIcon, CircleXIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const CONNECTORS = [
  { name: "Figma", tile: "F", color: "#a259ff", status: "Signed in" },
  { name: "Linear", tile: "L", color: "#5e6ad2", status: "Sign-in expired", bad: true },
  { name: "Slack", tile: "S", color: "#7a4fd0", status: "Signed in" },
  { name: "Notion", tile: "N", color: "#6b6b6b", status: "API key in config file", bad: true },
  { name: "Research MCP", tile: "R", color: "#2f8f6f", status: "Token in config file", bad: true },
  { name: "OpenAlex", tile: "OA", color: "#c98a2e", status: "No sign-in" },
];
const ROW = 46;

const CARDS = [
  {
    before: { title: "Set up in every app", body: "Each app keeps its own list, keys and sign-ins." },
    after: { title: "Control", body: "Rules, approvals and profiles decide what each AI can call." },
  },
  {
    before: { title: "No record", body: "Nothing shows what the AI read or sent." },
    after: { title: "Visibility", body: "An activity log of every search and call, on your computer." },
  },
  {
    before: {
      title: "Tied to a vendor",
      body: "claude.ai and ChatGPT connectors live in the vendor's cloud, under your vendor account.",
    },
    after: {
      title: "Yours",
      body: "Connectors and sign-ins stay on your computer, in your keychain. Any MCP app can use them.",
    },
  },
];

/** Hero 1: Claude Desktop's connector list, before and after pMCPg. Flips on its own until clicked. */
export function BeforeAfter() {
  const reduce = useReducedMotion();
  const [after, setAfter] = useState(false);
  const [auto, setAuto] = useState(true);

  useEffect(() => {
    if (reduce) {
      setAfter(true);
      return;
    }
    if (!auto) return;
    const t = setTimeout(() => setAfter((a) => !a), after ? 6000 : 2600);
    return () => clearTimeout(t);
  }, [after, auto, reduce]);

  const pick = (v: boolean) => {
    setAuto(false);
    setAfter(v);
  };
  const bad = CONNECTORS.filter((c) => c.bad).length;

  return (
    <div className="lg:min-h-[640px]">
      <div className="mb-5 inline-flex rounded-xl border bg-card p-1 text-sm" role="tablist" aria-label="Compare">
        {[false, true].map((v) => (
          <button
            key={String(v)}
            type="button"
            role="tab"
            aria-selected={after === v}
            onClick={() => pick(v)}
            className={cn(
              "relative rounded-lg px-3.5 py-1.5 transition-colors",
              after === v ? "text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {after === v && (
              <motion.span
                layoutId="ba-knob"
                className={cn("absolute inset-0 rounded-lg border", v ? "border-brand bg-brand-soft" : "bg-panel")}
                transition={{ type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <span className="relative">{v ? "With pMCPg" : "Without pMCPg"}</span>
          </button>
        ))}
      </div>

      <div className="relative pt-[52px] pl-4 sm:pl-[30px]">
        {[
          { app: "VS Code · mcp.json", n: 6, cls: "left-0 right-4 top-0 sm:right-[30px]" },
          { app: "LM Studio · mcp.json", n: 5, cls: "left-2 right-2 top-6 sm:left-[15px] sm:right-[15px]" },
        ].map((g) => (
          <div
            key={g.app}
            className={cn("absolute flex h-[70px] justify-between gap-2 rounded-xl border bg-panel px-3 py-2 text-xs", g.cls)}
          >
            <span className="text-muted-foreground">{g.app}</span>
            <span className={cn("hidden transition-colors sm:inline", after ? "text-brand" : "text-warn")}>
              {after ? "1 entry: pMCPg" : `${g.n} servers, keys copied in`}
            </span>
          </div>
        ))}

        <div className="win relative overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b px-3.5 py-2.5 text-xs text-muted-foreground">
            <span className="flex gap-1.5" aria-hidden="true">
              <i className="size-2.5 rounded-full bg-muted" />
              <i className="size-2.5 rounded-full bg-muted" />
              <i className="size-2.5 rounded-full bg-muted" />
            </span>
            Claude Desktop · Connectors
            <span className={cn("w-full transition-colors sm:ml-auto sm:w-auto", after ? "text-ok" : "text-warn")}>
              {after ? "1 connector · all healthy" : `${CONNECTORS.length} connectors · ${bad} need attention`}
            </span>
          </div>

          {/* After: one pMCPg entry with the connectors behind it. */}
          <div
            className={cn(
              "overflow-hidden transition-[max-height,opacity] duration-500",
              after ? "max-h-56 opacity-100 delay-[450ms]" : "max-h-0 opacity-0",
            )}
          >
            <div className="grid grid-cols-[36px_1fr] items-center gap-3 px-3.5 pt-4 pb-2.5 sm:grid-cols-[36px_1fr_auto]">
              <span className="grid size-9 place-items-center rounded-lg bg-brand/15 shadow-[0_0_24px_-4px_var(--brand)]">
                <Logo className="size-7" />
              </span>
              <div>
                <b className="font-heading">pMCPg</b>
                <div className="text-xs text-muted-foreground">Private MCP Gateway · on this computer</div>
              </div>
              <span className="col-start-2 text-xs text-ok sm:col-start-auto">● all healthy</span>
            </div>
            <div className="flex flex-wrap gap-1.5 px-3.5 pb-4 sm:pl-[62px]">
              {CONNECTORS.map((c, i) => (
                <span
                  key={c.name}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs text-muted-foreground transition-all duration-300",
                    after ? "translate-y-0 opacity-100" : "-translate-y-1.5 opacity-0",
                  )}
                  style={{ transitionDelay: after ? `${750 + i * 50}ms` : "0ms" }}
                >
                  {c.name}
                </span>
              ))}
            </div>
          </div>

          {/* Before: every connector set up in the app. Rows fold up into the pMCPg entry. */}
          <div
            className="overflow-hidden transition-[max-height] duration-500"
            style={{ maxHeight: after ? 0 : CONNECTORS.length * ROW, transitionDelay: after ? "350ms" : "0ms" }}
          >
            {CONNECTORS.map((c, i) => (
              <div
                key={c.name}
                className="grid h-[46px] grid-cols-[28px_1fr_auto] items-center gap-2.5 border-b px-3.5 text-sm transition-[transform,opacity] duration-500"
                style={{
                  transform: after ? `translateY(${-i * ROW}px) scale(.94)` : "none",
                  opacity: after ? 0 : 1,
                  transitionDelay: `${i * 45}ms`,
                }}
              >
                <span
                  className="grid size-6.5 place-items-center rounded-md text-[10px] font-bold text-white"
                  style={{ background: c.color }}
                >
                  {c.tile}
                </span>
                {c.name}
                <span className={cn("text-right text-xs", c.bad ? "text-warn" : "text-muted-foreground")}>
                  {c.bad && <AlertTriangleIcon className="mr-1 inline size-3 align-[-1px]" />}
                  {c.status}
                </span>
              </div>
            ))}
          </div>

          <div className={cn("px-3.5 py-2.5 text-xs transition-colors", after ? "text-brand" : "text-warn")}>
            {after ? "The AI sees 2 tools and searches for the rest." : "The AI loads every tool from every connector."}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {CARDS.map((c) => {
          const t = after ? c.after : c.before;
          return (
            <div
              key={c.after.title}
              className={cn("rounded-xl border bg-card px-3.5 py-3 transition-colors", after && "border-brand/40")}
            >
              <b className={cn("flex items-center gap-1.5 text-sm transition-colors", after ? "text-brand" : "text-warn")}>
                {after ? (
                  <CircleCheckIcon className="size-4 shrink-0 text-ok" aria-label="Yes" />
                ) : (
                  <CircleXIcon className="size-4 shrink-0 text-red-500" aria-label="No" />
                )}
                {t.title}
              </b>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{t.body}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
