"use client";

// Animated "What is an MCP server?" diagram. Two scenes loop every 12 s:
//   1. Every AI app wired to every MCP server (a tangle of lines).
//   2. Both apps connect to pMCPg once; pMCPg talks to the servers.
// Dots travel both ways along each line (requests and replies). Reduced motion shows scene 2, still.

import {
  CalendarIcon,
  DatabaseIcon,
  FileTextIcon,
  FolderIcon,
  type LucideIcon,
  MailIcon,
  PlugIcon,
  TicketIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useState } from "react";
import { CLAUDE_PATH, CURSOR_PATH } from "@/components/app-logos";

export const CLAUDE_ORANGE = "#D97757";
const CHATGPT_GREEN = "#10A37F";
const PI_SLATE = "#64748B";
const LOOP = "12s";

const TILE = 36; // app tile size
const APP_X = 48 + TILE / 2; // right edge of the app tiles (tiles are centred on x = 48)
const SERVER_X = 500; // left edge of the server tiles
const HUB = { x: 248, w: 104, h: 60, cy: 134 };

type App = {
  name: string[]; // label lines
  color: string; // line and dot colour
  tile: (x: number, y: number) => ReactNode; // tile at top-left (x, y)
};

const glyph = (x: number, y: number, d: string) => (
  <svg x={x + 7} y={y + 7} width={TILE - 14} height={TILE - 14} viewBox="0 0 24 24">
    <path d={d} className="fill-background" />
  </svg>
);

const APPS: App[] = [
  {
    name: ["Claude"],
    color: CLAUDE_ORANGE,
    tile: (x, y) => (
      <>
        <rect x={x} y={y} width={TILE} height={TILE} rx="9" fill={CLAUDE_ORANGE} />
        <svg x={x + 7} y={y + 7} width={TILE - 14} height={TILE - 14} viewBox="0 0 24 24">
          <path d={CLAUDE_PATH} fill="#fff" />
        </svg>
      </>
    ),
  },
  {
    name: ["ChatGPT"],
    color: CHATGPT_GREEN,
    tile: (x, y) => (
      <>
        <rect x={x} y={y} width={TILE} height={TILE} rx="9" fill={CHATGPT_GREEN} />
        <ChatGptGlyph x={x + 7} y={y + 7} size={TILE - 14} />
      </>
    ),
  },
  {
    name: ["Cursor"],
    color: "var(--foreground)",
    tile: (x, y) => (
      <>
        <rect x={x} y={y} width={TILE} height={TILE} rx="9" className="fill-foreground" />
        {glyph(x, y, CURSOR_PATH)}
      </>
    ),
  },
  {
    // Pi coding agent: no logo in the repo, so a letter tile.
    name: ["Pi"],
    color: PI_SLATE,
    tile: (x, y) => (
      <>
        <rect x={x} y={y} width={TILE} height={TILE} rx="9" fill={PI_SLATE} />
        <text x={x + TILE / 2} y={y + TILE / 2 + 7} textAnchor="middle" fontSize="20" fontWeight="600" fill="#fff">
          π
        </text>
      </>
    ),
  },
  {
    name: ["Other MCP", "clients"],
    color: "var(--muted-foreground)",
    tile: (x, y) => (
      <>
        <rect
          x={x + 0.75}
          y={y + 0.75}
          width={TILE - 1.5}
          height={TILE - 1.5}
          rx="9"
          strokeDasharray="4 3"
          strokeWidth="1.5"
          className="fill-background stroke-muted-foreground"
        />
        <PlugIcon x={x + 9} y={y + 9} size={TILE - 18} className="text-muted-foreground" />
      </>
    ),
  },
];
const appY = (i: number) => HUB.cy + (i - (APPS.length - 1) / 2) * 54;

const SERVERS: { name: string; icon: LucideIcon }[] = [
  { name: "Notes", icon: FileTextIcon },
  { name: "Files", icon: FolderIcon },
  { name: "Issues", icon: TicketIcon },
  { name: "Calendar", icon: CalendarIcon },
  { name: "Email", icon: MailIcon },
  { name: "Database", icon: DatabaseIcon },
];
const serverY = (i: number) => HUB.cy + (i - (SERVERS.length - 1) / 2) * 42;

const CAPTION_Y = 304;

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(q.matches);
    const on = () => setReduced(q.matches);
    q.addEventListener("change", on);
    return () => q.removeEventListener("change", on);
  }, []);
  return reduced;
}

/** A dot moving along path `#id`. `back` runs it from the end to the start. */
function Dot({ id, color, dur, delay, back }: { id: string; color: string; dur: number; delay: number; back?: boolean }) {
  return (
    <circle r="3.5" fill={color}>
      <animateMotion
        dur={`${dur}s`}
        begin={`-${delay}s`}
        repeatCount="indefinite"
        keyPoints={back ? "1;0" : "0;1"}
        keyTimes="0;1"
        calcMode="linear"
      >
        <mpath href={`#${id}`} />
      </animateMotion>
    </circle>
  );
}

/** Fades a scene in and out over the loop. `first` shows during the first half. */
function Fade({ first }: { first: boolean }) {
  return (
    <animate
      attributeName="opacity"
      dur={LOOP}
      repeatCount="indefinite"
      values={first ? "1;1;0;0;1" : "0;0;1;1;0"}
      keyTimes="0;0.42;0.5;0.92;1"
    />
  );
}

function ChatGptGlyph({ x, y, size }: { x: number; y: number; size: number }) {
  return (
    <svg x={x} y={y} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.7">
      {[0, 60, 120, 180, 240, 300].map((r) => (
        <rect key={r} x="8.6" y="2.2" width="6.8" height="12" rx="3.4" transform={`rotate(${r} 12 12)`} />
      ))}
    </svg>
  );
}

