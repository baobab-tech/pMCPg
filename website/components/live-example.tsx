"use client";

import { PauseIcon, PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import { cn } from "@/lib/utils";

const Q = "Which health projects in Kenya publish IATI data, and who do we know at their funders?";

const STEPS: { name: string; caption: React.ReactNode }[] = [
  { name: "You ask", caption: <>You ask Claude a question that needs <b>two connectors</b>.</> },
  {
    name: "Search",
    caption: (
      <>
        Claude sees <b>2 tools, not hundreds</b>. It searches; pMCPg returns <b>only the tools that match</b>:
        DevExplorer and your CRM. OpenAlex doesn't match, so its tools stay out of Claude's context.
      </>
    ),
  },
  {
    name: "DevExplorer",
    caption: (
      <>
        pMCPg checks your rules (read-only, so allowed), <b>adds your saved sign-in</b>, and forwards the call. Claude
        never sees the key.
      </>
    ),
  },
  {
    name: "CRM",
    caption: (
      <>
        Your CRM returns the funder contacts. <b>jane@funder.org becomes [EMAIL_1]</b> before the cloud model reads it.
      </>
    ),
  },
  {
    name: "Answer",
    caption: (
      <>
        Claude answers. The activity log keeps <b>tool names and outcomes, not the data</b>.
      </>
    ),
  },
];

const ROWS = [
  { id: "search", icon: "⌕", name: "Search" },
  { id: "rule", icon: "⛉", name: "Rules" },
  { id: "key", icon: "⚿", name: "Sign-in" },
  { id: "mask", icon: "◐", name: "Mask" },
  { id: "log", icon: "≡", name: "Log" },
];
const SERVERS = [
  { id: "dev", name: "DevExplorer", desc: "IATI aid data" },
  { id: "crm", name: "CRM MCP", desc: "Your contacts · custom" },
  { id: "oa", name: "OpenAlex", desc: "Research papers" },
];
const DONE = {
  search: "2 matches",
  rule: "read-only · allowed",
  key: "saved sign-in added",
  mask: "1 email → [EMAIL_1]",
  log: "1 search · 2 calls",
};

/**
 * Hero 2: one request from Claude, through pMCPg, to two connectors and back.
 * The scene is plain markup; a small imperative player moves labelled packets along the wires.
 */
export function LiveExample() {
  const root = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const ctl = useRef<{ start: (from: number) => void; setPaused: (p: boolean) => void } | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const plane = el.querySelector<HTMLElement>("[data-plane]")!;
    const svg = el.querySelector<SVGSVGElement>("[data-wires]")!;
    const $ = <T extends Element = HTMLElement>(k: string) => el.querySelector<T>(`[data-k="${k}"]`)!;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const W: Record<string, string> = {};

    const box = (n: HTMLElement) => {
      let x = 0;
      let y = 0;
      let e: HTMLElement | null = n;
      while (e && e !== plane) {
        x += e.offsetLeft;
        y += e.offsetTop;
        e = e.offsetParent as HTMLElement | null;
      }
      return { x, y, w: n.offsetWidth, h: n.offsetHeight };
    };
    const curve = (a: number[], b: number[], vert: boolean) => {
      if (vert) {
        const m = (a[1] + b[1]) / 2;
        return `M${a[0]},${a[1]} C${a[0]},${m} ${b[0]},${m} ${b[0]},${b[1]}`;
      }
      const m = (a[0] + b[0]) / 2;
      return `M${a[0]},${a[1]} C${m},${a[1]} ${m},${b[1]} ${b[0]},${b[1]}`;
    };
    const layout = () => {
      const c = box($("chat"));
      const g = box($("gw"));
      const vert = g.y > c.y + c.h - 4;
      W.app = vert
        ? curve([c.x + c.w / 2, c.y + c.h], [g.x + g.w / 2, g.y], true)
        : curve([c.x + c.w, c.y + c.h / 2], [g.x, g.y + g.h / 2], false);
      for (const s of SERVERS) {
        const b = box($(`s-${s.id}`));
        W[s.id] = vert
          ? curve([g.x + g.w / 2, g.y + g.h], [b.x + b.w / 2, b.y], true)
          : curve([g.x + g.w, g.y + g.h / 2], [b.x, b.y + b.h / 2], false);
      }
      svg.innerHTML = Object.entries(W)
        .map(
          ([k, d]) =>
            `<path data-w="${k}" d="${d}" fill="none" stroke-width="1.5" class="${k === "oa" ? "stroke-border [stroke-dasharray:4_6]" : "stroke-border"} transition-[stroke]"/>`,
        )
        .join("");
    };

    let epoch = 0;
    let isPaused = false;
    const live = new Set<Animation>();
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const wait = async (ms: number, e: number) => {
      let t = 0;
      while (t < ms) {
        await sleep(50);
        if (e !== epoch) throw 0;
        if (!isPaused) t += 50;
      }
    };
    const travel = async (wire: string, opts: { back?: boolean; label: string; raw?: boolean; key?: boolean }, e: number) => {
      if (e !== epoch) throw 0;
      const w = svg.querySelector(`[data-w="${wire}"]`);
      w?.classList.add("stroke-brand!");
      const pk = document.createElement("div");
      pk.className = cn(
        "pointer-events-none absolute top-0 left-0 z-10 rounded-full border px-2.5 py-1 font-mono text-[11.5px] whitespace-nowrap",
        opts.raw
          ? "border-warn bg-background text-warn shadow-[0_0_18px_-2px_var(--warn)]"
          : "border-brand bg-background text-brand shadow-[0_0_18px_-2px_var(--brand)]",
      );
      pk.textContent = (opts.key ? "🔑 " : "") + opts.label;
      Object.assign(pk.style, { offsetPath: `path('${W[wire]}')`, offsetAnchor: "50% 50%", offsetRotate: "0deg" });
      // The gateway card sits at translateZ(40px) in the tilted scene; keep packets in front of it.
      pk.style.transform = "translateZ(80px)";
      plane.appendChild(pk);
      const a = pk.animate([{ offsetDistance: "0%" }, { offsetDistance: "100%" }], {
        duration: 1100,
        easing: "cubic-bezier(.5,0,.3,1)",
        direction: opts.back ? "reverse" : "normal",
        fill: "forwards",
      });
      live.add(a);
      if (isPaused) a.pause();
      try {
        await a.finished;
      } catch {}
      live.delete(a);
      pk.remove();
      w?.classList.remove("stroke-brand!");
      if (e !== epoch) throw 0;
    };
    const row = (id: string, st: string | null, state?: "on" | "did") => {
      const r = $(`r-${id}`);
      r.dataset.state = state ?? "";
      if (st !== null) r.querySelector("[data-st]")!.textContent = st;
    };
    const srv = (id: string, txt: string | null, state?: "on" | "did" | "hid") => {
      const s = $(`s-${id}`);
      s.dataset.state = state ?? "";
      if (txt !== null) s.querySelector("[data-r]")!.textContent = txt;
    };
    const tu = (n: number, cls: "" | "show" | "done") => {
      $(`tu${n}`).dataset.state = cls;
    };
    const type = async (txt: string, e: number) => {
      const q = $("q");
      for (let i = 1; i <= txt.length; i++) {
        q.textContent = txt.slice(0, i);
        await wait(20, e);
      }
    };
    const answer = (on: boolean) => {
      $("ans").dataset.state = on ? "show" : "";
    };
    const reset = () => {
      for (const r of ROWS) row(r.id, "—");
      for (const s of SERVERS) srv(s.id, "");
      $("q").textContent = "";
      for (const n of [1, 2, 3]) tu(n, "");
      answer(false);
      for (const p of plane.querySelectorAll(".rounded-full.font-mono")) p.remove();
      live.clear();
    };
    // State at the end of each step, applied instantly when jumping.
    const applyUpTo = (i: number) => {
      reset();
      if (i >= 0) $("q").textContent = Q;
      if (i >= 1) {
        row("search", DONE.search, "did");
        tu(1, "done");
        srv("oa", "no match: left out", "hid");
      }
      if (i >= 2) {
        row("rule", DONE.rule, "did");
        row("key", DONE.key, "did");
        srv("dev", "3 activities", "did");
        tu(2, "done");
      }
      if (i >= 3) {
        row("mask", DONE.mask, "did");
        srv("crm", "2 contacts", "did");
        tu(3, "done");
      }
      if (i >= 4) {
        row("log", DONE.log, "did");
        answer(true);
      }
    };

    const RUN: ((e: number) => Promise<void>)[] = [
      async (e) => {
        await type(Q, e);
        await wait(500, e);
      },
      async (e) => {
        tu(1, "show");
        await travel("app", { label: "search: IATI projects, contacts" }, e);
        row("search", DONE.search, "on");
        srv("oa", "no match: left out", "hid");
        await wait(700, e);
        await travel("app", { back: true, label: "DevExplorer, CRM MCP" }, e);
        row("search", null, "did");
        tu(1, "done");
        await wait(400, e);
      },
      async (e) => {
        tu(2, "show");
        await travel("app", { label: "call: DevExplorer" }, e);
        row("rule", DONE.rule, "on");
        await wait(650, e);
        row("rule", null, "did");
        row("key", DONE.key, "on");
        await wait(650, e);
        row("key", null, "did");
        await travel("dev", { label: "search activities", key: true }, e);
        srv("dev", "3 activities", "on");
        await wait(500, e);
        await travel("dev", { back: true, label: "3 activities" }, e);
        srv("dev", null, "did");
        await travel("app", { back: true, label: "3 activities" }, e);
        tu(2, "done");
        await wait(300, e);
      },
      async (e) => {
        tu(3, "show");
        await travel("app", { label: "call: CRM MCP" }, e);
        row("rule", DONE.rule, "on");
        await wait(400, e);
        row("rule", null, "did");
        await travel("crm", { label: "find contacts" }, e);
        srv("crm", "2 contacts", "on");
        await wait(500, e);
        await travel("crm", { back: true, label: "jane@funder.org", raw: true }, e);
        srv("crm", null, "did");
        row("mask", DONE.mask, "on");
        await wait(900, e);
        row("mask", null, "did");
        await travel("app", { back: true, label: "[EMAIL_1]" }, e);
        tu(3, "done");
        await wait(300, e);
      },
      async (e) => {
        row("log", DONE.log, "on");
        answer(true);
        await wait(3200, e);
        row("log", null, "did");
      },
    ];

    const start = async (from: number) => {
      const e = ++epoch;
      if (reduce) {
        applyUpTo(4);
        setStep(4);
        return;
      }
      applyUpTo(from - 1);
      if (from === 0) $("q").textContent = "";
      try {
        for (let i = from; i < RUN.length; i++) {
          setStep(i);
          await RUN[i](e);
        }
        await wait(800, e);
        start(0);
      } catch {}
    };
    ctl.current = {
      start,
      setPaused: (p) => {
        isPaused = p;
        for (const a of live) p ? a.pause() : a.play();
      },
    };

    layout();
    const ro = new ResizeObserver(layout);
    ro.observe(plane);
    applyUpTo(-1);
    const io = new IntersectionObserver(
      (es) => {
        if (es[0].isIntersecting) {
          start(0);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(plane);

    // Subtle depth: tilt with the pointer, flatten as the scene scrolls into view.
    const stage = el.querySelector<HTMLElement>("[data-stage]")!;
    let px = 0;
    let py = 0;
    const wide = matchMedia("(min-width: 900px)");
    const tilt = () => {
      if (reduce || !wide.matches) {
        plane.style.transform = "none";
        return;
      }
      const t = stage.getBoundingClientRect().top;
      const s = Math.min(Math.max((innerHeight * 0.75 - t) / (innerHeight * 0.6), 0), 1);
      plane.style.transform = `rotateX(${9 - 9 * s - py * 4}deg) rotateY(${px * 5}deg)`;
    };
    const onMove = (ev: PointerEvent) => {
      const r = stage.getBoundingClientRect();
      px = (ev.clientX - r.left) / r.width - 0.5;
      py = (ev.clientY - r.top) / r.height - 0.5;
      tilt();
    };
    const onLeave = () => {
      px = 0;
      py = 0;
      tilt();
    };
    stage.addEventListener("pointermove", onMove);
    stage.addEventListener("pointerleave", onLeave);
    addEventListener("scroll", tilt, { passive: true });
    tilt();

    return () => {
      epoch++;
      ro.disconnect();
      io.disconnect();
      stage.removeEventListener("pointermove", onMove);
      stage.removeEventListener("pointerleave", onLeave);
      removeEventListener("scroll", tilt);
    };
  }, []);

  const togglePause = () => {
    const p = !paused;
    setPaused(p);
    ctl.current?.setPaused(p);
  };

  return (
    <div ref={root}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 min-[900px]:mb-14">
        <b className="text-xs tracking-[0.08em] text-muted-foreground uppercase">Partnerships profile</b>
        <span className="text-xs text-muted-foreground/70">Illustrative example</span>
      </div>

      <div data-stage className="[perspective:1600px]">
        <div
          data-plane
          className="relative grid grid-cols-[minmax(0,1fr)] items-center gap-14 py-7 transition-transform duration-200 ease-out [transform-style:preserve-3d] min-[900px]:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,.9fr)] min-[900px]:gap-[72px]"
        >
          <div className="dot-grid pointer-events-none absolute -inset-x-10 -inset-y-8 [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000,transparent_75%)]" />
          <svg data-wires className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden="true" />

          {/* The AI app */}
          <div className="relative">
            <div className="absolute inset-0 hidden -translate-x-9 -translate-y-11 rounded-2xl border bg-panel px-3 py-2 text-[11px] text-muted-foreground opacity-60 min-[900px]:block">
              LM Studio
            </div>
            <div className="absolute inset-0 hidden -translate-x-[18px] -translate-y-[22px] rounded-2xl border bg-panel px-3 py-2 text-[11px] text-muted-foreground min-[900px]:block">
              VS Code
            </div>
            <div data-k="chat" className="win relative flex flex-col min-[900px]:min-h-[300px]">
              <div className="flex items-center gap-1.5 border-b px-3 py-2 text-xs text-muted-foreground">
                <i className="size-2.5 rounded-full bg-muted" />
                <i className="size-2.5 rounded-full bg-muted" />
                <i className="size-2.5 rounded-full bg-muted" />
                &nbsp;Claude Desktop
                <span className="ml-auto text-[11px] text-muted-foreground/70">cloud model</span>
              </div>
              <div className="flex flex-1 flex-col gap-2.5 p-3.5 text-[13.5px]">
                <div
                  data-k="q"
                  className="min-h-5 w-full self-stretch rounded-xl rounded-br-sm border bg-panel px-3 py-2"
                />
                {["search_tools", "call_tool · DevExplorer", "call_tool · CRM MCP"].map((t, i) => (
                  <span
                    key={t}
                    data-k={`tu${i + 1}`}
                    className="inline-flex translate-y-1 items-center gap-1.5 self-start rounded-md border px-2 py-0.5 font-mono text-[11.5px] text-muted-foreground opacity-0 transition-all data-[state=done]:translate-y-0 data-[state=done]:opacity-100 data-[state=show]:translate-y-0 data-[state=show]:opacity-100 [&[data-state=done]]:after:text-ok [&[data-state=done]]:after:content-['✓']"
                  >
                    <span className="text-[#d97757]">⚙</span>
                    {t}
                  </span>
                ))}
                <div data-k="ans" className="leading-relaxed opacity-0 transition-opacity duration-500 data-[state=show]:opacity-100">
                  3 health projects in Kenya publish IATI data. Your contact at the lead funder:{" "}
                  <span className="rounded bg-brand-soft px-1 font-mono text-[12.5px] text-brand">[EMAIL_1]</span>
                </div>
              </div>
            </div>
            <p className="mt-2.5 text-center text-[11.5px] text-muted-foreground/80">
              VS Code and LM Studio connect to the same gateway.
            </p>
          </div>

          {/* The gateway */}
          <div
            data-k="gw"
            className="win relative border-brand/50 shadow-[0_0_0_1px_color-mix(in_oklab,var(--brand)_15%,transparent),0_0_80px_-10px_color-mix(in_oklab,var(--brand)_35%,transparent)] min-[900px]:[transform:translateZ(40px)]"
          >
            <div className="flex items-center gap-2 border-b px-3 py-2 text-xs">
              <Logo className="size-4.5" />
              <b className="font-heading text-brand">pMCPg</b>
              <span className="ml-auto rounded-full border border-brand/40 px-2 py-px text-[11px] text-brand">
                Partnerships profile
              </span>
            </div>
            <div className="py-1.5">
              {ROWS.map((r) => (
                <div
                  key={r.id}
                  data-k={`r-${r.id}`}
                  className="group grid grid-cols-[22px_74px_1fr] items-center gap-1.5 px-3.5 py-[7px] text-[13px] transition-colors data-[state=on]:bg-brand-soft"
                >
                  <span className="text-center text-muted-foreground/70 group-data-[state=did]:text-brand group-data-[state=on]:text-brand">
                    {r.icon}
                  </span>
                  <span className="text-muted-foreground group-data-[state=on]:text-brand">{r.name}</span>
                  <span
                    data-st
                    className="truncate text-right font-mono text-[11.5px] text-muted-foreground/60 group-data-[state=did]:text-muted-foreground group-data-[state=on]:text-foreground"
                  >
                    —
                  </span>
                </div>
              ))}
            </div>
            <div className="border-t px-3.5 py-2.5 text-[11.5px] text-muted-foreground">
              <mark className="hl">Runs on your computer</mark> The AI sees 2 tools:{" "}
              <code className="rounded bg-muted px-1 text-foreground">search_tools</code>{" "}
              <code className="rounded bg-muted px-1 text-foreground">call_tool</code>
            </div>
          </div>

          {/* The connectors */}
          <div className="flex gap-3 min-[900px]:flex-col min-[900px]:gap-3.5">
            {SERVERS.map((s) => (
              <div
                key={s.id}
                data-k={`s-${s.id}`}
                className="win group min-w-0 flex-1 px-3 py-2.5 transition-all data-[state=hid]:border-dashed data-[state=hid]:opacity-45 data-[state=on]:border-brand data-[state=on]:shadow-[0_0_30px_-6px_var(--brand)]"
              >
                <div className="flex items-center gap-2 text-[12.5px] font-semibold min-[900px]:text-[13.5px]">
                  <span className="size-2 shrink-0 rounded-full bg-muted-foreground/50 group-data-[state=did]:bg-ok group-data-[state=on]:bg-brand" />
                  {s.name}
                </div>
                <div className="hidden text-xs text-muted-foreground min-[900px]:block">{s.desc}</div>
                <div
                  data-r
                  className="mt-1.5 min-h-4 font-mono text-[10.5px] text-muted-foreground/60 group-data-[state=did]:text-foreground group-data-[state=hid]:text-warn min-[900px]:text-[11.5px]"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-[auto_1fr] items-center gap-4">
        <button
          type="button"
          onClick={togglePause}
          className="grid size-9 place-items-center rounded-full border bg-card hover:border-brand"
          aria-label={paused ? "Play" : "Pause"}
        >
          {paused ? <PlayIcon className="size-3.5" /> : <PauseIcon className="size-3.5" />}
        </button>
        <div className="grid grid-cols-5 gap-2">
          {STEPS.map((s, i) => (
            <button
              key={s.name}
              type="button"
              onClick={() => ctl.current?.start(i)}
              className={cn(
                "border-t-2 pt-2 text-left text-[11px] transition-colors sm:text-xs",
                i === step
                  ? "border-brand text-foreground"
                  : i < step
                    ? "border-brand/40 text-muted-foreground"
                    : "border-border text-muted-foreground/60",
              )}
            >
              {i + 1}
              <b className="hidden font-semibold sm:block">{s.name}</b>
            </button>
          ))}
        </div>
      </div>
      <p className="mt-3.5 min-h-11 max-w-3xl text-sm text-muted-foreground [&_b]:font-semibold [&_b]:text-foreground" aria-live="polite">
        {STEPS[step].caption}
      </p>
    </div>
  );
}
