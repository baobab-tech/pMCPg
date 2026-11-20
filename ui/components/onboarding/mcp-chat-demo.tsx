"use client";

// Animated "What is an MCP server?" diagram: one question in a Claude chat, one tool call to one MCP server.
// 10 s loop: you ask → the app calls a tool → the server sends data back → the app answers.
// Other servers sit dimmed behind dotted lines. Reduced motion shows the finished chat, still.

import {
  BookOpenIcon,
  CalendarIcon,
  FileTextIcon,
  FolderIcon,
  type LucideIcon,
  MailIcon,
  TicketIcon,
  WrenchIcon,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { CLAUDE_PATH } from "@/components/app-logos";
import { CLAUDE_ORANGE, usePrefersReducedMotion } from "@/components/onboarding/mcp-flow";

const LOOP = 10; // seconds
const DATA_GREEN = "#22C55E";

// Timeline, as fractions of the loop.
const T = {
  ask: 0.04,
  call: 0.16,
  reqStart: 0.2,
  reqEnd: 0.34,
  replyStart: 0.44,
  replyEnd: 0.58,
  answer: 0.62,
  end: 0.94, // everything fades out after this
};

const CAPTIONS: { from: number; to: number; text: string }[] = [
  { from: 0, to: T.call, text: "1. You ask your AI app a question" },
  { from: T.call, to: T.replyStart, text: "2. The app calls a tool on an MCP server" },
  { from: T.replyStart, to: T.answer, text: "3. The server sends data back" },
  { from: T.answer, to: T.end, text: "4. The app answers using that data" },
];

const OTHERS: { name: string; icon: LucideIcon; cy: number }[] = [
  { name: "Notes", icon: FileTextIcon, cy: 16 },
  { name: "Files", icon: FolderIcon, cy: 46 },
  { name: "Calendar", icon: CalendarIcon, cy: 76 },
  { name: "Email", icon: MailIcon, cy: 186 },
  { name: "Issues", icon: TicketIcon, cy: 222 },
];

const CHAT = { x: 16, y: 16, w: 228, h: 220 };
const SERVER = { x: 432, y: 100, w: 192, h: 62, cy: 131 };
const LINK_Y = 109; // height of the tool-call chip, where the line leaves the chat

/** Opacity that is 0, turns on at `from`, off at `to`, over the loop. */
function Window({ from, to }: { from: number; to: number }) {
  const on = Math.min(from + 0.02, to);
  const off = Math.min(to + 0.02, 1);
  return (
    <animate
      attributeName="opacity"
      dur={`${LOOP}s`}
      repeatCount="indefinite"
      values="0;0;1;1;0;0"
      keyTimes={`0;${from};${on};${to};${off};1`}
    />
  );
}

/** Shown from `from` until the loop ends. Static and visible when motion is reduced. */
function Step({ from, to = T.end, reduced, children }: { from: number; to?: number; reduced: boolean; children: ReactNode }) {
  return (
    <g opacity={reduced ? 1 : 0}>
      {!reduced && <Window from={from} to={to} />}
      {children}
    </g>
  );
}

/** A dot that moves along path `#id` between `from` and `to` (fractions of the loop), hidden otherwise. */
function Packet({ id, from, to, back, color, r = 4 }: { id: string; from: number; to: number; back?: boolean; color: string; r?: number }) {
  return (
    <circle r={r} fill={color} opacity="0">
      <animateMotion
        dur={`${LOOP}s`}
        repeatCount="indefinite"
        calcMode="linear"
        keyPoints={back ? "1;1;0;0" : "0;0;1;1"}
        keyTimes={`0;${from};${to};1`}
      >
        <mpath href={`#${id}`} />
      </animateMotion>
      <animate
        attributeName="opacity"
        dur={`${LOOP}s`}
        repeatCount="indefinite"
        values="0;0;1;1;0;0"
        keyTimes={`0;${from};${from + 0.005};${to};${to + 0.005};1`}
      />
    </circle>
  );
}

export function McpChatDemo() {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduced = usePrefersReducedMotion();
  const linkId = `${uid}link`;
  const right = CHAT.x + CHAT.w;

  return (
    <svg
      viewBox="0 0 640 270"
      role="img"
      aria-label="You ask Claude for examples of sovereign AI. Claude calls the search tool on the Knowledge Base MCP server, the server sends back four documents, and Claude answers from them."
      className="h-auto w-full rounded-xl border bg-muted/30"
    >
      <defs>
        <path id={linkId} d={`M${right} ${LINK_Y} C 340 ${LINK_Y}, 340 ${SERVER.cy}, ${SERVER.x} ${SERVER.cy}`} />
      </defs>

      {/* Other MCP servers, dimmed, behind dotted lines */}
      <g opacity="0.45">
        {OTHERS.map(({ name, icon: Icon, cy }) => (
          <g key={name}>
            <path
              d={`M${right} ${LINK_Y} C 340 ${LINK_Y}, 340 ${cy}, 470 ${cy}`}
              fill="none"
              className="stroke-muted-foreground"
              strokeWidth="1.2"
              strokeDasharray="3 5"
            />
            <rect x="470" y={cy - 13} width="128" height="26" rx="7" fill="none" strokeDasharray="3 3" className="stroke-muted-foreground" />
            <Icon x={480} y={cy - 7} size={14} className="text-muted-foreground" />
            <text x="501" y={cy + 4} fontSize="11" className="fill-muted-foreground">
              {name}
            </text>
          </g>
        ))}
      </g>

      {/* The one connection in use */}
      <use href={`#${linkId}`} fill="none" className="stroke-brand" strokeOpacity="0.5" strokeWidth="2" />

      {/* Knowledge Base MCP server */}
      <rect x={SERVER.x} y={SERVER.y} width={SERVER.w} height={SERVER.h} rx="12" className="fill-background stroke-brand" strokeWidth="1.5" />
      {!reduced && (
        <rect x={SERVER.x - 4} y={SERVER.y - 4} width={SERVER.w + 8} height={SERVER.h + 8} rx="15" fill="none" className="stroke-brand" strokeWidth="3" opacity="0">
          <Window from={T.reqEnd} to={T.replyStart} />
        </rect>
      )}
      <BookOpenIcon x={SERVER.x + 12} y={SERVER.y + 10} size={18} className="text-brand" />
      <text x={SERVER.x + 38} y={SERVER.y + 24} fontSize="13" fontWeight="600" className="fill-foreground">
        Knowledge Base
      </text>
      <text x={SERVER.x + SERVER.w - 12} y={SERVER.y + 24} fontSize="9" textAnchor="end" className="fill-muted-foreground">
        MCP
      </text>
      <WrenchIcon x={SERVER.x + 12} y={SERVER.y + 37} size={12} className="text-muted-foreground" />
      <text x={SERVER.x + 29} y={SERVER.y + 47} fontSize="10" fontFamily="var(--font-mono, monospace)" className="fill-muted-foreground">
        search · get_document
      </text>

      {/* Request and reply travelling on the line */}
      {!reduced && (
        <>
          <Packet id={linkId} from={T.reqStart} to={T.reqEnd} color="var(--brand)" r={5} />
          {[0, 0.025, 0.05].map((d) => (
            <Packet key={d} id={linkId} from={T.replyStart + d} to={T.replyEnd + d - 0.05} back color={DATA_GREEN} />
          ))}
        </>
      )}
      <Step from={T.reqStart} to={T.replyStart} reduced={reduced}>
        <text x="338" y={LINK_Y - 8} fontSize="10" textAnchor="middle" fontFamily="var(--font-mono, monospace)" className="fill-brand">
          search("sovereign AI")
        </text>
      </Step>
      <Step from={T.replyStart} reduced={reduced}>
        <text x="338" y={SERVER.cy + 22} fontSize="10" textAnchor="middle" fill={DATA_GREEN}>
          4 documents
        </text>
      </Step>

      {/* Chat window */}
      <rect x={CHAT.x} y={CHAT.y} width={CHAT.w} height={CHAT.h} rx="12" className="fill-background stroke-border" />
      <rect x={CHAT.x + 12} y={CHAT.y + 10} width="20" height="20" rx="5" fill={CLAUDE_ORANGE} />
      <svg x={CHAT.x + 15} y={CHAT.y + 13} width="14" height="14" viewBox="0 0 24 24">
        <path d={CLAUDE_PATH} fill="#fff" />
      </svg>
      <text x={CHAT.x + 40} y={CHAT.y + 24} fontSize="12" fontWeight="600" className="fill-foreground">
        Claude
      </text>
      <line x1={CHAT.x} x2={right} y1={CHAT.y + 38} y2={CHAT.y + 38} className="stroke-border" />

      <Step from={T.ask} reduced={reduced}>
        <rect x="40" y="62" width="196" height="26" rx="10" className="fill-brand" />
        <text x="138" y="79" fontSize="11" textAnchor="middle" className="fill-background">
          Give me examples of sovereign AI
        </text>
      </Step>
      <Step from={T.call} reduced={reduced}>
        <rect x="26" y={LINK_Y - 11} width="172" height="22" rx="6" fill="none" strokeDasharray="3 2" className="stroke-muted-foreground" />
        <WrenchIcon x={33} y={LINK_Y - 6} size={12} className="text-muted-foreground" />
        <text x="50" y={LINK_Y + 4} fontSize="10" fontFamily="var(--font-mono, monospace)" className="fill-muted-foreground">
          knowledge_base · search
        </text>
      </Step>
      <Step from={T.answer} reduced={reduced}>
        <rect x="26" y="130" width="188" height="96" rx="10" className="fill-muted" />
        {["From your knowledge base:", "• France: Mistral AI", "• Switzerland: Apertus", "• UAE: Falcon models"].map((line, i) => (
          <text key={line} x="38" y={150 + i * 20} fontSize="11" fontWeight={i === 0 ? 500 : 400} className="fill-foreground">
            {line}
          </text>
        ))}
      </Step>

      {/* Step captions */}
      {reduced ? (
        <text x="320" y="258" textAnchor="middle" fontSize="13" className="fill-muted-foreground">
          Your AI app calls a tool on an MCP server, and the server sends data back
        </text>
      ) : (
        CAPTIONS.map((c) => (
          <g key={c.text} opacity="0">
            <Window from={c.from} to={c.to} />
            <text x="320" y="258" textAnchor="middle" fontSize="13" className="fill-muted-foreground">
              {c.text}
            </text>
          </g>
        ))
      )}
    </svg>
  );
}