export function McpFlow() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduced = usePrefersReducedMotion();
  const meshId = (a: number, s: number) => `${uid}m${a}${s}`;
  const inId = (a: number) => `${uid}i${a}`;
  const outId = (s: number) => `${uid}o${s}`;

  return (
    <svg
      viewBox="0 0 640 318"
      role="img"
      aria-label="Without pMCPg, Claude, ChatGPT, Cursor, Pi and other MCP clients each connect to every MCP server. With pMCPg, each app connects once to pMCPg, which talks to the servers."
      className="h-auto w-full rounded-xl border bg-muted/30"
    >
      <defs>
        {APPS.map((app, a) => (
          <g key={app.name[0]}>
            {SERVERS.map((_, s) => (
              <path
                key={s}
                id={meshId(a, s)}
                d={`M${APP_X} ${appY(a)} C 290 ${appY(a)}, 290 ${serverY(s)}, ${SERVER_X} ${serverY(s)}`}
              />
            ))}
            <path id={inId(a)} d={`M${APP_X} ${appY(a)} C 160 ${appY(a)}, 160 ${HUB.cy}, ${HUB.x} ${HUB.cy}`} />
          </g>
        ))}
        {SERVERS.map((_, s) => (
          <path
            key={s}
            id={outId(s)}
            d={`M${HUB.x + HUB.w} ${HUB.cy} C 420 ${HUB.cy}, 420 ${serverY(s)}, ${SERVER_X} ${serverY(s)}`}
          />
        ))}
      </defs>

      {/* Scene 1: every app wired to every server */}
      {!reduced && (
        <g>
          <Fade first />
          {APPS.map((app, a) =>
            SERVERS.map((_, s) => (
              <g key={`${a}${s}`}>
                <use href={`#${meshId(a, s)}`} fill="none" className="stroke-border" strokeWidth="1.5" />
                <Dot id={meshId(a, s)} color={app.color} dur={2 + ((a + s) % 3) * 0.4} delay={s * 0.35 + a * 0.2} />
                {(a + s) % 2 === 0 && (
                  <Dot id={meshId(a, s)} color={app.color} dur={2.6} delay={s * 0.5} back />
                )}
              </g>
            )),
          )}
          <text x="320" y={CAPTION_Y} textAnchor="middle" fontSize="13" className="fill-muted-foreground">
            Without pMCPg: every app is wired to every server
          </text>
        </g>
      )}

      {/* Scene 2: one connection per app, through pMCPg */}
      <g opacity={reduced ? 1 : 0}>
        {!reduced && <Fade first={false} />}
        {APPS.map((app, a) => (
          <g key={app.name[0]}>
            <use href={`#${inId(a)}`} fill="none" stroke={app.color} strokeOpacity="0.45" strokeWidth="2" />
            {!reduced && (
              <>
                <Dot id={inId(a)} color={app.color} dur={1.8} delay={a * 0.9} />
                <Dot id={inId(a)} color="var(--brand)" dur={1.8} delay={a * 0.9 + 0.9} back />
              </>
            )}
          </g>
        ))}
        {SERVERS.map((_, s) => (
          <g key={s}>
            <use href={`#${outId(s)}`} fill="none" className="stroke-brand" strokeOpacity="0.45" strokeWidth="2" />
            {!reduced && (
              <>
                <Dot id={outId(s)} color="var(--brand)" dur={1.6} delay={s * 0.27} />
                <Dot id={outId(s)} color="var(--brand)" dur={1.6} delay={s * 0.27 + 0.8} back />
              </>
            )}
          </g>
        ))}
        <rect x={HUB.x} y={HUB.cy - HUB.h / 2} width={HUB.w} height={HUB.h} rx="12" className="fill-brand" />
        <svg x={HUB.x + 10} y={HUB.cy - 16} width="32" height="32" viewBox="16 14 36 36">
          <path
            d="M34 18l11 4v8.5c0 8-4.5 12.5-11 15.5c-6.5-3-11-7.5-11-15.5V22z"
            fill="none"
            strokeWidth="3"
            strokeLinejoin="round"
            className="stroke-background"
          />
        </svg>
        <text x={HUB.x + 46} y={HUB.cy + 5} fontSize="15" fontWeight="600" className="fill-background">
          pMCPg
        </text>
        <text x="320" y={CAPTION_Y} textAnchor="middle" fontSize="13" className="fill-muted-foreground">
          With pMCPg: each app connects once, and your keys stay here
        </text>
      </g>

      {/* Apps, always shown */}
      {APPS.map((app, a) => (
        <g key={app.name[0]}>
          {app.tile(48 - TILE / 2, appY(a) - TILE / 2)}
          {app.name.map((line, l) => (
            <text
              key={line}
              x="48"
              y={appY(a) + TILE / 2 + 13 + l * 12}
              textAnchor="middle"
              fontSize="11"
              className="fill-foreground"
            >
              {line}
            </text>
          ))}
        </g>
      ))}

      {/* MCP servers, always shown */}
      {SERVERS.map(({ name, icon: Icon }, s) => (
        <g key={name}>
          <rect
            x={SERVER_X}
            y={serverY(s) - 15}
            width="128"
            height="30"
            rx="8"
            className="fill-background stroke-border"
          />
          <Icon x={SERVER_X + 10} y={serverY(s) - 8} size={16} className="text-muted-foreground" />
          <text x={SERVER_X + 34} y={serverY(s) + 4.5} fontSize="12" className="fill-foreground">
            {name}
          </text>
        </g>
      ))}
    </svg>
  );
}
